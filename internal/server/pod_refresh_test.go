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
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Exercise the real HTTP -> request context -> scheduler -> snapshot cache ->
// Kubernetes client path. Mocking PodsSnapshot would hide a dropped refresh marker.
func TestPodRefreshUsesAuthenticatedExactContextRoute(t *testing.T) {
	for _, bypass := range []bool{true, false} {
		t.Run(fmt.Sprintf("bypass=%t", bypass), func(t *testing.T) {
			var mu sync.Mutex
			reads := map[string]int{}
			phase := "Running"
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Contexts have distinct API base paths, so namespace and cluster routing
				// mistakes cannot accidentally return indistinguishable source rows.
				parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
				if len(parts) != 6 || parts[1] != "api" || parts[2] != "v1" || parts[3] != "namespaces" {
					t.Errorf("unexpected Kubernetes request: %s", r.URL)
					http.NotFound(w, r)
					return
				}
				contextName, ns, kind := parts[0], parts[4], parts[5]
				w.Header().Set("Content-Type", "application/json")
				switch kind {
				case "pods":
					mu.Lock()
					reads[contextName+"/"+ns]++
					currentPhase := phase
					mu.Unlock()
					_ = json.NewEncoder(w).Encode(map[string]any{
						"apiVersion": "v1", "kind": "PodList", "metadata": map[string]string{"resourceVersion": "1"},
						"items": []any{map[string]any{
							"metadata": map[string]string{"name": contextName + "-" + ns, "namespace": ns},
							"status":   map[string]string{"phase": currentPhase},
						}},
					})
				case "events":
					_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"EventList","items":[]}`))
				default:
					t.Errorf("unexpected Kubernetes resource: %s", r.URL)
					http.NotFound(w, r)
				}
			}))
			defer source.Close()

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
			if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
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
			policy.Snapshots.TTLSeconds[string(dataplane.ResourceKindPods)] = 3600
			policy.Snapshots.ManualRefreshBypassesTTL = bypass
			s.dp = dataplane.NewManager(dataplane.ManagerConfig{ClusterManager: mgr, Runtime: s.rt, Policy: policy})
			router := s.Router()
			request := func(token, contextName, ns, intent string, status int, wantPhase string) {
				t.Helper()
				res := doReqWithHeader(t, router, http.MethodGet, "/api/namespaces/"+ns+"/pods?refresh="+intent, map[string]string{
					"Authorization": "Bearer " + token, "X-Kview-Context": contextName,
				}, nil)
				if res.Code != status {
					t.Fatalf("%s/%s intent=%q status=%d body=%s", contextName, ns, intent, res.Code, res.Body.String())
				}
				if status != http.StatusOK {
					return
				}
				var body struct {
					Active string               `json:"active"`
					Items  []dto.PodListItemDTO `json:"items"`
				}
				if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if body.Active != contextName || len(body.Items) != 1 || body.Items[0].Name != contextName+"-"+ns || body.Items[0].Namespace != ns || body.Items[0].Phase != wantPhase {
					t.Fatalf("wrong scoped snapshot: %+v, want %s/%s phase=%s", body, contextName, ns, wantPhase)
				}
			}
			assertReads := func(want map[string]int) {
				t.Helper()
				mu.Lock()
				defer mu.Unlock()
				if !reflect.DeepEqual(reads, want) {
					t.Fatalf("source reads=%v, want %v", reads, want)
				}
			}
			request("wrong", "ctx-b", "app", "manual", http.StatusUnauthorized, "")
			assertReads(map[string]int{})
			scopes := [][2]string{{"ctx-a", "app"}, {"ctx-a", "other"}, {"ctx-b", "app"}, {"ctx-b", "other"}}
			expected := map[string]int{}
			for _, scope := range scopes {
				request(testToken, scope[0], scope[1], "", http.StatusOK, "Running")
				expected[scope[0]+"/"+scope[1]] = 1
			}
			assertReads(expected)
			mu.Lock()
			phase = "Failed"
			mu.Unlock()
			// Every cell is hot but the source has changed. Only explicit manual intent
			// with bypass enabled may fetch again; revision/auto/default must stay cached.
			for _, intent := range []string{"auto", "revision", ""} {
				request(testToken, "ctx-b", "app", intent, http.StatusOK, "Running")
				assertReads(expected)
			}
			request("wrong", "ctx-b", "app", "manual", http.StatusUnauthorized, "")
			request(testToken, "ctx-b", "app", "force-all", http.StatusBadRequest, "")
			assertReads(expected)
			wantPhase := "Running"
			if bypass {
				wantPhase = "Failed"
				expected["ctx-b/app"]++
			}
			request(testToken, "ctx-b", "app", "manual", http.StatusOK, wantPhase)
			assertReads(expected)
			// Publication and invalidation are exact-cell: the selected cell advances,
			// while the other context and namespaces retain their original snapshots.
			for _, scope := range scopes {
				cachedPhase := "Running"
				if scope[0] == "ctx-b" && scope[1] == "app" {
					cachedPhase = wantPhase
				}
				request(testToken, scope[0], scope[1], "auto", http.StatusOK, cachedPhase)
			}
			assertReads(expected)
		})
	}
}
