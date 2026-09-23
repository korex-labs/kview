package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"k8s.io/apimachinery/pkg/fields"
)

func customResourceInspectionRouter(t *testing.T, upstream http.Handler) http.Handler {
	t.Helper()
	source := httptest.NewServer(upstream)
	t.Cleanup(source.Close)
	configPath := filepath.Join(t.TempDir(), "kubeconfig")
	// Active context is deliberately unusable: requests must honor the exact header.
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: selected\n  cluster:\n    server: %s\n- name: wrong\n  cluster:\n    server: http://127.0.0.1:1\ncontexts:\n- name: selected\n  context:\n    cluster: selected\n    user: test\n- name: wrong\n  context:\n    cluster: wrong\n    user: test\ncurrent-context: wrong\nusers:\n- name: test\n  user:\n    token: fixture\n", source.URL)
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, configPath)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newTestServer(t)
	s.mgr = mgr
	return s.Router()
}

func TestCustomResourceInspectionEventsHTTP(t *testing.T) {
	for _, tc := range []struct {
		name, namespace, uid                       string
		objectCode, eventCode, wantCode, wantLists int
		paginate                                   bool
	}{
		{name: "namespaced", namespace: "apps", uid: "uid-1", wantCode: 200, wantLists: 1},
		{name: "cluster", uid: "uid-1", wantCode: 200, wantLists: 1},
		{name: "pagination", namespace: "apps", uid: "uid-1", wantCode: 200, wantLists: 2, paginate: true},
		{name: "missing uid", namespace: "apps", wantCode: 400},
		{name: "replacement", namespace: "apps", uid: "old-uid", wantCode: 409},
		{name: "get denied", namespace: "apps", uid: "uid-1", objectCode: 403, wantCode: 403},
		{name: "get missing", namespace: "apps", uid: "uid-1", objectCode: 404, wantCode: 404},
		{name: "events denied", namespace: "apps", uid: "uid-1", eventCode: 403, wantCode: 403, wantLists: 1},
		{name: "cluster events denied", uid: "uid-1", eventCode: 403, wantCode: 403, wantLists: 1},
		{name: "events error", namespace: "apps", uid: "uid-1", eventCode: 500, wantCode: 500, wantLists: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			gets, lists := 0, 0
			objectPath := "/apis/example.com/v1/"
			eventPath := "/api/v1/"
			if tc.namespace != "" {
				objectPath += "namespaces/" + tc.namespace + "/"
				eventPath += "namespaces/" + tc.namespace + "/"
			}
			objectPath += "widgets/demo"
			eventPath += "events"
			h := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				if r.Method != http.MethodGet {
					t.Errorf("unexpected method %s", r.Method)
				}
				status := func(code int) {
					reason := "InternalError"
					if code == 403 {
						reason = "Forbidden"
					}
					if code == 404 {
						reason = "NotFound"
					}
					w.WriteHeader(code)
					if _, err := fmt.Fprintf(w, `{"apiVersion":"v1","kind":"Status","status":"Failure","reason":%q,"code":%d,"message":"fixture rejection"}`, reason, code); err != nil {
						t.Errorf("write fixture response: %v", err)
					}
				}
				switch r.URL.Path {
				case objectPath:
					gets++
					if tc.objectCode != 0 {
						status(tc.objectCode)
						return
					}
					if _, err := fmt.Fprintf(w, `{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":%q,"uid":"uid-1","generation":2,"resourceVersion":"42"},"spec":null,"status":{"observedGeneration":1}}`, tc.namespace); err != nil {
						t.Errorf("write fixture response: %v", err)
					}
				case eventPath:
					lists++
					if gets != 1 {
						t.Errorf("events before exact GET: gets=%d", gets)
					}
					selector, err := fields.ParseSelector(r.URL.Query().Get("fieldSelector"))
					if err != nil {
						t.Error(err)
					}
					for key, want := range map[string]string{"involvedObject.uid": "uid-1", "involvedObject.name": "demo", "involvedObject.kind": "Widget", "involvedObject.namespace": tc.namespace} {
						if got, ok := selector.RequiresExactMatch(key); !ok || got != want {
							t.Errorf("selector %s=%q (%v), want %q", key, got, ok, want)
						}
					}
					if r.URL.Query().Get("limit") != "500" {
						t.Errorf("unbounded LIST: %s", r.URL.RawQuery)
					}
					if tc.eventCode != 0 {
						status(tc.eventCode)
						return
					}
					cont := ""
					if tc.paginate && lists == 1 {
						cont = "next-page"
					}
					if tc.paginate && lists == 2 && r.URL.Query().Get("continue") != "next-page" {
						t.Error("lost continuation")
					}
					items := []map[string]any{}
					add := func(uid, apiVersion, kind, name, ns, reason string) {
						items = append(items, map[string]any{"metadata": map[string]any{"name": reason}, "involvedObject": map[string]any{"uid": uid, "apiVersion": apiVersion, "kind": kind, "name": name, "namespace": ns}, "type": "Warning", "reason": reason, "message": "inspect", "lastTimestamp": "2026-09-17T10:00:00Z"})
					}
					add("uid-1", "example.com/v1", "Widget", "demo", tc.namespace, "Matched")
					add("old-uid", "example.com/v1", "Widget", "demo", tc.namespace, "WrongUID")
					add("uid-1", "other.com/v1", "Widget", "demo", tc.namespace, "WrongGroup")
					add("uid-1", "example.com/v1", "Other", "demo", tc.namespace, "WrongKind")
					add("uid-1", "example.com/v1", "Widget", "other", tc.namespace, "WrongName")
					add("uid-1", "example.com/v1", "Widget", "demo", "other", "WrongNamespace")
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "EventList", "metadata": map[string]any{"continue": cont}, "items": items})
				default:
					t.Errorf("unexpected Kubernetes request: %s", r.URL)
					http.NotFound(w, r)
				}
			}))
			path := "/api/customresources/example.com/v1/widgets/demo/events?namespace=" + tc.namespace + "&uid=" + tc.uid + "&limit=1&q=inspect&type=Warning"
			headers := map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "selected"}
			unauth := doReqWithHeader(t, h, http.MethodGet, path, map[string]string{"X-Kview-Context": "selected"}, nil)
			if unauth.Code != 401 {
				t.Fatalf("auth status=%d", unauth.Code)
			}
			rec := doReqWithHeader(t, h, http.MethodGet, path, headers, nil)
			if rec.Code != tc.wantCode {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tc.wantCode, rec.Body.String())
			}
			mu.Lock()
			defer mu.Unlock()
			wantGets := 1
			if tc.uid == "" {
				wantGets = 0
			}
			if gets != wantGets || lists != tc.wantLists {
				t.Fatalf("GET=%d LIST=%d want %d/%d", gets, lists, wantGets, tc.wantLists)
			}
			if rec.Code == 200 {
				var body struct {
					Active               string
					Items                []struct{ Reason string }
					Total, Limit, Offset int
					HasMore              bool
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body.Active != "selected" || body.Total != tc.wantLists || body.Limit != 1 || body.Offset != 0 || body.HasMore != tc.paginate || len(body.Items) != 1 || body.Items[0].Reason != "Matched" {
					t.Fatalf("wrong envelope: %s", rec.Body.String())
				}
			} else {
				var body struct{ Error APIError }
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body.Error.Code == "" {
					t.Fatalf("unstructured error: %s", rec.Body.String())
				}
			}
		})
	}
}

