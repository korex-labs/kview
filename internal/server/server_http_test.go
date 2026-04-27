package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/dataplane"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
	"github.com/korex-labs/kview/internal/kube/jobdebug"
	"github.com/korex-labs/kview/internal/runtime"
	"github.com/korex-labs/kview/internal/session"
)

// ── test helpers ─────────────────────────────────────────────────────────────

const testToken = "test-token-abc"

// minimalKubeconfig is a self-contained kubeconfig for test cluster managers.
// The server address is unreachable; handlers that reach the kube layer will
// fail, but validation-path tests return before that point.
const minimalKubeconfig = `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://127.0.0.1:16443
  name: test-cluster
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: test-context
current-context: test-context
users:
- name: test-user
  user:
    token: fake-token
`

type discardLogger struct{}

func (discardLogger) Printf(string, ...any) {}

// newTestServer builds a minimal Server wired through the full Router (including
// auth + activity middlewares). The fake kubeconfig makes mgr.ActiveContext()
// and mgr.ListContexts() work without a real cluster. All tests that drive
// handler code paths beyond validation use the stubs below.
func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()

	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(kubeconfigPath, []byte(minimalKubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, kubeconfigPath)
	if err != nil {
		t.Fatalf("new cluster manager: %v", err)
	}

	rt := runtime.NewManager()
	dp := newStubDataplane()
	sess := session.NewInMemoryManager(rt.Registry())

	s := &Server{
		mgr:            mgr,
		token:          testToken,
		actions:        kube.NewActionRegistry(),
		rt:             rt,
		dp:             dp,
		sessions:       sess,
		jobRuns:        jobdebug.NewManager(),
		deniedLogUntil: map[string]time.Time{},
		clusterOnline:  map[string]bool{},
	}
	return s, s.Router()
}

