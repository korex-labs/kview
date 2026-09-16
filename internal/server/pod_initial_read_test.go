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
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// The manager is real and the cache is populated by the Kubernetes HTTP client,
// not a PodsSnapshot mock. Only the source transport is gated.
func TestPodInitialNoQueryRouteReturnsRuntimeRowsBeforeSource(t *testing.T) {
	var mu sync.Mutex
	reads := map[string]int{}
	gated := false
	started, release := make(chan struct{}, 10), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 6 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if parts[5] == "events" {
			_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"EventList","items":[]}`))
			return
		}
		if parts[5] != "pods" {
			http.NotFound(w, r)
			return
		}
		key := parts[0] + "/" + parts[4]
		mu.Lock()
		reads[key]++
		count := reads[key]
		block := gated
		mu.Unlock()
		if block {
			started <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		phase := "Running"
		if count > 1 {
			phase = "Failed"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "PodList", "items": []any{map[string]any{"metadata": map[string]string{"name": key + "-pod", "namespace": parts[4]}, "status": map[string]string{"phase": phase}}}})
	}))
	defer source.Close()
	// Release must precede server shutdown even when an assertion fails.
	defer releaseOnce.Do(func() { close(release) })
	config := fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: a
  cluster:
    server: %s/ctx-a
- name: b
  cluster:
    server: %s/ctx-b
contexts:
- name: ctx-a
  context:
    cluster: a
    user: test
- name: ctx-b
  context:
    cluster: b
    user: test
current-context: ctx-a
users:
- name: test
  user:
    token: fake-token
`, source.URL, source.URL)
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
	policy.Metrics.Enabled = false
	policy.Observers.Enabled = false
	policy.Persistence.Enabled = false
	policy.Snapshots.TTLSeconds[string(dataplane.ResourceKindPods)] = 5
	s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Runtime: s.rt, Policy: policy})
	router := s.Router()
	request := func(token, contextName, ns, query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/namespaces/"+ns+"/pods"+query, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Kview-Context", contextName)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	type envelope struct {
		ObservedAt time.Time            `json:"observed"`
		Active     string               `json:"active"`
		Items      []dto.PodListItemDTO `json:"items"`
		Meta       struct {
			Revision  uint64 `json:"revision,string"`
			Freshness string `json:"freshness"`
		} `json:"meta"`
	}
	decode := func(res *httptest.ResponseRecorder) envelope {
		t.Helper()
		if res.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
		}
		var out envelope
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	original := decode(request(testToken, "ctx-b", "app", ""))
	if len(original.Items) != 1 || original.Items[0].Phase != "Running" || original.Meta.Revision == 0 || original.ObservedAt.IsZero() {
		t.Fatalf("cold source response: %+v", original)
	}
	mu.Lock()
	if reads["ctx-b/app"] != 1 {
		t.Fatalf("cold reads=%v", reads)
	}
	gated = true
	mu.Unlock()
	// Wait only for the real configured TTL, not for an assumed warmup interval.
	<-time.After(time.Until(original.ObservedAt.Add(5*time.Second)) + 10*time.Millisecond)
	if got := request("wrong", "ctx-b", "app", ""); got.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status=%d", got.Code)
	}
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- request(testToken, "ctx-b", "app", "") }()
	var cached envelope
	select {
	case res := <-result:
		cached = decode(res)
	case <-time.After(250 * time.Millisecond):
		t.Fatal("no-query route blocked behind stale runtime refresh")
	}
	if cached.Active != "ctx-b" || len(cached.Items) != 1 || cached.Items[0].Name != "ctx-b/app-pod" || cached.Meta.Freshness != "stale" || cached.Meta.Revision != original.Meta.Revision || !cached.ObservedAt.Equal(original.ObservedAt) {
		t.Fatalf("cached envelope: %+v original=%+v", cached, original)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("initial read did not schedule refresh")
	}
	for range 5 {
		decode(request(testToken, "ctx-b", "app", ""))
	}
	// Revision is still a cache-only read and cannot queue another LIST.
	decode(request(testToken, "ctx-b", "app", "?refresh=revision"))
	mu.Lock()
	n := reads["ctx-b/app"]
	mu.Unlock()
	if n != 2 {
		t.Fatalf("dedup source count=%d", n)
	}
	// A different exact identity is cold, not eligible for the retained row.
	for _, scope := range [][2]string{{"ctx-a", "app"}, {"ctx-b", "other"}} {
		go func(contextName, ns string) { result <- request(testToken, contextName, ns, "") }(scope[0], scope[1])
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("cold exact scope did not read source")
		}
		select {
		case res := <-result:
			t.Fatalf("wrong-scope cache shortcut: %s", res.Body.String())
		default:
		}
		// Release all sources together below; collect these requests afterwards.
	}
	releaseOnce.Do(func() { close(release) })
	for range 2 {
		select {
		case res := <-result:
			decode(res)
		case <-time.After(time.Second):
			t.Fatal("cold source failed to complete")
		}
	}
	deadline := time.Now().Add(time.Second)
	for {
		snap, ok := s.dp.PodsCachedSnapshot("ctx-b", "app")
		if ok && snap.Meta.Revision > original.Meta.Revision && len(snap.Items) == 1 && snap.Items[0].Phase == "Failed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("background result not published: %+v", snap)
		}
		time.Sleep(time.Millisecond)
	}
	refreshed := decode(request(testToken, "ctx-b", "app", "?refresh=manual"))
	if refreshed.Meta.Revision <= original.Meta.Revision+1 {
		t.Fatalf("normal manual refresh failed to advance: %+v", refreshed)
	}
	mu.Lock()
	defer mu.Unlock()
	if reads["ctx-b/app"] != 3 || reads["ctx-a/app"] != 1 || reads["ctx-b/other"] != 1 {
		t.Fatalf("source counts=%v", reads)
	}
}
