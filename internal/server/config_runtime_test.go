package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
)

// Complements the manager's gated local-persistence regression with the real
// config and Pods HTTP routes. No real Kubernetes endpoint is contacted.
func TestConfigRepeatWithRealPersistenceKeepsReadyPodsAvailable(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	var readyReads atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/events"):
			if _, err := fmt.Fprint(w, `{"apiVersion":"v1","kind":"EventList","items":[]}`); err != nil {
				t.Errorf("write fixture response: %v", err)
			}
		case strings.HasSuffix(r.URL.Path, "/namespaces/slow/pods"):
			once.Do(func() { close(started) })
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			if _, err := fmt.Fprint(w, `{"apiVersion":"v1","kind":"PodList","items":[]}`); err != nil {
				t.Errorf("write fixture response: %v", err)
			}
		case strings.HasSuffix(r.URL.Path, "/namespaces/ready/pods"):
			readyReads.Add(1)
			if _, err := fmt.Fprint(w, `{"apiVersion":"v1","kind":"PodList","items":[{"metadata":{"name":"cached","namespace":"ready","uid":"cached-uid"},"status":{"phase":"Running"}}]}`); err != nil {
				t.Errorf("write fixture response: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	config := fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: local
  cluster:
    server: %s
contexts:
- name: test-ctx
  context:
    cluster: local
    user: test
current-context: test-ctx
users:
- name: test
  user:
    token: fake-token
`, source.URL)
	configPath := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, configPath)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newTestServer(t)
	s.mgr = mgr
	policy := dataplane.DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	policy.Metrics.Enabled = false
	policy.Observers.Enabled = false
	s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Runtime: s.rt, Policy: policy})
	defer func() { s.dp.ClosePodsLive(); p := s.dp.Policy(); p.Persistence.Enabled = false; s.dp.SetPolicy(p) }()
	if !s.dp.Policy().Persistence.Enabled {
		t.Fatal("local persistence did not open")
	}
	h := s.Router()
	request := func(method, path string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+testToken)
		req.Header.Set("X-Kview-Context", "test-ctx")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	warm := request(http.MethodGet, "/api/namespaces/ready/pods", nil)
	if warm.Code != http.StatusOK || !strings.Contains(warm.Body.String(), `"name":"cached"`) {
		t.Fatalf("warm=%d %s", warm.Code, warm.Body.String())
	}
	slow := make(chan *httptest.ResponseRecorder, 1)
	go func() { slow <- request(http.MethodGet, "/api/namespaces/slow/pods", nil) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("local source did not reach gate")
	}
	defer func() {
		releaseOnce.Do(func() { close(release) })
		select {
		case <-slow:
		case <-time.After(3 * time.Second):
			t.Error("slow fixture failed to finish")
		}
	}()
	bundle := s.dp.PolicyBundle()
	bundle.Version = ""
	bundle.ContextOverrides = map[string]dataplane.DataplanePolicyOverride{}
	payload, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	configDone, podsDone := make(chan *httptest.ResponseRecorder, 1), make(chan *httptest.ResponseRecorder, 1)
	go func() { configDone <- request(http.MethodPost, "/api/dataplane/config", payload) }()
	go func() { podsDone <- request(http.MethodGet, "/api/namespaces/ready/pods", nil) }()
	for name, ch := range map[string]<-chan *httptest.ResponseRecorder{"config": configDone, "pods": podsDone} {
		select {
		case rec := <-ch:
			if rec.Code != http.StatusOK {
				t.Fatalf("%s=%d %s", name, rec.Code, rec.Body.String())
			}
			if name == "pods" && !strings.Contains(rec.Body.String(), `"name":"cached"`) {
				t.Fatal("ready cache rows lost")
			}
			t.Logf("%s completed within %s while local source remained gated", name, time.Since(start))
		case <-time.After(time.Second):
			t.Fatalf("%s blocked by unrelated local source", name)
		}
	}
	if readyReads.Load() != 1 {
		t.Fatalf("repeat triggered ready source reads: %d", readyReads.Load())
	}
}
