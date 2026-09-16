package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func TestPodLiveSSEStreamAndCancellation(t *testing.T) {
	canceled := make(chan struct{})
	var once sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/apps/pods" {
			t.Errorf("unexpected upstream read: %s", r.URL)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("watch") != "true" {
			_, _ = w.Write([]byte(`{"kind":"PodList","apiVersion":"v1","metadata":{"resourceVersion":"initial"},"items":[]}`))
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		once.Do(func() { close(canceled) })
	}))
	defer upstream.Close()
	s, router := newTestServer(t)
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(strings.ReplaceAll(minimalKubeconfig, "https://127.0.0.1:16443", upstream.URL)), 0600); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
	if err != nil {
		t.Fatal(err)
	}
	policy := dataplane.DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	policy.Observers.Enabled = false
	s.mgr = mgr
	s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Policy: policy})
	defer s.CloseStreams()
	api := httptest.NewServer(router)
	defer api.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api.URL+"/api/namespaces/apps/pods/live", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("X-Kview-Context", "test-context")
	resp, err := api.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("bad SSE headers: %d %v", resp.StatusCode, resp.Header)
	}
	scanner := bufio.NewScanner(resp.Body)
	found := false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var u dataplane.PodLiveUpdate
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &u); err != nil {
			t.Fatal(err)
		}
		if u.Context != "test-context" || u.Namespace != "apps" {
			t.Fatalf("wrong identity: %+v", u)
		}
		if u.State != dataplane.PodLiveLive {
			continue
		}
		cached, ok := s.dp.PodsCachedSnapshot("test-context", "apps")
		if !ok || u.Revision == 0 || u.Revision != cached.Meta.Revision || u.Stale {
			t.Fatalf("notification not backed by committed snapshot: %+v", u)
		}
		found = true
		break
	}
	if !found {
		t.Fatalf("no live frame: %v", scanner.Err())
	}
	cancel()
	_ = resp.Body.Close()
	select {
	case <-canceled:
	case <-time.After(3 * time.Second):
		t.Fatal("SSE disconnect leaked upstream watch")
	}
}

type capacityLiveDataplane struct{ *stubDataplane }

func (*capacityLiveDataplane) SubscribePods(context.Context, string, string) (dataplane.PodLiveSubscription, error) {
	return nil, dataplane.ErrPodLiveCapacity
}
func TestPodLiveCapacityHTTP(t *testing.T) {
	s, router := newTestServer(t)
	s.dp = &capacityLiveDataplane{newStubDataplane()}
	r := doReqWithHeader(t, router, http.MethodGet, "/api/namespaces/apps/pods/live", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
	if r.Code != http.StatusTooManyRequests {
		t.Fatalf("capacity returned %d", r.Code)
	}
}
