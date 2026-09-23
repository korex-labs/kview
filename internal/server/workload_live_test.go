package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
)

var workloadLiveCases = []struct{ resource, kind, group string }{
	{"deployments", "Deployment", "apps"},
	{"statefulsets", "StatefulSet", "apps"},
	{"daemonsets", "DaemonSet", "apps"},
	{"replicasets", "ReplicaSet", "apps"},
	{"jobs", "Job", "batch"},
	{"cronjobs", "CronJob", "batch"},
}

func workloadLiveServer(t *testing.T, upstream http.Handler) (*Server, *httptest.Server) {
	t.Helper()
	kube := httptest.NewServer(upstream)
	t.Cleanup(kube.Close)
	s, _ := newTestServer(t)
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(strings.ReplaceAll(minimalKubeconfig, "https://127.0.0.1:16443", kube.URL)), 0600); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
	if err != nil {
		t.Fatal(err)
	}
	policy := dataplane.DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	// Keep observers enabled: revision reads must not admit them, even on cold planes.
	s.mgr = mgr
	s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Policy: policy})
	api := httptest.NewServer(s.Router())
	t.Cleanup(func() { s.CloseStreams(); api.Close() })
	return s, api
}

func workloadRequest(t *testing.T, api *httptest.Server, ctx context.Context, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, "GET", api.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("X-Kview-Context", "test-context")
	resp, err := api.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

type workloadFrame struct {
	dataplane.PodLiveUpdate
	Scope string `json:"scope"`
}

func readWorkloadFrame(t *testing.T, scanner *bufio.Scanner, accept func(workloadFrame) bool) workloadFrame {
	t.Helper()
	event := ""
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			event = strings.TrimPrefix(line, "event: ")
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		if event != "resource" {
			t.Fatalf("unexpected SSE event %q", event)
		}
		var u workloadFrame
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &u); err != nil {
			t.Fatal(err)
		}
		if accept(u) {
			return u
		}
	}
	t.Fatalf("stream ended before expected frame: %v", scanner.Err())
	return workloadFrame{}
}

func TestWorkloadLiveHTTPRevisionAndLifecycle(t *testing.T) {
	for _, termination := range []string{"disconnect", "shutdown"} {
		for _, tc := range workloadLiveCases {
			t.Run(tc.resource+"/"+termination, func(t *testing.T) {
				var reads atomic.Int32
				watchStarted, canceled, add := make(chan struct{}), make(chan struct{}), make(chan struct{})
				var startedOnce, canceledOnce sync.Once
				s, api := workloadLiveServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					reads.Add(1)
					if r.URL.Path != "/apis/"+tc.group+"/v1/namespaces/apps/"+tc.resource {
						t.Errorf("unexpected upstream read: %s", r.URL)
						http.NotFound(w, r)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					if r.URL.Query().Get("watch") != "true" {
						if _, err := fmt.Fprintf(w, `{"kind":%q,"apiVersion":%q,"metadata":{"resourceVersion":"10"},"items":[]}`, tc.kind+"List", tc.group+"/v1"); err != nil {
							t.Errorf("write fixture response: %v", err)
						}
						return
					}
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
					startedOnce.Do(func() { close(watchStarted) })
					select {
					case <-add:
						if _, err := fmt.Fprintf(w, `{"type":"ADDED","object":{"kind":%q,"apiVersion":%q,"metadata":{"name":"created-after-list","namespace":"apps","uid":"new-uid","resourceVersion":"11"}}}`+"\n", tc.kind, tc.group+"/v1"); err != nil {
							t.Errorf("write fixture response: %v", err)
						}
						w.(http.Flusher).Flush()
					case <-r.Context().Done():
					}
					<-r.Context().Done()
					canceledOnce.Do(func() { close(canceled) })
				}))
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				path := "/api/namespaces/apps/" + tc.resource
				// Cold revision must be an immediate miss, with no upstream reads or observer work.
				resp := workloadRequest(t, api, ctx, path+"?refresh=revision")
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode != 503 || !strings.Contains(string(body), `"message"`) {
					t.Fatalf("cold revision: %d %s", resp.StatusCode, body)
				}
				if reads.Load() != 0 {
					t.Fatal("cold revision admitted upstream work")
				}
				resp = workloadRequest(t, api, ctx, path+"/live")
				defer func() { _ = resp.Body.Close() }()
				if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" || resp.Header.Get("Cache-Control") != "no-store" {
					t.Fatalf("SSE response: %d %v", resp.StatusCode, resp.Header)
				}
				scanner := bufio.NewScanner(resp.Body)
				first := readWorkloadFrame(t, scanner, func(u workloadFrame) bool { return u.State == dataplane.PodLiveLive })
				if first.Context != "test-context" || first.Namespace != "apps" || first.Resource != dataplane.ResourceKind(tc.resource) || first.Scope != "Namespaced" || first.Revision == 0 || first.Stale {
					t.Fatalf("identity: %+v", first)
				}
				select {
				case <-watchStarted:
				case <-ctx.Done():
					t.Fatal("watch not started")
				}
				close(add)
				update := readWorkloadFrame(t, scanner, func(u workloadFrame) bool { return u.Revision > first.Revision && u.ResourceVersion == "11" })
				before := reads.Load()
				list := workloadRequest(t, api, ctx, path+"?refresh=revision")
				var envelope struct {
					Active   string `json:"active"`
					Items    []struct{ Name, UID string }
					Meta     struct{ Revision, Freshness, Coverage, Completeness string }
					Observed time.Time
				}
				err := json.NewDecoder(list.Body).Decode(&envelope)
				_ = list.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				cached, ok := s.dp.CachedResourceSnapshot("test-context", "apps", dataplane.ResourceKind(tc.resource))
				if list.StatusCode != 200 || !ok || cached.Meta.Revision != update.Revision || envelope.Meta.Revision != strconv.FormatUint(update.Revision, 10) || envelope.Active != "test-context" || len(envelope.Items) != 1 || envelope.Items[0].UID != "new-uid" || envelope.Items[0].Name != "created-after-list" || envelope.Observed.IsZero() || envelope.Meta.Freshness != string(cached.Meta.Freshness) || envelope.Meta.Coverage != string(cached.Meta.Coverage) || envelope.Meta.Completeness != string(cached.Meta.Completeness) {
					t.Fatalf("revision envelope: %+v cached=%+v", envelope, cached.Meta)
				}
				if reads.Load() != before {
					t.Fatal("revision read admitted upstream work")
				}
				// Exercise both disconnect and process shutdown across every kind.
				if termination == "disconnect" {
					cancel()
					_ = resp.Body.Close()
				} else {
					s.CloseStreams()
					_, _ = io.Copy(io.Discard, resp.Body)
				}
				select {
				case <-canceled:
				case <-time.After(3 * time.Second):
					t.Fatal("upstream watch leaked")
				}
				s.CloseStreams() // idempotent, including after a disconnected subscription.
				denied := workloadRequest(t, api, context.Background(), path+"/live")
				_ = denied.Body.Close()
				if denied.StatusCode != 503 {
					t.Fatalf("new subscription after shutdown: %d", denied.StatusCode)
				}
			})
		}
	}

}