// doReq sends a request through the router and returns the recorder.
func doReq(t *testing.T, h http.Handler, method, path, token string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *bytes.Buffer
	if body != nil {
		reqBody = bytes.NewBuffer(body)
	} else {
		reqBody = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, reqBody)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// doReqWithHeader is like doReq but also sets a custom header.
func doReqWithHeader(t *testing.T, h http.Handler, method, path string, headers map[string]string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *bytes.Buffer
	if body != nil {
		reqBody = bytes.NewBuffer(body)
	} else {
		reqBody = bytes.NewBuffer(nil)
	}
	req := httptest.NewRequest(method, path, reqBody)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func mustDecodeJSON(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("decode JSON: %v – body: %s", err, data)
	}
	return m
}

// ── stubDataplane ─────────────────────────────────────────────────────────────
// Implements DataPlaneManager. Methods exercised by test cases are functional;
// others panic so any accidental call fails the test loudly.

type stubDataplane struct {
	policy    dataplane.DataplanePolicy
	effective map[string]dataplane.DataplanePolicy
}

func newStubDataplane() *stubDataplane {
	return &stubDataplane{policy: dataplane.DefaultDataplanePolicy(), effective: map[string]dataplane.DataplanePolicy{}}
}

func (s *stubDataplane) NoteUserActivity()                           {}
func (s *stubDataplane) EnsureObservers(_ context.Context, _ string) {}
func (s *stubDataplane) Policy() dataplane.DataplanePolicy           { return s.policy }
func (s *stubDataplane) EffectivePolicy(contextName string) dataplane.DataplanePolicy {
	if s.effective != nil {
		if p, ok := s.effective[contextName]; ok {
			return p
		}
	}
	return s.policy
}
func (s *stubDataplane) SetPolicy(p dataplane.DataplanePolicy) dataplane.DataplanePolicy {
	s.policy = p
	return p
}
func (s *stubDataplane) SchedulerLiveWork() dataplane.SchedulerLiveWork {
	return dataplane.SchedulerLiveWork{}
}
func (s *stubDataplane) SchedulerRunStats() dataplane.SchedulerRunStatsSnapshot {
	return dataplane.SchedulerRunStatsSnapshot{}
}
func (s *stubDataplane) MetricsCapability(_ context.Context, _ string) dataplane.MetricsCapability {
	return dataplane.MetricsCapability{}
}
func (s *stubDataplane) NodeMetricsCachedSnapshot(_ string) (dataplane.NodeMetricsSnapshot, bool) {
	return dataplane.NodeMetricsSnapshot{}, false
}
func (s *stubDataplane) PodMetricsCachedSnapshot(_, _ string) (dataplane.PodMetricsSnapshot, bool) {
	return dataplane.PodMetricsSnapshot{}, false
}
func (s *stubDataplane) SearchCachedResources(_ context.Context, _ string, _ string, _, _ int) (dataplane.CachedResourceSearch, error) {
	return dataplane.CachedResourceSearch{}, nil
}
func (s *stubDataplane) PersistenceMigrationStatus() dataplane.PersistenceMigrationStatus {
	return dataplane.PersistenceMigrationStatus{Phase: dataplane.PersistenceMigrationPhaseDone}
}
func (s *stubDataplane) NamespaceListEnrichmentPoll(_ string, _ uint64) dataplane.NamespaceListEnrichmentPoll {
	return dataplane.NamespaceListEnrichmentPoll{}
}
func (s *stubDataplane) BeginNamespaceListProgressiveEnrichment(_ string, _ []dto.NamespaceListItemDTO, _ dataplane.NamespaceEnrichHints) uint64 {
	return 0
}
func (s *stubDataplane) MergeCachedNamespaceRowProjection(_ context.Context, _ string, items []dto.NamespaceListItemDTO) ([]dto.NamespaceListItemDTO, int) {
	return items, 0
}

// Snapshot stubs — all return empty snapshots (won't be reached in validation tests).

func (s *stubDataplane) PlaneForCluster(_ context.Context, _ string) (dataplane.ClusterPlane, error) {
	panic("stubDataplane: PlaneForCluster not implemented")
}
func (s *stubDataplane) DefaultProfile() dataplane.Profile { return "" }
func (s *stubDataplane) DefaultDiscoveryMode() dataplane.DiscoveryMode {
	return ""
}
func (s *stubDataplane) NamespacesSnapshot(_ context.Context, _ string) (dataplane.NamespaceSnapshot, error) {
	panic("stubDataplane: NamespacesSnapshot")
}
func (s *stubDataplane) NodesSnapshot(_ context.Context, _ string) (dataplane.NodesSnapshot, error) {
	panic("stubDataplane: NodesSnapshot")
}
func (s *stubDataplane) DerivedNodesSnapshot(_ context.Context, _ string) (dataplane.NodesSnapshot, error) {
	panic("stubDataplane: DerivedNodesSnapshot")
}
func (s *stubDataplane) DerivedNodeDetails(_ context.Context, _, _ string) (dto.NodeDetailsDTO, bool, error) {
	panic("stubDataplane: DerivedNodeDetails")
}
func (s *stubDataplane) PersistentVolumesSnapshot(_ context.Context, _ string) (dataplane.PersistentVolumesSnapshot, error) {
	panic("stubDataplane: PersistentVolumesSnapshot")
}
func (s *stubDataplane) ClusterRolesSnapshot(_ context.Context, _ string) (dataplane.ClusterRolesSnapshot, error) {
	panic("stubDataplane: ClusterRolesSnapshot")
}
func (s *stubDataplane) ClusterRoleBindingsSnapshot(_ context.Context, _ string) (dataplane.ClusterRoleBindingsSnapshot, error) {
	panic("stubDataplane: ClusterRoleBindingsSnapshot")
}
func (s *stubDataplane) CRDsSnapshot(_ context.Context, _ string) (dataplane.CRDsSnapshot, error) {
	panic("stubDataplane: CRDsSnapshot")
}
func (s *stubDataplane) PodsSnapshot(_ context.Context, _, _ string) (dataplane.PodsSnapshot, error) {
	panic("stubDataplane: PodsSnapshot")
}
func (s *stubDataplane) DeploymentsSnapshot(_ context.Context, _, _ string) (dataplane.DeploymentsSnapshot, error) {
	panic("stubDataplane: DeploymentsSnapshot")
}
func (s *stubDataplane) ServicesSnapshot(_ context.Context, _, _ string) (dataplane.ServicesSnapshot, error) {
	panic("stubDataplane: ServicesSnapshot")
}
func (s *stubDataplane) IngressesSnapshot(_ context.Context, _, _ string) (dataplane.IngressesSnapshot, error) {
	panic("stubDataplane: IngressesSnapshot")
}
func (s *stubDataplane) PVCsSnapshot(_ context.Context, _, _ string) (dataplane.PVCsSnapshot, error) {
	panic("stubDataplane: PVCsSnapshot")
}
func (s *stubDataplane) ConfigMapsSnapshot(_ context.Context, _, _ string) (dataplane.ConfigMapsSnapshot, error) {
	panic("stubDataplane: ConfigMapsSnapshot")
}
func (s *stubDataplane) SecretsSnapshot(_ context.Context, _, _ string) (dataplane.SecretsSnapshot, error) {
	panic("stubDataplane: SecretsSnapshot")
}
func (s *stubDataplane) ServiceAccountsSnapshot(_ context.Context, _, _ string) (dataplane.ServiceAccountsSnapshot, error) {
	panic("stubDataplane: ServiceAccountsSnapshot")
}
func (s *stubDataplane) RolesSnapshot(_ context.Context, _, _ string) (dataplane.RolesSnapshot, error) {
	panic("stubDataplane: RolesSnapshot")
}
func (s *stubDataplane) RoleBindingsSnapshot(_ context.Context, _, _ string) (dataplane.RoleBindingsSnapshot, error) {
	panic("stubDataplane: RoleBindingsSnapshot")
}
func (s *stubDataplane) HelmReleasesSnapshot(_ context.Context, _, _ string) (dataplane.HelmReleasesSnapshot, error) {
	panic("stubDataplane: HelmReleasesSnapshot")
}
func (s *stubDataplane) DerivedHelmChartsSnapshot(_ context.Context, _ string) (dataplane.Snapshot[dto.HelmChartDTO], error) {
	panic("stubDataplane: DerivedHelmChartsSnapshot")
}
func (s *stubDataplane) DaemonSetsSnapshot(_ context.Context, _, _ string) (dataplane.DaemonSetsSnapshot, error) {
	panic("stubDataplane: DaemonSetsSnapshot")
}
func (s *stubDataplane) StatefulSetsSnapshot(_ context.Context, _, _ string) (dataplane.StatefulSetsSnapshot, error) {
	panic("stubDataplane: StatefulSetsSnapshot")
}
func (s *stubDataplane) ReplicaSetsSnapshot(_ context.Context, _, _ string) (dataplane.ReplicaSetsSnapshot, error) {
	panic("stubDataplane: ReplicaSetsSnapshot")
}
func (s *stubDataplane) JobsSnapshot(_ context.Context, _, _ string) (dataplane.JobsSnapshot, error) {
	panic("stubDataplane: JobsSnapshot")
}
func (s *stubDataplane) CronJobsSnapshot(_ context.Context, _, _ string) (dataplane.CronJobsSnapshot, error) {
	panic("stubDataplane: CronJobsSnapshot")
}
func (s *stubDataplane) HPAsSnapshot(_ context.Context, _, _ string) (dataplane.HPAsSnapshot, error) {
	panic("stubDataplane: HPAsSnapshot")
}
func (s *stubDataplane) ResourceQuotasSnapshot(_ context.Context, _, _ string) (dataplane.ResourceQuotasSnapshot, error) {
	panic("stubDataplane: ResourceQuotasSnapshot")
}
func (s *stubDataplane) LimitRangesSnapshot(_ context.Context, _, _ string) (dataplane.LimitRangesSnapshot, error) {
	panic("stubDataplane: LimitRangesSnapshot")
}
func (s *stubDataplane) NodeMetricsSnapshot(_ context.Context, _ string) (dataplane.NodeMetricsSnapshot, error) {
	panic("stubDataplane: NodeMetricsSnapshot")
}
func (s *stubDataplane) PodMetricsSnapshot(_ context.Context, _, _ string) (dataplane.PodMetricsSnapshot, error) {
	panic("stubDataplane: PodMetricsSnapshot")
}

func (s *stubDataplane) InvalidateHelmReleasesSnapshot(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubDataplane) InvalidateDeploymentsSnapshot(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubDataplane) InvalidateConfigMapsSnapshot(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubDataplane) InvalidateServicesSnapshot(_ context.Context, _, _ string) error  { return nil }
func (s *stubDataplane) InvalidateSecretsSnapshot(_ context.Context, _, _ string) error   { return nil }
func (s *stubDataplane) InvalidateIngressesSnapshot(_ context.Context, _, _ string) error { return nil }
func (s *stubDataplane) InvalidateStatefulSetsSnapshot(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubDataplane) InvalidateDaemonSetsSnapshot(_ context.Context, _, _ string) error {
	return nil
}
func (s *stubDataplane) InvalidateJobsSnapshot(_ context.Context, _, _ string) error { return nil }

func (s *stubDataplane) DashboardSummary(_ context.Context, _ string, _ dataplane.ClusterDashboardListOptions) dataplane.ClusterDashboardSummary {
	panic("stubDataplane: DashboardSummary")
}
func (s *stubDataplane) ListSnapshotRevision(_ context.Context, _ string, _ dataplane.ResourceKind, _ string) (dataplane.ListSnapshotRevisionEnvelope, error) {
	panic("stubDataplane: ListSnapshotRevision")
}
func (s *stubDataplane) NamespaceSummaryProjection(_ context.Context, _, _ string) (dataplane.NamespaceSummaryProjection, error) {
	panic("stubDataplane: NamespaceSummaryProjection")
}
func (s *stubDataplane) NamespaceInsightsProjection(_ context.Context, _, _ string) (dataplane.NamespaceInsightsProjection, error) {
	panic("stubDataplane: NamespaceInsightsProjection")
}
func (s *stubDataplane) ResourceSignals(_ context.Context, _, _, _, _, _ string) (dataplane.ResourceSignalsResult, error) {
	panic("stubDataplane: ResourceSignals")
}

// ── auth middleware ───────────────────────────────────────────────────────────

func TestAuthMiddleware(t *testing.T) {
	_, h := newTestServer(t)

	cases := []struct {
		name       string
		authHeader string
		wantStatus int
	}{
		{"no token", "", http.StatusUnauthorized},
		{"wrong token", "Bearer wrong-token", http.StatusUnauthorized},
		{"raw wrong token", "totally-wrong", http.StatusUnauthorized},
		{"correct bearer", "Bearer " + testToken, http.StatusOK},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestAuthMiddleware_QueryToken(t *testing.T) {
	_, h := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/healthz?token="+testToken, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("query token: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestAuthMiddleware_UnauthorizedBodyShape(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/healthz", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if body["message"] == nil {
		t.Fatalf("expected 'message' key in 401 body, got: %v", body)
	}
}

// ── GET /api/healthz ──────────────────────────────────────────────────────────

func TestHealthz(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/healthz", testToken, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if ok, _ := body["ok"].(bool); !ok {
		t.Errorf("ok: got %v, want true", body["ok"])
	}
	if _, hasCtx := body["activeContext"]; !hasCtx {
		t.Errorf("missing activeContext key: %v", body)
	}
}

// ── GET /api/contexts ─────────────────────────────────────────────────────────

func TestContexts(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/contexts", testToken, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	for _, key := range []string{"active", "contexts", "kubeconfig", "cacheMigration"} {
		if _, ok := body[key]; !ok {
			t.Errorf("missing key %q in response: %v", key, body)
		}
	}
	if body["active"] != "test-context" {
		t.Errorf("active: got %v, want test-context", body["active"])
	}
}

// ── POST /api/context/select ──────────────────────────────────────────────────

func TestContextSelect(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{"invalid json", []byte("{bad"), http.StatusBadRequest},
		{"empty name", []byte(`{"name":""}`), http.StatusBadRequest},
		{"unknown context", []byte(`{"name":"nonexistent-context"}`), http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/context/select", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestContextSelect_HappyPath(t *testing.T) {
	_, h := newTestServer(t)
	body, _ := json.Marshal(map[string]string{"name": "test-context"})
	rec := doReq(t, h, http.MethodPost, "/api/context/select", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	resp := mustDecodeJSON(t, rec.Body.Bytes())
	if resp["active"] != "test-context" {
		t.Errorf("active: got %v, want test-context", resp["active"])
	}
}

// ── GET /api/sessions ────────────────────────────────────────────────────────

func TestGetSessions_Empty(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/sessions", testToken, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if _, ok := body["items"]; !ok {
		t.Errorf("missing 'items' key: %v", body)
	}
}

// ── POST /api/sessions ───────────────────────────────────────────────────────

func TestPostSessions(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{
			"invalid json",
			[]byte("{bad"),
			http.StatusBadRequest,
		},
		{
			"unsupported type",
			toJSON(t, map[string]any{"type": "exec", "title": "test"}),
			http.StatusBadRequest,
		},
		{
			"terminal type",
			toJSON(t, map[string]any{"type": "terminal", "title": "my-shell", "targetCluster": "test-context"}),
			http.StatusOK,
		},
		{
			"portforward type",
			toJSON(t, map[string]any{"type": "portforward", "title": "pf"}),
			http.StatusOK,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/sessions", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestPostSessions_ResponseShape(t *testing.T) {
	_, h := newTestServer(t)
	body := toJSON(t, map[string]any{"type": "terminal", "title": "shell", "targetCluster": "test-context"})
	rec := doReq(t, h, http.MethodPost, "/api/sessions", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d (body=%s)", rec.Code, rec.Body.String())
	}
	resp := mustDecodeJSON(t, rec.Body.Bytes())
	item, ok := resp["item"].(map[string]any)
	if !ok {
		t.Fatalf("missing or wrong 'item' in response: %v", resp)
	}
	if item["id"] == nil || item["id"] == "" {
		t.Errorf("item.id should be set, got: %v", item["id"])
	}
	if item["type"] != "terminal" {
		t.Errorf("item.type: got %v, want terminal", item["type"])
	}
}

// ── GET /api/sessions/{id} ───────────────────────────────────────────────────

func TestGetSessionByID(t *testing.T) {
	s, h := newTestServer(t)

	// Create a session to look up.
	created, err := s.sessions.Create(context.Background(), session.Session{
		Type:   session.TypeTerminal,
		Title:  "lookup-test",
		Status: session.StatusRunning,
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	cases := []struct {
		name       string
		id         string
		wantStatus int
	}{
		{"found", created.ID, http.StatusOK},
		{"not found", "sess-nonexistent", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doReq(t, h, http.MethodGet, "/api/sessions/"+tc.id, testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestGetSessionByID_FoundShape(t *testing.T) {
	s, h := newTestServer(t)
	created, err := s.sessions.Create(context.Background(), session.Session{
		Type:  session.TypePortForward,
		Title: "pf-session",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	rec := doReq(t, h, http.MethodGet, "/api/sessions/"+created.ID, testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d", rec.Code)
	}
	resp := mustDecodeJSON(t, rec.Body.Bytes())
	item, ok := resp["item"].(map[string]any)
	if !ok {
		t.Fatalf("missing 'item': %v", resp)
	}
	if item["id"] != created.ID {
		t.Errorf("item.id: got %v, want %s", item["id"], created.ID)
	}
}

// ── DELETE /api/sessions/{id} ────────────────────────────────────────────────

func TestDeleteSession(t *testing.T) {
	s, h := newTestServer(t)
	created, err := s.sessions.Create(context.Background(), session.Session{
		Type:   session.TypeTerminal,
		Title:  "to-delete",
		Status: session.StatusRunning,
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	cases := []struct {
		name       string
		id         string
		wantStatus int
	}{
		{"existing", created.ID, http.StatusOK},
		{"already deleted", created.ID, http.StatusNotFound},
		{"never existed", "sess-ghost", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doReq(t, h, http.MethodDelete, "/api/sessions/"+tc.id, testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestDeleteSession_OKShape(t *testing.T) {
	s, h := newTestServer(t)
	created, _ := s.sessions.Create(context.Background(), session.Session{
		Type:  session.TypeTerminal,
		Title: "x",
	})
	rec := doReq(t, h, http.MethodDelete, "/api/sessions/"+created.ID, testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if ok, _ := body["ok"].(bool); !ok {
		t.Errorf("body.ok: got %v, want true", body["ok"])
	}
}

// ── POST /api/sessions/terminal ──────────────────────────────────────────────

func TestPostSessionsTerminal_Validation(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{
			"invalid json",
			[]byte("{bad"),
			http.StatusBadRequest,
		},
		{
			"missing namespace",
			toJSON(t, map[string]any{"pod": "my-pod", "container": "app"}),
			http.StatusBadRequest,
		},
		{
			"missing pod",
			toJSON(t, map[string]any{"namespace": "default", "container": "app"}),
			http.StatusBadRequest,
		},
		{
			"whitespace-only namespace",
			toJSON(t, map[string]any{"namespace": "   ", "pod": "my-pod"}),
			http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/sessions/terminal", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── POST /api/sessions/portforward ──────────────────────────────────────────

func TestPostSessionsPortforward_Validation(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{
			"invalid json",
			[]byte("{bad"),
			http.StatusBadRequest,
		},
		{
			"missing namespace",
			toJSON(t, map[string]any{"pod": "my-pod", "remotePort": 8080}),
			http.StatusBadRequest,
		},
		{
			"missing pod and service",
			toJSON(t, map[string]any{"namespace": "default", "remotePort": 8080}),
			http.StatusBadRequest,
		},
		{
			"remotePort zero",
			toJSON(t, map[string]any{"namespace": "default", "pod": "my-pod", "remotePort": 0}),
			http.StatusBadRequest,
		},
		{
			"remotePort negative",
			toJSON(t, map[string]any{"namespace": "default", "pod": "my-pod", "remotePort": -1}),
			http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/sessions/portforward", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── GET /api/activity ────────────────────────────────────────────────────────

func TestGetActivity(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/activity", testToken, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if _, ok := body["items"]; !ok {
		t.Errorf("missing 'items' key: %v", body)
	}
}

// ── GET /api/activity/{id}/logs ──────────────────────────────────────────────

func TestGetActivityLogs(t *testing.T) {
	cases := []struct {
		name       string
		id         string
		wantStatus int
	}{
		{"runtime activity", runtime.RuntimeActivityID, http.StatusOK},
		{"unknown activity", "some-worker", http.StatusNotFound},
		{"empty id is skipped by chi routing", "", http.StatusNotFound}, // chi strips trailing slashes
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.id == "" {
				return // chi doesn't match empty param
			}
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodGet, "/api/activity/"+tc.id+"/logs", testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestGetActivityLogs_RuntimeShape(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/activity/runtime/logs", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if _, ok := body["items"]; !ok {
		t.Errorf("missing 'items': %v", body)
	}
}

// ── GET /api/dataplane/work/live ─────────────────────────────────────────────

func TestGetDataplaneWorkLive(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/dataplane/work/live", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

// ── GET /api/dataplane/config ────────────────────────────────────────────────

func TestGetDataplaneConfig(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/dataplane/config", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if _, ok := body["item"]; !ok {
		t.Errorf("missing 'item' key: %v", body)
	}
}

// ── POST /api/dataplane/config ───────────────────────────────────────────────

func TestPostDataplaneConfig(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{"invalid json", []byte("{bad"), http.StatusBadRequest},
		{"valid empty object", []byte(`{}`), http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/dataplane/config", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── GET /api/dataplane/metrics/status ────────────────────────────────────────

func TestGetDataplaneMetricsStatus(t *testing.T) {
	s, h := newTestServer(t)
	metricsOff := dataplane.DefaultDataplanePolicy()
	metricsOff.Metrics.Enabled = false
	s.dp.(*stubDataplane).effective["test-context"] = metricsOff
	rec := doReq(t, h, http.MethodGet, "/api/dataplane/metrics/status", testToken, nil)
	// This endpoint always returns 200 by design (see comment in handler).
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	for _, key := range []string{"active", "enabled", "capability"} {
		if _, ok := body[key]; !ok {
			t.Errorf("missing key %q: %v", key, body)
		}
	}
	if enabled, _ := body["enabled"].(bool); enabled {
		t.Fatalf("expected metrics disabled for resolved test-context policy")
	}
}

func TestDataplaneConfigAndMetricsStatusResolvePerContextPolicy(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	manual := dataplane.DefaultDataplanePolicy()
	manual.Profile = dataplane.DataplaneProfileManual
	manual.Metrics.Enabled = false
	wide := dataplane.DefaultDataplanePolicy()
	wide.Profile = dataplane.DataplaneProfileWide
	wide.Metrics.Enabled = true
	dp.effective["ctx-a"] = manual
	dp.effective["ctx-b"] = wide

	recA := doReqWithHeader(t, h, http.MethodGet, "/api/dataplane/config", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "ctx-a",
	}, nil)
	if recA.Code != http.StatusOK {
		t.Fatalf("ctx-a dataplane/config status: got %d", recA.Code)
	}
	bodyA := mustDecodeJSON(t, recA.Body.Bytes())
	itemA, ok := bodyA["item"].(map[string]any)
	if !ok {
		t.Fatalf("ctx-a missing item payload: %v", bodyA)
	}
	if profile, _ := itemA["profile"].(string); profile != string(dataplane.DataplaneProfileManual) {
		t.Fatalf("ctx-a profile: got %q want %q", profile, dataplane.DataplaneProfileManual)
	}
	metricsA, ok := itemA["metrics"].(map[string]any)
	if !ok {
		t.Fatalf("ctx-a missing metrics payload: %v", itemA)
	}
	if enabled, _ := metricsA["enabled"].(bool); enabled {
		t.Fatalf("ctx-a expected metrics disabled")
	}

	recB := doReqWithHeader(t, h, http.MethodGet, "/api/dataplane/metrics/status", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "ctx-b",
	}, nil)
	if recB.Code != http.StatusOK {
		t.Fatalf("ctx-b dataplane/metrics/status status: got %d", recB.Code)
	}
	bodyB := mustDecodeJSON(t, recB.Body.Bytes())
	if active, _ := bodyB["active"].(string); active != "ctx-b" {
		t.Fatalf("ctx-b active context: got %q", active)
	}
	if enabled, _ := bodyB["enabled"].(bool); !enabled {
		t.Fatalf("ctx-b expected metrics enabled")
	}
}

// ── GET /api/dataplane/revision ──────────────────────────────────────────────

func TestGetDataplaneRevision_BadParams(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"missing kind", "", http.StatusBadRequest},
		{"unknown kind", "?kind=unknownkind", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodGet, "/api/dataplane/revision"+tc.query, testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestGetDataplaneRevision_BadParamShape(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/dataplane/revision?kind=bad", testToken, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", rec.Code)
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if body["error"] == nil {
		t.Errorf("missing 'error' in response: %v", body)
	}
}

// ── GET /api/namespaces/enrichment ───────────────────────────────────────────

func TestGetNamespacesEnrichment_BadParams(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"missing revision", "", http.StatusBadRequest},
		{"revision zero", "?revision=0", http.StatusBadRequest},
		{"non-numeric revision", "?revision=abc", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodGet, "/api/namespaces/enrichment"+tc.query, testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── GET /api/customresources/resolve ─────────────────────────────────────────

func TestCustomResourcesResolve_MissingParams(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"missing both", "", http.StatusBadRequest},
		{"missing kind", "?group=apps", http.StatusBadRequest},
		{"missing group", "?kind=Foo", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodGet, "/api/customresources/resolve"+tc.query, testToken, nil)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── POST /api/capabilities ───────────────────────────────────────────────────

func TestPostCapabilities_Validation(t *testing.T) {
	cases := []struct {
		name       string
		headers    map[string]string
		body       []byte
		wantStatus int
	}{
		{
			"missing X-Kview-Context header",
			map[string]string{"Authorization": "Bearer " + testToken},
			toJSON(t, map[string]any{"resource": "pods", "group": ""}),
			http.StatusBadRequest,
		},
		{
			"missing resource in body",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			toJSON(t, map[string]any{"group": "apps"}),
			http.StatusBadRequest,
		},
		{
			"invalid json body",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			[]byte("{bad"),
			http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/capabilities", tc.headers, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── POST /api/actions ────────────────────────────────────────────────────────

func TestPostActions_Validation(t *testing.T) {
	cases := []struct {
		name       string
		headers    map[string]string
		body       []byte
		wantStatus int
	}{
		{
			"missing X-Kview-Context header",
			map[string]string{"Authorization": "Bearer " + testToken},
			toJSON(t, map[string]any{"resource": "pods", "action": "delete"}),
			http.StatusBadRequest,
		},
		{
			"missing resource",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			toJSON(t, map[string]any{"action": "delete"}),
			http.StatusBadRequest,
		},
		{
			"missing action",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			toJSON(t, map[string]any{"resource": "pods"}),
			http.StatusBadRequest,
		},
		{
			"invalid json body",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			[]byte("{bad"),
			http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/actions", tc.headers, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── POST /api/namespaces/{ns}/job-runs/debug ─────────────────────────────────

func TestPostJobRunsDebug_Validation(t *testing.T) {
	cases := []struct {
		name       string
		headers    map[string]string
		body       []byte
		wantStatus int
	}{
		{
			"missing X-Kview-Context header",
			map[string]string{"Authorization": "Bearer " + testToken},
			toJSON(t, map[string]any{"kind": "Job", "name": "my-job"}),
			http.StatusBadRequest,
		},
		{
			"invalid json body",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			[]byte("{bad"),
			http.StatusBadRequest,
		},
		{
			"unsupported kind",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			toJSON(t, map[string]any{"kind": "Deployment", "name": "my-deploy"}),
			http.StatusBadRequest,
		},
		{
			"missing name",
			map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			toJSON(t, map[string]any{"kind": "Job"}),
			http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/namespaces/default/job-runs/debug", tc.headers, tc.body)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ── DELETE /api/job-runs/{id} ────────────────────────────────────────────────

func TestDeleteJobRun(t *testing.T) {
	_, h := newTestServer(t)
	// The handler is best-effort (calls s.jobRuns.Close which is a no-op for unknown IDs).
	rec := doReq(t, h, http.MethodDelete, "/api/job-runs/nonexistent-run", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}

// ── GET /api/dataplane/signals/catalog ───────────────────────────────────────

func TestGetDataplaneSignalsCatalog(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/dataplane/signals/catalog", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	for _, key := range []string{"active", "items"} {
		if _, ok := body[key]; !ok {
			t.Errorf("missing key %q: %v", key, body)
		}
	}
}

// ── per-resource signals — unknown kind ──────────────────────────────────────

func TestGetNamespaceResourceSignals_UnknownKind(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/namespaces/default/unknownkind/my-resource/signals", testToken, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestGetClusterResourceSignals_UnknownKind(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/cluster/unknownkind/my-resource/signals", testToken, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
}

// ── JSON Content-Type ─────────────────────────────────────────────────────────

func TestResponseContentType(t *testing.T) {
	_, h := newTestServer(t)
	rec := doReq(t, h, http.MethodGet, "/api/healthz", testToken, nil)
	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type: got %q, want application/json", ct)
	}
}

// ── helper ───────────────────────────────────────────────────────────────────

func toJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}
