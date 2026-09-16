package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestPodColdRowsDoNotWaitForOptionalEvents(t *testing.T) {
	started, release := make(chan struct{}, 10), make(chan struct{})
	var once sync.Once
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/namespaces/app/pods":
			_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"PodList","items":[{"metadata":{"name":"real-pod","namespace":"app","uid":"uid-1"},"status":{"phase":"Running"}}]}`))
		case "/api/v1/namespaces/app/events":
			started <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"EventList","items":[{"metadata":{"name":"event","namespace":"app"},"involvedObject":{"kind":"Pod","namespace":"app","name":"real-pod","uid":"uid-1"},"type":"Warning","reason":"BackOff","lastTimestamp":"2026-09-16T10:00:00Z"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer source.Close()
	defer once.Do(func() { close(release) })
	configPath := filepath.Join(t.TempDir(), "kubeconfig")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: %s\ncontexts:\n- name: ctx\n  context:\n    cluster: test\n    user: test\ncurrent-context: ctx\nusers:\n- name: test\n  user:\n    token: fixture\n", source.URL)
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
	s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Runtime: s.rt, Policy: policy})
	router := s.Router()
	request := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/namespaces/app/pods", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Kview-Context", "ctx")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	if res := request("wrong"); res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d", res.Code)
	}
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() { result <- request(testToken) }()
	select {
	case res := <-result:
		if res.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
		}
		var body struct {
			Items    []dto.PodListItemDTO `json:"items"`
			Observed time.Time            `json:"observed"`
			Active   string               `json:"active"`
			Meta     struct {
				Revision  uint64 `json:"revision,string"`
				Freshness string `json:"freshness"`
			} `json:"meta"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Items) != 1 || body.Items[0].UID != "uid-1" || body.Items[0].LastEvent != nil || body.Active != "ctx" || body.Observed.IsZero() || body.Meta.Revision == 0 || body.Meta.Freshness != "hot" {
			t.Fatalf("cold envelope: %+v", body)
		}
	case <-time.After(time.Second):
		t.Fatal("cold genuine Pods rows and metadata blocked behind optional Events LIST")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("optional Events enrichment never started")
	}
	once.Do(func() { close(release) })
	deadline := time.Now().Add(2 * time.Second)
	for {
		snap, ok := s.dp.PodsCachedSnapshot("ctx", "app")
		if ok && len(snap.Items) == 1 && snap.Items[0].LastEvent != nil && snap.Items[0].LastEvent.Reason == "BackOff" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("eventual enrichment absent: %+v", snap)
		}
		time.Sleep(time.Millisecond)
	}
}