func TestWorkloadLiveHTTPAuthAndExactScope(t *testing.T) {
	for _, tc := range workloadLiveCases {
		t.Run(tc.resource, func(t *testing.T) {
			_, router := newTestServer(t)
			base := "/api/namespaces/apps/" + tc.resource
			for _, suffix := range []string{"/live", "?refresh=revision"} {
				for _, tt := range []struct {
					auth, name string
					status     int
				}{
					{"", "test-context", 401}, {"Bearer wrong", "test-context", 401},
					{"Bearer " + testToken, "", 400}, {"Bearer " + testToken, "unknown", 400},
					{"Bearer " + testToken, " test-context", 400}, {"Bearer " + testToken, "test-context ", 400},
					{"Bearer " + testToken, "test-context", 503},
				} {
					rec := doReqWithHeader(t, router, "GET", base+suffix, map[string]string{"Authorization": tt.auth, "X-Kview-Context": tt.name}, nil)
					if rec.Code != tt.status {
						t.Fatalf("%s context %q: %d want %d", suffix, tt.name, rec.Code, tt.status)
					}
				}
				req := httptest.NewRequest("GET", base+suffix, nil)
				req.Header.Set("Authorization", "Bearer "+testToken)
				req.Header.Add("X-Kview-Context", "test-context")
				req.Header.Add("X-Kview-Context", "test-context")
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != 400 {
					t.Fatalf("duplicate context: %d", rec.Code)
				}
				for _, ns := range []string{"ALL", "bad_namespace"} {
					rec := doReqWithHeader(t, router, "GET", "/api/namespaces/"+ns+"/"+tc.resource+suffix, map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
					if rec.Code != 400 {
						t.Fatalf("invalid namespace %s: %d", ns, rec.Code)
					}
				}
			}
			for _, auth := range []string{"", "Bearer " + testToken} {
				rec := doReqWithHeader(t, router, "GET", base+"/live?token="+testToken, map[string]string{"Authorization": auth, "X-Kview-Context": "test-context"}, nil)
				if rec.Code != 401 {
					t.Fatalf("query token accepted: %d", rec.Code)
				}
			}
		})
	}
}

func TestWorkloadLiveHTTPBlockedByAccess(t *testing.T) {
	for _, tc := range workloadLiveCases {
		t.Run(tc.resource, func(t *testing.T) {
			var reads atomic.Int32
			_, api := workloadLiveServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reads.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(403)
				_, _ = io.WriteString(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":"fixture denied"}`)
			}))
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			resp := workloadRequest(t, api, ctx, "/api/namespaces/apps/"+tc.resource+"/live")
			defer func() { _ = resp.Body.Close() }()
			frame := readWorkloadFrame(t, bufio.NewScanner(resp.Body), func(u workloadFrame) bool { return u.State == dataplane.PodLiveBlocked })
			if frame.Resource != dataplane.ResourceKind(tc.resource) || frame.Scope != "Namespaced" || !frame.Stale || reads.Load() != 1 {
				t.Fatalf("blocked frame: %+v reads=%d", frame, reads.Load())
			}
		})
	}
}