func TestCustomResourceInspectionRejectsReturnedIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, field, value string
		metadata           bool
		status             int
		code               string
	}{
		{"empty uid", "uid", "", true, 409, ErrCodeConflict},
		{"wrong name", "name", "other", true, 500, ErrCodeInternal},
		{"wrong namespace", "namespace", "other", true, 500, ErrCodeInternal},
		{"missing namespace", "namespace", "", true, 500, ErrCodeInternal},
		{"wrong group", "apiVersion", "other.com/v1", false, 500, ErrCodeInternal},
		{"wrong version", "apiVersion", "example.com/v2", false, 500, ErrCodeInternal},
		{"malformed apiVersion", "apiVersion", "example.com/v1/extra", false, 500, ErrCodeInternal},
		{"empty kind", "kind", "", false, 500, ErrCodeInternal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var gets, unexpected atomic.Int32
			h := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/apis/example.com/v1/namespaces/apps/widgets/demo" {
					unexpected.Add(1)
					http.Error(w, "unexpected read", 500)
					return
				}
				gets.Add(1)
				metadata := map[string]any{"name": "demo", "namespace": "apps", "uid": "uid-1"}
				obj := map[string]any{"apiVersion": "example.com/v1", "kind": "Widget", "metadata": metadata}
				if tc.metadata {
					metadata[tc.field] = tc.value
				} else {
					obj[tc.field] = tc.value
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(obj)
			}))
			rec := doReqWithHeader(t, h, http.MethodGet, "/api/customresources/example.com/v1/widgets/demo/events?namespace=apps&uid=uid-1", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "selected"}, nil)
			var body struct {
				Error APIError
				Items json.RawMessage
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if rec.Code != tc.status || body.Error.Code != tc.code || body.Items != nil || gets.Load() != 1 || unexpected.Load() != 0 {
				t.Fatalf("status=%d body=%s GET=%d unexpected=%d", rec.Code, rec.Body.String(), gets.Load(), unexpected.Load())
			}
		})
	}
}

