package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	bolt "go.etcd.io/bbolt"
)

// No snapshot is seeded by this test: only a real Kubernetes HTTP LIST may
// populate the first manager, and only its production Save may write the DB.
func TestPodPersistenceRestartInitialRoute(t *testing.T) {
	cacheDir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheDir)
	var gated atomic.Bool
	var reads atomic.Int32
	started := make(chan string, 32)
	release := make(chan struct{})
	var once sync.Once
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if gated.Load() {
			select {
			case started <- r.URL.Path:
			default:
			}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 6 {
			http.NotFound(w, r)
			return
		}
		switch parts[5] {
		case "events":
			_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"EventList","items":[]}`))
		case "pods":
			items := []any{}
			if parts[0] == "ctx-b" && parts[4] == "app" {
				phase := "Running"
				if gated.Load() {
					phase = "Failed"
				}
				items = append(items, map[string]any{"metadata": map[string]string{"name": "persisted-pod", "namespace": "app", "uid": "original-pod-uid"}, "status": map[string]string{"phase": phase}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "PodList", "items": items})
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	defer once.Do(func() { close(release) })
	configPath := filepath.Join(t.TempDir(), "kubeconfig")
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
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	policy := dataplane.DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	policy.Metrics.Enabled = false
	policy.Observers.Enabled = false
	closePersistence := func(dp dataplane.DataPlaneManager) {
		p := dp.Policy()
		p.Persistence.Enabled = false
		dp.SetPolicy(p) // Production configuration closes the current bbolt handle.
	}
	newServer := func() (*Server, http.Handler) {
		t.Helper()
		mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, configPath)
		if err != nil {
			t.Fatal(err)
		}
		s, _ := newTestServer(t)
		s.mgr = mgr
		s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Runtime: s.rt, Policy: policy})
		if !s.dp.Policy().Persistence.Enabled {
			t.Fatal("production persistence failed to open")
		}
		t.Cleanup(func() { closePersistence(s.dp) })
		return s, s.Router()
	}
	request := func(router http.Handler, token, contextName, ns string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/namespaces/"+ns+"/pods", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Kview-Context", contextName)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	type envelope struct {
		Items    []dto.PodListItemDTO `json:"items"`
		Active   string               `json:"active"`
		Observed time.Time            `json:"observed"`
		Meta     struct {
			Freshness string `json:"freshness"`
			Revision  uint64 `json:"revision,string"`
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
	first, firstRouter := newServer()
	original := decode(request(firstRouter, testToken, "ctx-b", "app"))
	if len(original.Items) != 1 || original.Items[0].Name != "persisted-pod" || original.Items[0].Phase != "Running" || original.Observed.IsZero() || original.Meta.Revision == 0 {
		t.Fatalf("source-backed initial response: %+v", original)
	}
	cached, ok := first.dp.PodsCachedSnapshot("ctx-b", "app")
	if !ok || len(cached.Items) != 1 {
		t.Fatalf("source-backed cache missing: %+v", cached)
	}
	closePersistence(first.dp)
	// Open the closed production DB read-only, proving bytes survived close and
	// contain the original rows, not merely a nonempty database/schema file.
	db, err := bolt.Open(filepath.Join(cacheDir, "kview", "dataplane-cache.bbolt"), 0600, &bolt.Options{ReadOnly: true, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	var saved dataplane.PodsSnapshot
	err = db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("snapshots_v1"))
		if b == nil {
			return fmt.Errorf("snapshot bucket missing")
		}
		return b.ForEach(func(k, v []byte) error {
			var candidate dataplane.PodsSnapshot
			if err := json.Unmarshal(v, &candidate); err != nil {
				return err
			}
			if len(candidate.Items) > 0 && candidate.Items[0].Name == "persisted-pod" {
				saved = candidate
			}
			return nil
		})
	})
	closeErr := db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	// Compare the wire rows: internal relationship carriers are intentionally
	// JSON-excluded and persisted separately in the relationship sidecar.
	cachedJSON, err := json.Marshal(cached.Items)
	if err != nil {
		t.Fatal(err)
	}
	savedJSON, err := json.Marshal(saved.Items)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Items) != 1 || string(savedJSON) != string(cachedJSON) || saved.Meta.ObservedAt.IsZero() || !saved.Meta.ObservedAt.Equal(cached.Meta.ObservedAt) {
		t.Fatalf("production Save did not persist original nonempty snapshot: saved=%+v cached=%+v", saved, cached)
	}
	gated.Store(true) // Every upstream endpoint is blocked from here onward.
	second, secondRouter := newServer()
	before := reads.Load()
	if res := request(secondRouter, "wrong", "ctx-b", "app"); res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", res.Code)
	}
	if reads.Load() != before {
		t.Fatal("unauthenticated request reached upstream")
	}
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- request(secondRouter, testToken, "ctx-b", "app") }()
	var restored envelope
	select {
	case res := <-result:
		restored = decode(res)
	case <-time.After(time.Second):
		t.Fatal("restart initial no-query request blocked behind gated upstream")
	}
	if restored.Active != "ctx-b" || !reflect.DeepEqual(restored.Items, original.Items) || restored.Meta.Freshness != "stale" || restored.Meta.Revision == 0 || !restored.Observed.Equal(original.Observed) {
		t.Fatalf("restored response=%+v original=%+v", restored, original)
	}
	loaded, ok := second.dp.PodsCachedSnapshot("ctx-b", "app")
	if !ok || !reflect.DeepEqual(loaded.Items, saved.Items) || !loaded.Meta.ObservedAt.Equal(saved.Meta.ObservedAt) || loaded.Meta.Freshness != dataplane.FreshnessClassStale {
		t.Fatalf("production hydration lost persisted rows: %+v", loaded)
	}
	waitForSource := func(path string) {
		t.Helper()
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()
		for {
			select {
			case got := <-started:
				if got == path {
					return
				}
			case <-timer.C:
				t.Fatalf("request never reached gated upstream %s", path)
			}
		}
	}
	waitForSource("/ctx-b/api/v1/namespaces/app/pods")
	// Different context, different namespace, and wholly absent identity cannot
	// borrow the persisted cell. Their real cold requests wait for source release.
	type pending struct {
		scope  [2]string
		result chan *httptest.ResponseRecorder
	}
	var pendingReads []pending
	for _, scope := range [][2]string{{"ctx-a", "app"}, {"ctx-b", "other"}, {"ctx-a", "missing"}} {
		ch := make(chan *httptest.ResponseRecorder, 1)
		pendingReads = append(pendingReads, pending{scope, ch})
		go func() { ch <- request(secondRouter, testToken, scope[0], scope[1]) }()
		waitForSource("/" + scope[0] + "/api/v1/namespaces/" + scope[1] + "/pods")
		select {
		case res := <-ch:
			t.Fatalf("missing scope %v returned before source release: %s", scope, res.Body.String())
		case <-time.After(100 * time.Millisecond):
		}
		if snap, ok := second.dp.PodsCachedSnapshot(scope[0], scope[1]); ok && len(snap.Items) > 0 {
			t.Fatalf("wrong scope %v received rows: %+v", scope, snap)
		}
	}
	once.Do(func() { close(release) })
	for _, pending := range pendingReads {
		select {
		case res := <-pending.result:
			empty := decode(res)
			if len(empty.Items) != 0 || empty.Active != pending.scope[0] {
				t.Fatalf("missing scope fabricated rows: %+v", empty)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("cold request %v did not finish", pending.scope)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		snap, ok := second.dp.PodsCachedSnapshot("ctx-b", "app")
		if ok && len(snap.Items) == 1 && snap.Items[0].Phase == "Failed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("released revalidation never published: %+v", snap)
		}
		time.Sleep(time.Millisecond)
	}
}