func TestCustomResourceInspectionEventsContextTermination(t *testing.T) {
	for _, mode := range []string{"cancel", "deadline"} {
		t.Run(mode, func(t *testing.T) {
			var gets, lists atomic.Int32
			started := make(chan struct{}, 1)
			stopped := make(chan struct{}, 1)
			h := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/apis/example.com/v1/namespaces/apps/widgets/demo":
					gets.Add(1)
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":"apps","uid":"uid-1"}}`))
				case "/api/v1/namespaces/apps/events":
					lists.Add(1)
					if r.URL.Query().Get("fieldSelector") == "" {
						t.Error("broad Events read")
					}
					started <- struct{}{}
					select {
					case <-r.Context().Done():
						stopped <- struct{}{}
					case <-time.After(5 * time.Second):
						t.Error("Events upstream did not receive cancellation")
					}
				default:
					t.Errorf("unexpected upstream request: %s", r.URL)
					http.NotFound(w, r)
				}
			}))
			// An earlier caller deadline exercises real HTTP transport cancellation
			// without waiting for the handler's ten-second ceiling.
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			req := httptest.NewRequest(http.MethodGet, "/api/customresources/example.com/v1/widgets/demo/events?namespace=apps&uid=uid-1", nil).WithContext(ctx)
			req.Header.Set("Authorization", "Bearer "+testToken)
			req.Header.Set("X-Kview-Context", "selected")
			rec := httptest.NewRecorder()
			done := make(chan struct{})
			go func() { defer close(done); h.ServeHTTP(rec, req) }()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				cancel()
				<-done
				t.Fatal("Events LIST never started")
			}
			wantErr := context.DeadlineExceeded
			if mode == "cancel" {
				wantErr = context.Canceled
				cancel()
			}
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				cancel()
				<-done
				t.Fatal("handler did not terminate")
			}
			var body struct {
				Active string
				Error  APIError
				Items  json.RawMessage
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(ctx.Err(), wantErr) || rec.Code != 504 || body.Active != "selected" || body.Error.Code != ErrCodeTimeout || body.Items != nil || gets.Load() != 1 || lists.Load() != 1 {
				t.Fatalf("context=%v status=%d body=%s GET=%d LIST=%d", ctx.Err(), rec.Code, rec.Body.String(), gets.Load(), lists.Load())
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("upstream request was not canceled")
			}
		})
	}
}

func TestCustomResourceInspectionDetailDoesNotReadEvents(t *testing.T) {
	h := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/example.com/v1/namespaces/apps/widgets/demo" {
			t.Errorf("detail performed optional read: %s", r.URL)
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":"apps","uid":"uid-1","resourceVersion":"42","generation":0},"spec":false,"status":null}`))
	}))
	rec := doReqWithHeader(t, h, http.MethodGet, "/api/customresources/example.com/v1/widgets/demo?namespace=apps", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "selected"}, nil)
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Active string
		Item   struct {
			Summary struct {
				UID, ResourceVersion string
				Generation           *int64
			}
			Spec, Status json.RawMessage
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Active != "selected" || body.Item.Summary.UID != "uid-1" || body.Item.Summary.ResourceVersion != "42" || body.Item.Summary.Generation == nil || *body.Item.Summary.Generation != 0 || string(body.Item.Spec) != "false" || string(body.Item.Status) != "null" {
		t.Fatalf("detail contract: %s", rec.Body.String())
	}
}
