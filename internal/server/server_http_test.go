package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/jobdebug"
	"github.com/korex-labs/kview/v5/internal/runtime"
	"github.com/korex-labs/kview/v5/internal/session"
	"github.com/korex-labs/kview/v5/internal/viewmeta"
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

func TestPerformanceSnapshotRequiresAuth(t *testing.T) {
	_, h := newTestServer(t)

	rec := doReq(t, h, http.MethodGet, "/api/performance/snapshot", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestPerformanceSnapshotReturnsRuntimeStats(t *testing.T) {
	_, h := newTestServer(t)

	rec := doReq(t, h, http.MethodGet, "/api/performance/snapshot", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d body=%s", rec.Code, rec.Body.String())
	}
	var got performanceSnapshotDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Go.Version == "" {
		t.Fatal("missing go version")
	}
	if got.Go.Goroutines <= 0 {
		t.Fatalf("goroutines: got %d", got.Go.Goroutines)
	}
	if got.Memory.SysBytes == 0 {
		t.Fatal("missing memory sys bytes")
	}
}

func TestDashboardSplitEndpointsKeepPayloadsSeparate(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)

	signals := doReq(t, h, http.MethodGet, "/api/dashboard/signals", testToken, nil)
	if signals.Code != http.StatusOK {
		t.Fatalf("signals status: got %d body=%s", signals.Code, signals.Body.String())
	}
	signalsJSON := mustDecodeJSON(t, signals.Body.Bytes())
	signalsItem, _ := signalsJSON["item"].(map[string]any)
	for _, forbidden := range []string{"plane", "resources", "dataplane", "usage"} {
		if _, ok := signalsItem[forbidden]; ok {
			t.Fatalf("signals response contains %q", forbidden)
		}
	}
	if dp.dashboardSignalsCalls != 1 || dp.dashboardDataplaneCalls != 0 {
		t.Fatalf("signals route calls: signals=%d dataplane=%d", dp.dashboardSignalsCalls, dp.dashboardDataplaneCalls)
	}

	dataplaneRec := doReq(t, h, http.MethodGet, "/api/dashboard/dataplane", testToken, nil)
	if dataplaneRec.Code != http.StatusOK {
		t.Fatalf("dataplane status: got %d body=%s", dataplaneRec.Code, dataplaneRec.Body.String())
	}
	dataplaneJSON := mustDecodeJSON(t, dataplaneRec.Body.Bytes())
	dataplaneItem, _ := dataplaneJSON["item"].(map[string]any)
	for _, forbidden := range []string{"signals", "derived"} {
		if _, ok := dataplaneItem[forbidden]; ok {
			t.Fatalf("dataplane response contains %q", forbidden)
		}
	}
	if dp.dashboardSignalsCalls != 1 || dp.dashboardDataplaneCalls != 1 {
		t.Fatalf("split route calls: signals=%d dataplane=%d", dp.dashboardSignalsCalls, dp.dashboardDataplaneCalls)
	}
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
	mu                      sync.Mutex
	policy                  dataplane.DataplanePolicy
	bundle                  dataplane.DataplanePolicyBundle
	effective               map[string]dataplane.DataplanePolicy
	acks                    map[string]dataplane.SignalAcknowledgementRecord
	suppressions            map[string]dataplane.SignalSuppressionRecord
	history                 map[string]dataplane.SignalHistoryRecord
	dashboardSignalsCalls   int
	dashboardDataplaneCalls int
	resourceSignalsResult   dataplane.ResourceSignalsResult
	suppressCalls           []stubSuppressCall
	unsuppressCalls         []stubUnsuppressCall
	suppressionExportCalls  []string
	suppressionImportCalls  []stubSuppressionImportCall
	suppressionResetCalls   []stubSuppressionResetCall
	suppressionImportResult *dataplane.SignalSuppressionImportResult
	suppressErr             error
	unsuppressErr           error
	suppressionImportErr    error
	suppressionResetErr     error
}

type stubSuppressCall struct {
	contextName string
	request     dataplane.SignalSuppressionRequest
}

type stubUnsuppressCall struct {
	contextName string
	historyKey  string
}

type stubSuppressionImportCall struct {
	contextName string
	items       map[string]dataplane.SignalSuppressionRecord
	strategy    string
}

type stubSuppressionResetCall struct {
	contextName string
	historyKey  string
}

func newStubDataplane() *stubDataplane {
	bundle := dataplane.DefaultDataplanePolicyBundle()
	return &stubDataplane{policy: bundle.Global, bundle: bundle, effective: map[string]dataplane.DataplanePolicy{}, acks: map[string]dataplane.SignalAcknowledgementRecord{}, suppressions: map[string]dataplane.SignalSuppressionRecord{}, history: map[string]dataplane.SignalHistoryRecord{}}
}

func (s *stubDataplane) NoteUserActivity()                                       {}
func (s *stubDataplane) EnsureObservers(_ context.Context, _ string)             {}
func (s *stubDataplane) WarmClusterBackground(_ context.Context, _ string) error { return nil }
func (s *stubDataplane) Policy() dataplane.DataplanePolicy                       { return s.policy }
func (s *stubDataplane) PolicyBundle() dataplane.DataplanePolicyBundle {
	return s.bundle
}
func (s *stubDataplane) EffectivePolicy(contextName string) dataplane.DataplanePolicy {
	if s.effective != nil {
		if p, ok := s.effective[contextName]; ok {
			return p
		}
	}
	return s.bundle.EffectivePolicy(contextName)
}
func (s *stubDataplane) SetPolicy(p dataplane.DataplanePolicy) dataplane.DataplanePolicy {
	s.bundle.Global = p
	s.policy = p
	return s.bundle.Global
}
func (s *stubDataplane) SetPolicyBundle(bundle dataplane.DataplanePolicyBundle) dataplane.DataplanePolicyBundle {
	s.bundle = dataplane.ValidateDataplanePolicyBundle(bundle)
	s.policy = s.bundle.Global
	return s.bundle
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
func (s *stubDataplane) AcknowledgeSignal(clusterName string, req dataplane.SignalAcknowledgementRequest) (dataplane.SignalAcknowledgementRecord, error) {
	rec := dataplane.SignalAcknowledgementRecord{AcknowledgedAt: time.Now().UTC().Unix(), Comment: strings.TrimSpace(req.Comment), UpdatedAt: time.Now().UTC().Unix()}
	s.acks[clusterName+"\x00"+req.HistoryKey] = rec
	return rec, nil
}
func (s *stubDataplane) UnacknowledgeSignal(clusterName, historyKey string) error {
	delete(s.acks, clusterName+"\x00"+historyKey)
	return nil
}
func (s *stubDataplane) ExportSignalAcknowledgements(clusterName string) map[string]dataplane.SignalAcknowledgementRecord {
	out := map[string]dataplane.SignalAcknowledgementRecord{}
	prefix := clusterName + "\x00"
	for key, rec := range s.acks {
		if strings.HasPrefix(key, prefix) {
			out[strings.TrimPrefix(key, prefix)] = rec
		}
	}
	return out
}
func (s *stubDataplane) ImportSignalAcknowledgements(clusterName string, incoming map[string]dataplane.SignalAcknowledgementRecord, strategy string) (dataplane.SignalAcknowledgementImportResult, error) {
	result := dataplane.SignalAcknowledgementImportResult{}
	prefix := clusterName + "\x00"
	if strategy == "replaceSections" {
		for key := range s.acks {
			if strings.HasPrefix(key, prefix) {
				delete(s.acks, key)
				result.Replaced++
			}
		}
	}
	for historyKey, rec := range incoming {
		key := prefix + historyKey
		if _, ok := s.acks[key]; ok && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		s.acks[key] = rec
		result.Imported++
	}
	return result, nil
}
func (s *stubDataplane) SuppressSignal(clusterName string, req dataplane.SignalSuppressionRequest) (dataplane.SignalSuppressionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.suppressCalls = append(s.suppressCalls, stubSuppressCall{contextName: clusterName, request: req})
	if s.suppressErr != nil {
		return dataplane.SignalSuppressionRecord{}, s.suppressErr
	}
	now := time.Now().UTC().Unix()
	rec := dataplane.SignalSuppressionRecord{
		Mode:                req.Mode,
		CreatedAt:           now,
		UpdatedAt:           now,
		BaselineFingerprint: req.BaselineFingerprint,
		FingerprintVersion:  dataplane.SignalFingerprintVersion,
		Comment:             req.Comment,
	}
	if req.DurationSeconds > 0 {
		rec.ExpiresAt = now + req.DurationSeconds
	}
	s.suppressions[clusterName+"\x00"+req.HistoryKey] = rec
	return rec, nil
}
func (s *stubDataplane) UnsuppressSignal(clusterName, historyKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.unsuppressCalls = append(s.unsuppressCalls, stubUnsuppressCall{contextName: clusterName, historyKey: historyKey})
	if s.unsuppressErr != nil {
		return s.unsuppressErr
	}
	delete(s.suppressions, clusterName+"\x00"+historyKey)
	return nil
}
func (s *stubDataplane) ExportSignalSuppressions(clusterName string) map[string]dataplane.SignalSuppressionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.suppressionExportCalls = append(s.suppressionExportCalls, clusterName)
	out := map[string]dataplane.SignalSuppressionRecord{}
	prefix := clusterName + "\x00"
	for key, rec := range s.suppressions {
		if strings.HasPrefix(key, prefix) {
			out[strings.TrimPrefix(key, prefix)] = rec
		}
	}
	return out
}
func (s *stubDataplane) ImportSignalSuppressions(clusterName string, incoming map[string]dataplane.SignalSuppressionRecord, strategy string) (dataplane.SignalSuppressionImportResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	copied := make(map[string]dataplane.SignalSuppressionRecord, len(incoming))
	for key, rec := range incoming {
		copied[key] = rec
	}
	s.suppressionImportCalls = append(s.suppressionImportCalls, stubSuppressionImportCall{contextName: clusterName, items: copied, strategy: strategy})
	if s.suppressionImportErr != nil {
		return dataplane.SignalSuppressionImportResult{}, s.suppressionImportErr
	}
	if s.suppressionImportResult != nil {
		return *s.suppressionImportResult, nil
	}
	result := dataplane.SignalSuppressionImportResult{}
	prefix := clusterName + "\x00"
	if strategy == "replaceSections" {
		for key := range s.suppressions {
			if strings.HasPrefix(key, prefix) {
				delete(s.suppressions, key)
				result.Replaced++
			}
		}
	}
	for historyKey, rec := range incoming {
		key := prefix + historyKey
		if _, ok := s.suppressions[key]; ok && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		s.suppressions[key] = rec
		result.Imported++
	}
	return result, nil
}
func (s *stubDataplane) ResetSignalSuppressions(clusterName, historyKey string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.suppressionResetCalls = append(s.suppressionResetCalls, stubSuppressionResetCall{contextName: clusterName, historyKey: historyKey})
	if s.suppressionResetErr != nil {
		return 0, s.suppressionResetErr
	}
	if historyKey != "" {
		key := clusterName + "\x00" + historyKey
		if _, ok := s.suppressions[key]; ok {
			delete(s.suppressions, key)
			return 1, nil
		}
		return 0, nil
	}
	removed := 0
	prefix := clusterName + "\x00"
	for key := range s.suppressions {
		if strings.HasPrefix(key, prefix) {
			delete(s.suppressions, key)
			removed++
		}
	}
	return removed, nil
}
func (s *stubDataplane) ExportSignalHistory(clusterName string) map[string]dataplane.SignalHistoryRecord {
	out := map[string]dataplane.SignalHistoryRecord{}
	prefix := clusterName + "\x00"
	for key, rec := range s.history {
		if strings.HasPrefix(key, prefix) {
			out[strings.TrimPrefix(key, prefix)] = rec
		}
	}
	return out
}
func (s *stubDataplane) ImportSignalHistory(clusterName string, incoming map[string]dataplane.SignalHistoryRecord, strategy string) (dataplane.SignalHistoryImportResult, error) {
	result := dataplane.SignalHistoryImportResult{}
	prefix := clusterName + "\x00"
	if strategy == "replaceSections" {
		for key := range s.history {
			if strings.HasPrefix(key, prefix) {
				delete(s.history, key)
				result.Replaced++
			}
		}
	}
	for historyKey, rec := range incoming {
		key := prefix + historyKey
		if _, ok := s.history[key]; ok && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		s.history[key] = rec
		result.Imported++
	}
	return result, nil
}
func (s *stubDataplane) ResetSignalHistory(clusterName, historyKey string) (int, error) {
	prefix := clusterName + "\x00"
	deleted := 0
	for key := range s.history {
		if strings.HasPrefix(key, prefix) && (historyKey == "" || key == prefix+historyKey) {
			delete(s.history, key)
			deleted++
		}
	}
	return deleted, nil
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
func (s *stubDataplane) NamespaceListEnrichmentPollSince(_ string, _ uint64, _ uint64) dataplane.NamespaceListEnrichmentPoll {
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
func (s *stubDataplane) ClusterCustomResourcesSnapshot(_ context.Context, _ string) (dataplane.CustomResourcesSnapshot, error) {
	panic("stubDataplane: ClusterCustomResourcesSnapshot")
}
func (s *stubDataplane) PodsSnapshot(_ context.Context, _, _ string) (dataplane.PodsSnapshot, error) {
	panic("stubDataplane: PodsSnapshot")
}
func (s *stubDataplane) CustomResourcesSnapshot(_ context.Context, _, _ string) (dataplane.CustomResourcesSnapshot, error) {
	panic("stubDataplane: CustomResourcesSnapshot")
}

func (s *stubDataplane) InvalidateClusterCustomResourcesSnapshot(_ context.Context, _ string) error {
	return nil
}

func (s *stubDataplane) InvalidateCustomResourcesSnapshot(_ context.Context, _, _ string) error {
	return nil
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
func (s *stubDataplane) NetworkPoliciesSnapshot(_ context.Context, _, _ string) (dataplane.NetworkPoliciesSnapshot, error) {
	panic("stubDataplane: NetworkPoliciesSnapshot")
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
	return dataplane.NodeMetricsSnapshot{}, nil
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
func (s *stubDataplane) DashboardSignalsSummary(_ context.Context, _ string, _ dataplane.ClusterDashboardListOptions) dataplane.ClusterDashboardSignalsSummary {
	s.dashboardSignalsCalls++
	return dataplane.ClusterDashboardSignalsSummary{}
}
func (s *stubDataplane) DashboardDataplaneSummary(_ context.Context, _ string) dataplane.ClusterDashboardDataplaneSummary {
	s.dashboardDataplaneCalls++
	return dataplane.ClusterDashboardDataplaneSummary{}
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
	return s.resourceSignalsResult, nil
}
func (s *stubDataplane) PreviewSignalExclusions(_ context.Context, _ string, signalType string, exclusions dataplane.SignalExclusionSet) (dataplane.SignalExclusionPreviewResult, error) {
	bundle := dataplane.DefaultDataplanePolicyBundle()
	bundle.Global.Signals.Overrides = map[string]dataplane.SignalOverride{signalType: {Exclusions: &exclusions}}
	if err := dataplane.ValidateSignalExclusions(bundle); err != nil {
		return dataplane.SignalExclusionPreviewResult{}, err
	}
	return dataplane.SignalExclusionPreviewResult{SignalType: signalType, CacheOnly: true}, nil
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

func TestPostSessionsPodDebug_Validation(t *testing.T) {
	validBody := map[string]any{
		"namespace": "default", "pod": "api-0", "expectedUID": "pod-uid",
		"targetContainer": "app", "image": "busybox:1.36", "requestId": "request-1",
	}
	cases := []struct {
		name       string
		headers    map[string]string
		body       []byte
		wantStatus int
	}{
		{
			name:       "missing context header",
			headers:    map[string]string{"Authorization": "Bearer " + testToken},
			body:       toJSON(t, validBody),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid json",
			headers:    map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			body:       []byte("{bad"),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing target container",
			headers:    map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			body:       toJSON(t, map[string]any{"namespace": "default", "pod": "api-0", "expectedUID": "pod-uid", "image": "busybox:1.36", "requestId": "request-1"}),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "unknown field",
			headers:    map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"},
			body:       toJSON(t, map[string]any{"namespace": "default", "pod": "api-0", "expectedUID": "pod-uid", "targetContainer": "app", "image": "busybox:1.36", "requestId": "request-1", "privileged": true}),
			wantStatus: http.StatusBadRequest,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/sessions/pod-debug", tc.headers, tc.body)
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
		{"invalid signal exclusion regex", []byte(`{"global":{"signals":{"overrides":{"pod_restarts":{"exclusions":{"rules":[{"id":"bad","conditions":[{"source":"name","operator":"regex","pattern":"["}]}]}}}}}}`), http.StatusBadRequest},
		{"valid signal exclusion", []byte(`{"global":{"signals":{"overrides":{"pod_restarts":{"exclusions":{"rules":[{"id":"canary","conditions":[{"source":"name","operator":"regex","pattern":"^canary-"}]}]}}}}}}`), http.StatusOK},
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

func TestPostDataplaneSignalExclusionsPreview(t *testing.T) {
	cases := []struct {
		name       string
		body       []byte
		wantStatus int
	}{
		{"valid empty preview", []byte(`{"signalType":"pod_restarts","exclusions":{"rules":[]}}`), http.StatusOK},
		{"invalid regex", []byte(`{"signalType":"pod_restarts","exclusions":{"rules":[{"id":"bad","conditions":[{"source":"name","pattern":"["}]}]}}`), http.StatusBadRequest},
		{"trailing json", []byte(`{"signalType":"pod_restarts","exclusions":{"rules":[]}} {}`), http.StatusBadRequest},
		{"unknown signal", []byte(`{"signalType":"not_real","exclusions":{"rules":[]}}`), http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/dataplane/signals/exclusions/preview", testToken, tc.body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestPostDataplaneConfig_BundlePreservesContextOverrides(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	manual := string(dataplane.DataplaneProfileManual)
	body := toJSON(t, map[string]any{
		"global": map[string]any{
			"profile": "focused",
			"metrics": map[string]any{
				"enabled": true,
			},
		},
		"contextOverrides": map[string]any{
			"ctx-a": map[string]any{
				"metrics": map[string]any{
					"enabled": false,
				},
			},
			"ctx-b": map[string]any{
				"profile": manual,
			},
		},
	})
	rec := doReq(t, h, http.MethodPost, "/api/dataplane/config", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if _, ok := dp.bundle.ContextOverrides["ctx-a"]; !ok {
		t.Fatalf("expected ctx-a override to be stored")
	}
	if _, ok := dp.bundle.ContextOverrides["ctx-b"]; !ok {
		t.Fatalf("expected ctx-b override to be stored")
	}
}

func TestPostDataplaneConfig_LegacyPolicyDoesNotRewriteOverrides(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	manual := dataplane.DataplaneProfileManual
	dp.bundle = dataplane.ValidateDataplanePolicyBundle(dataplane.DataplanePolicyBundle{
		Global: dataplane.DefaultDataplanePolicy(),
		ContextOverrides: map[string]dataplane.DataplanePolicyOverride{
			"ctx-a": {
				Profile: &manual,
			},
		},
	})
	dp.policy = dp.bundle.Global
	body := toJSON(t, map[string]any{
		"profile": "balanced",
	})
	rec := doReq(t, h, http.MethodPost, "/api/dataplane/config", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if _, ok := dp.bundle.ContextOverrides["ctx-a"]; !ok {
		t.Fatalf("expected pre-existing ctx-a override to be preserved")
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
	profileManual := dataplane.DataplaneProfileManual
	metricsOff := false
	dp.bundle = dataplane.ValidateDataplanePolicyBundle(dataplane.DataplanePolicyBundle{
		Global: dataplane.DefaultDataplanePolicy(),
		ContextOverrides: map[string]dataplane.DataplanePolicyOverride{
			"ctx-a": {
				Profile: &profileManual,
				Metrics: &dataplane.MetricsPolicyOverride{Enabled: &metricsOff},
			},
		},
	})
	dp.policy = dp.bundle.Global

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

// ── GET /api/view/resources ──────────────────────────────────────────────────

func TestGetViewResources(t *testing.T) {
	_, h := newTestServer(t)

	rec := doReq(t, h, http.MethodGet, "/api/view/resources", testToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	var body viewmeta.DescriptorBundle
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Resources) == 0 {
		t.Fatal("expected resources")
	}
	if len(body.SidebarGroups) == 0 {
		t.Fatal("expected sidebar groups")
	}
	if !body.Dashboard.SignalViews.Enabled ||
		body.Dashboard.SignalViews.NamePrefix == "" ||
		len(body.Dashboard.SignalViews.State) == 0 ||
		len(body.Dashboard.SignalFilterCategories) == 0 {
		t.Fatalf("expected dashboard view policy: %#v", body.Dashboard)
	}
	if len(body.Actions) == 0 {
		t.Fatal("expected action presentation policy")
	}

	byKey := map[string]viewmeta.ResourceDescriptor{}
	for _, resource := range body.Resources {
		byKey[resource.Key] = resource
	}
	pods, ok := byKey["pods"]
	if !ok {
		t.Fatal("missing pods descriptor")
	}
	if pods.Label != "Pods" || pods.Access.Resource != "pods" {
		t.Fatalf("unexpected pods descriptor: %#v", pods)
	}
	if !pods.ListView.QuickFilters.Search || !pods.ListView.QuickFilters.Tag {
		t.Fatalf("expected pods quick filter policy: %#v", pods.ListView.QuickFilters)
	}
	if pods.ListView.DefaultSort.Field != "name" || pods.ListView.DefaultSort.Direction != "asc" {
		t.Fatalf("expected pods default sort policy: %#v", pods.ListView.DefaultSort)
	}
	if pods.ListView.FilterLabel == "" || len(pods.ListView.Identity) == 0 || len(pods.ListView.SearchFields) == 0 {
		t.Fatalf("expected pods list view defaults: %#v", pods.ListView)
	}
	if !pods.ListView.SavedViews.Enabled ||
		pods.ListView.SavedViews.NamePrefix != "Pods" ||
		len(pods.ListView.SavedViews.Location) == 0 ||
		len(pods.ListView.SavedViews.State) == 0 {
		t.Fatalf("expected pods saved view policy: %#v", pods.ListView.SavedViews)
	}
	helmCharts, ok := byKey["helmcharts"]
	if !ok {
		t.Fatal("missing helmcharts descriptor")
	}
	if !helmCharts.ClusterScoped {
		t.Fatalf("expected helmcharts to be cluster scoped: %#v", helmCharts)
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

func TestReadOnlyBlocksMutationEndpoints(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		path    string
		body    []byte
		headers map[string]string
	}{
		{
			name:   "resource action",
			method: http.MethodPost,
			path:   "/api/actions",
			body:   toJSON(t, map[string]any{"resource": "pods", "action": "pod.delete", "namespace": "default", "name": "pod-1"}),
			headers: map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			},
		},
		{
			name:   "terminal session",
			method: http.MethodPost,
			path:   "/api/sessions/terminal",
			body:   toJSON(t, map[string]any{"namespace": "default", "pod": "pod-1"}),
			headers: map[string]string{
				"Authorization": "Bearer " + testToken,
			},
		},
		{
			name:   "pod debug session",
			method: http.MethodPost,
			path:   "/api/sessions/pod-debug",
			body:   toJSON(t, map[string]any{"namespace": "default", "pod": "pod-1", "expectedUID": "uid", "targetContainer": "app", "image": "busybox:1.36", "requestId": "request-1"}),
			headers: map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			},
		},
		{
			name:   "container command",
			method: http.MethodPost,
			path:   "/api/container-commands/run",
			body:   toJSON(t, map[string]any{"namespace": "default", "pod": "pod-1", "container": "app", "command": "date"}),
			headers: map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			},
		},
		{
			name:   "port forward",
			method: http.MethodPost,
			path:   "/api/sessions/portforward",
			body:   toJSON(t, map[string]any{"namespace": "default", "pod": "pod-1", "remotePort": 8080}),
			headers: map[string]string{
				"Authorization": "Bearer " + testToken,
			},
		},
		{
			name:   "job debug run",
			method: http.MethodPost,
			path:   "/api/namespaces/default/job-runs/debug",
			body:   toJSON(t, map[string]any{"kind": "Job", "name": "job-1"}),
			headers: map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			},
		},
		{
			name:   "job debug stop",
			method: http.MethodPost,
			path:   "/api/job-runs/run-1/stop",
			body:   toJSON(t, map[string]any{}),
			headers: map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			},
		},
		{
			name:   "job debug close",
			method: http.MethodDelete,
			path:   "/api/job-runs/run-1",
			headers: map[string]string{
				"Authorization": "Bearer " + testToken,
			},
		},
		{
			name:   "terminal websocket",
			method: http.MethodGet,
			path:   "/api/sessions/session-1/terminal/ws",
			headers: map[string]string{
				"Authorization": "Bearer " + testToken,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, h := newTestServer(t)
			s.SetReadOnly(true)

			rec := doReqWithHeader(t, h, tc.method, tc.path, tc.headers, tc.body)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, http.StatusForbidden, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), readOnlyMutationMessage) {
				t.Fatalf("body does not mention read-only block: %s", rec.Body.String())
			}
		})
	}
}

func TestReadOnlyAllowsResourceYAMLValidate(t *testing.T) {
	s, h := newTestServer(t)
	s.SetReadOnly(true)
	s.Actions().Register("resource.yaml.validate", func(_ context.Context, _ *cluster.Clients, _ kube.ActionRequest) (*kube.ActionResult, error) {
		return &kube.ActionResult{Status: "validated"}, nil
	})

	rec := doReqWithHeader(t, h, http.MethodPost, "/api/actions", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "test-context",
	}, toJSON(t, map[string]any{
		"resource": "deployments",
		"action":   "resource.yaml.validate",
		"params": map[string]any{
			"yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n",
		},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), readOnlyMutationMessage) {
		t.Fatalf("validate action was blocked in read-only mode: %s", rec.Body.String())
	}
}

func TestReadOnlyAllowsResourcePatchValidate(t *testing.T) {
	s, h := newTestServer(t)
	s.SetReadOnly(true)
	s.Actions().Register("resource.patch.validate", func(_ context.Context, _ *cluster.Clients, _ kube.ActionRequest) (*kube.ActionResult, error) {
		return &kube.ActionResult{Status: "validated"}, nil
	})

	rec := doReqWithHeader(t, h, http.MethodPost, "/api/actions", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "test-context",
	}, toJSON(t, map[string]any{
		"resource": "deployments",
		"action":   "resource.patch.validate",
		"params": map[string]any{
			"manifest":     "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n",
			"baseManifest": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n",
		},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), readOnlyMutationMessage) {
		t.Fatalf("patch validate action was blocked in read-only mode: %s", rec.Body.String())
	}
}

func TestReadOnlyBlocksResourcePatchApply(t *testing.T) {
	s, h := newTestServer(t)
	s.SetReadOnly(true)
	s.Actions().Register("resource.patch.apply", func(_ context.Context, _ *cluster.Clients, _ kube.ActionRequest) (*kube.ActionResult, error) {
		return &kube.ActionResult{Status: "applied"}, nil
	})

	rec := doReqWithHeader(t, h, http.MethodPost, "/api/actions", map[string]string{
		"Authorization":   "Bearer " + testToken,
		"X-Kview-Context": "test-context",
	}, toJSON(t, map[string]any{
		"resource": "deployments",
		"action":   "resource.patch.apply",
		"params": map[string]any{
			"manifest":     "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n",
			"baseManifest": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n",
		},
	}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), readOnlyMutationMessage) {
		t.Fatalf("body does not mention read-only block: %s", rec.Body.String())
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

func TestPostDataplaneSignalAcknowledgement(t *testing.T) {
	s, h := newTestServer(t)
	body := []byte(`{"historyKey":"pod_restarts|namespace|default|Pod|api-0","comment":"known rollout"}`)
	rec := doReq(t, h, http.MethodPost, "/api/dataplane/signals/ack", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if _, ok := s.dp.(*stubDataplane).acks["test-context\x00pod_restarts|namespace|default|Pod|api-0"]; !ok {
		t.Fatalf("acknowledgement was not stored: %+v", s.dp.(*stubDataplane).acks)
	}
}

func TestDeleteDataplaneSignalAcknowledgement(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	dp.acks["test-context\x00pod_restarts|namespace|default|Pod|api-0"] = dataplane.SignalAcknowledgementRecord{AcknowledgedAt: time.Now().UTC().Unix()}
	body := []byte(`{"historyKey":"pod_restarts|namespace|default|Pod|api-0"}`)
	rec := doReq(t, h, http.MethodDelete, "/api/dataplane/signals/ack", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if _, ok := dp.acks["test-context\x00pod_restarts|namespace|default|Pod|api-0"]; ok {
		t.Fatalf("acknowledgement was not deleted: %+v", dp.acks)
	}
}

func TestSignalHistoryExportImportAndReset(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	now := time.Now().UTC().Unix()
	key := "pod_restarts|namespace|default|Pod|api-0"
	dp.history["test-context\x00"+key] = dataplane.SignalHistoryRecord{
		FirstSeenAt:  now - 86400,
		LastSeenAt:   now,
		SeenCount:    2,
		ObservedDays: []int64{now - 86400, now},
	}

	rec := doReq(t, h, http.MethodGet, "/api/dataplane/signals/history/export", testToken, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), key) {
		t.Fatalf("history export: status=%d body=%s", rec.Code, rec.Body.String())
	}

	importBody := toJSON(t, map[string]any{
		"strategy": "useImported",
		"contexts": map[string]any{
			"other-context": map[string]any{
				key: dataplane.SignalHistoryRecord{FirstSeenAt: now, LastSeenAt: now, SeenCount: 1, ObservedDays: []int64{now}},
			},
		},
	})
	rec = doReq(t, h, http.MethodPost, "/api/dataplane/signals/history/import", testToken, importBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("history import: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := dp.history["other-context\x00"+key]; !ok {
		t.Fatalf("imported history missing: %+v", dp.history)
	}

	rec = doReq(t, h, http.MethodPost, "/api/dataplane/signals/history/reset", testToken, []byte(`{}`))
	if rec.Code != http.StatusOK || len(dp.ExportSignalHistory("test-context")) != 0 {
		t.Fatalf("history reset: status=%d body=%s remaining=%+v", rec.Code, rec.Body.String(), dp.history)
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

func TestGetResourceSignals_IncludesSuppressionMetadata(t *testing.T) {
	for _, path := range []string{
		"/api/namespaces/default/pods/api-0/signals",
		"/api/cluster/nodes/worker-0/signals",
	} {
		t.Run(path, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			dp.resourceSignalsResult = dataplane.ResourceSignalsResult{
				Signals:               []dto.NamespaceInsightSignalDTO{},
				SuppressedSignalCount: 1,
				SuppressedSignals: []dto.NamespaceInsightSignalDTO{{
					SignalType:       "pod_restarts",
					HistoryKey:       "pod_restarts|namespace|default|Pod|api-0",
					StateFingerprint: "v1:" + strings.Repeat("a", 64),
				}},
			}

			rec := doReq(t, h, http.MethodGet, path, testToken, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			body := mustDecodeJSON(t, rec.Body.Bytes())
			if got, ok := body["suppressedSignalCount"].(float64); !ok || got != 1 {
				t.Fatalf("suppressedSignalCount = %#v", body["suppressedSignalCount"])
			}
			items, ok := body["suppressedSignals"].([]any)
			if !ok || len(items) != 1 {
				t.Fatalf("suppressedSignals = %#v", body["suppressedSignals"])
			}
			item, _ := items[0].(map[string]any)
			if item["historyKey"] == "" || item["stateFingerprint"] == "" {
				t.Fatalf("suppressed signal identity = %#v", item)
			}
		})
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

// ── signal suppression mutations ─────────────────────────────────────────────

func TestSignalSuppressPostModesAndActiveContext(t *testing.T) {
	fingerprint := "v1:" + strings.Repeat("a", 64)
	tests := []struct {
		name string
		body map[string]any
	}{
		{name: "one hour", body: map[string]any{"historyKey": "key-1h", "mode": dataplane.SignalSuppressionModeSnooze, "durationSeconds": dataplane.SignalSuppressionDurationOneHourSeconds, "comment": " investigating "}},
		{name: "one day", body: map[string]any{"historyKey": "key-1d", "mode": dataplane.SignalSuppressionModeSnooze, "durationSeconds": dataplane.SignalSuppressionDurationOneDaySeconds}},
		{name: "until changed", body: map[string]any{"historyKey": "key-change", "mode": dataplane.SignalSuppressionModeUntilChanged, "baselineFingerprint": fingerprint}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/dataplane/signals/suppress", map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "owned-context",
			}, toJSON(t, tc.body))
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			body := mustDecodeJSON(t, rec.Body.Bytes())
			if body["active"] != "owned-context" || body["historyKey"] != tc.body["historyKey"] {
				t.Fatalf("response identity = %#v", body)
			}
			item, ok := body["item"].(map[string]any)
			if !ok || item["mode"] != tc.body["mode"] || item["createdAt"] == nil || item["updatedAt"] == nil {
				t.Fatalf("response item = %#v", body["item"])
			}
			dp.mu.Lock()
			defer dp.mu.Unlock()
			if len(dp.suppressCalls) != 1 || dp.suppressCalls[0].contextName != "owned-context" || dp.suppressCalls[0].request.HistoryKey != tc.body["historyKey"] {
				t.Fatalf("manager calls = %#v", dp.suppressCalls)
			}
		})
	}
}

func TestSignalSuppressPostReplacesSameKey(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	headers := map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "ctx-replace"}
	for _, duration := range []int64{dataplane.SignalSuppressionDurationOneHourSeconds, dataplane.SignalSuppressionDurationOneDaySeconds} {
		rec := doReqWithHeader(t, h, http.MethodPost, "/api/dataplane/signals/suppress", headers, toJSON(t, map[string]any{
			"historyKey": "same-key", "mode": dataplane.SignalSuppressionModeSnooze, "durationSeconds": duration,
		}))
		if rec.Code != http.StatusOK {
			t.Fatalf("duration %d: status=%d body=%s", duration, rec.Code, rec.Body.String())
		}
	}
	dp.mu.Lock()
	defer dp.mu.Unlock()
	if len(dp.suppressCalls) != 2 || dp.suppressCalls[1].request.DurationSeconds != dataplane.SignalSuppressionDurationOneDaySeconds {
		t.Fatalf("manager calls = %#v", dp.suppressCalls)
	}
	if got := dp.suppressions["ctx-replace\x00same-key"]; got.ExpiresAt-got.CreatedAt != dataplane.SignalSuppressionDurationOneDaySeconds {
		t.Fatalf("replacement record = %#v", got)
	}
}

func TestSignalSuppressDeleteIsIdempotent(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	dp.suppressions["ctx-delete\x00key"] = dataplane.SignalSuppressionRecord{Mode: dataplane.SignalSuppressionModeSnooze}
	for i := 0; i < 2; i++ {
		rec := doReqWithHeader(t, h, http.MethodDelete, "/api/dataplane/signals/suppress", map[string]string{
			"Authorization": "Bearer " + testToken, "X-Kview-Context": "ctx-delete",
		}, []byte(`{"historyKey":"key"}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("delete %d: status=%d body=%s", i, rec.Code, rec.Body.String())
		}
		body := mustDecodeJSON(t, rec.Body.Bytes())
		if body["active"] != "ctx-delete" || body["historyKey"] != "key" || body["deleted"] != true {
			t.Fatalf("delete %d envelope = %#v", i, body)
		}
	}
	dp.mu.Lock()
	defer dp.mu.Unlock()
	if len(dp.unsuppressCalls) != 2 || dp.unsuppressCalls[0] != (stubUnsuppressCall{contextName: "ctx-delete", historyKey: "key"}) {
		t.Fatalf("manager calls = %#v", dp.unsuppressCalls)
	}
}

func TestSignalSuppressMutationValidation(t *testing.T) {
	fingerprint := "v1:" + strings.Repeat("a", 64)
	valid := `{"historyKey":"key","mode":"snooze","durationSeconds":3600}`
	tests := []struct {
		name   string
		method string
		body   []byte
	}{
		{name: "malformed", method: http.MethodPost, body: []byte(`{"historyKey":`)},
		{name: "trailing JSON", method: http.MethodPost, body: []byte(valid + `{}`)},
		{name: "oversized", method: http.MethodPost, body: toJSON(t, map[string]any{"historyKey": strings.Repeat("a", 300<<10), "mode": "snooze", "durationSeconds": 3600})},
		{name: "unknown field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"surprise":true}`)},
		{name: "context field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"context":"victim"}`)},
		{name: "active field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"active":"victim"}`)},
		{name: "createdAt field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"createdAt":1}`)},
		{name: "updatedAt field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"updatedAt":1}`)},
		{name: "expiresAt field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"expiresAt":1}`)},
		{name: "fingerprintVersion field", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600,"fingerprintVersion":1}`)},
		{name: "missing history", method: http.MethodPost, body: []byte(`{"mode":"snooze","durationSeconds":3600}`)},
		{name: "unsupported mode", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"forever"}`)},
		{name: "invalid duration", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":60}`)},
		{name: "bad baseline", method: http.MethodPost, body: []byte(`{"historyKey":"key","mode":"until_changed","baselineFingerprint":"v1:nope"}`)},
		{name: "overlong Unicode key", method: http.MethodPost, body: toJSON(t, map[string]any{"historyKey": strings.Repeat("界", 1025), "mode": "until_changed", "baselineFingerprint": fingerprint})},
		{name: "overlong comment", method: http.MethodPost, body: toJSON(t, map[string]any{"historyKey": "key", "mode": "snooze", "durationSeconds": 3600, "comment": strings.Repeat("界", 2001)})},
		{name: "delete missing history", method: http.MethodDelete, body: []byte(`{}`)},
		{name: "delete overlong Unicode key", method: http.MethodDelete, body: toJSON(t, map[string]any{"historyKey": strings.Repeat("界", 1025)})},
		{name: "delete unknown field", method: http.MethodDelete, body: []byte(`{"historyKey":"key","context":"victim"}`)},
		{name: "delete trailing JSON", method: http.MethodDelete, body: []byte(`{"historyKey":"key"}{}`)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, tc.method, "/api/dataplane/signals/suppress", testToken, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d want=400 body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSignalSuppressMutationsRequireAuth(t *testing.T) {
	_, h := newTestServer(t)
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		rec := doReq(t, h, method, "/api/dataplane/signals/suppress", "", []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600}`))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s status=%d body=%s", method, rec.Code, rec.Body.String())
		}
	}
}

func TestSignalSuppressMutationManagerErrorsAreSanitized(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
	}{{name: "suppress", method: http.MethodPost}, {name: "unsuppress", method: http.MethodDelete}} {
		t.Run(tc.name, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			secretErr := errors.New("sqlite /secret/path failed")
			body := []byte(`{"historyKey":"key"}`)
			if tc.method == http.MethodPost {
				dp.suppressErr = secretErr
				body = []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600}`)
			} else {
				dp.unsuppressErr = secretErr
			}
			rec := doReq(t, h, tc.method, "/api/dataplane/signals/suppress", testToken, body)
			if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), secretErr.Error()) {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSignalSuppressCapacityErrorIsSanitizedBadRequest(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	dp.suppressErr = fmt.Errorf("internal detail: %w", dataplane.ErrSignalSuppressionCapacity)
	rec := doReq(t, h, http.MethodPost, "/api/dataplane/signals/suppress", testToken, []byte(`{"historyKey":"key","mode":"snooze","durationSeconds":3600}`))
	if rec.Code != http.StatusBadRequest || strings.Contains(rec.Body.String(), "internal detail") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSignalSuppressionTransferExportActiveContext(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	record := dataplane.SignalSuppressionRecord{
		Mode: dataplane.SignalSuppressionModeUntilChanged, CreatedAt: 100, UpdatedAt: 200,
		BaselineFingerprint: "v1:" + strings.Repeat("a", 64), FingerprintVersion: dataplane.SignalFingerprintVersion, Comment: "keep identity",
	}
	dp.suppressions["owned-context\x00signal-key"] = record
	dp.suppressions["other-context\x00other-key"] = record
	rec := doReqWithHeader(t, h, http.MethodGet, "/api/dataplane/signals/suppressions/export", map[string]string{
		"Authorization": "Bearer " + testToken, "X-Kview-Context": "owned-context",
	}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	if body["active"] != "owned-context" {
		t.Fatalf("active=%#v", body["active"])
	}
	items, ok := body["items"].(map[string]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items=%#v", body["items"])
	}
	item, ok := items["signal-key"].(map[string]any)
	if !ok || item["mode"] != record.Mode || item["createdAt"] != float64(record.CreatedAt) || item["updatedAt"] != float64(record.UpdatedAt) || item["baselineFingerprint"] != record.BaselineFingerprint || item["fingerprintVersion"] != float64(record.FingerprintVersion) {
		t.Fatalf("exported identity=%#v", items["signal-key"])
	}
	dp.mu.Lock()
	defer dp.mu.Unlock()
	if len(dp.suppressionExportCalls) != 1 || dp.suppressionExportCalls[0] != "owned-context" {
		t.Fatalf("export calls=%#v", dp.suppressionExportCalls)
	}
}

func TestSignalSuppressionTransferImportStrategiesAndActiveContext(t *testing.T) {
	now := time.Now().UTC().Unix()
	fingerprint := "v1:" + strings.Repeat("b", 64)
	items := map[string]dataplane.SignalSuppressionRecord{
		"snoozed": {Mode: dataplane.SignalSuppressionModeSnooze, CreatedAt: now, UpdatedAt: now, ExpiresAt: now + dataplane.SignalSuppressionDurationOneHourSeconds, FingerprintVersion: dataplane.SignalFingerprintVersion},
		"changed": {Mode: dataplane.SignalSuppressionModeUntilChanged, CreatedAt: now, UpdatedAt: now, BaselineFingerprint: fingerprint, FingerprintVersion: dataplane.SignalFingerprintVersion},
	}
	for _, strategy := range []string{"keepMine", "useImported", "replaceSections"} {
		t.Run(strategy, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			wantResult := dataplane.SignalSuppressionImportResult{Imported: 2, Replaced: 1, Skipped: 3}
			dp.suppressionImportResult = &wantResult
			rec := doReqWithHeader(t, h, http.MethodPost, "/api/dataplane/signals/suppressions/import", map[string]string{
				"Authorization": "Bearer " + testToken, "X-Kview-Context": "owned-context",
			}, toJSON(t, map[string]any{"strategy": strategy, "items": items}))
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			body := mustDecodeJSON(t, rec.Body.Bytes())
			result, _ := body["result"].(map[string]any)
			if body["active"] != "owned-context" || result["imported"] != float64(2) || result["replaced"] != float64(1) || result["skipped"] != float64(3) {
				t.Fatalf("response=%#v", body)
			}
			dp.mu.Lock()
			defer dp.mu.Unlock()
			if len(dp.suppressionImportCalls) != 1 {
				t.Fatalf("import calls=%#v", dp.suppressionImportCalls)
			}
			call := dp.suppressionImportCalls[0]
			if call.contextName != "owned-context" || call.strategy != strategy || len(call.items) != 2 || call.items["snoozed"] != items["snoozed"] || call.items["changed"] != items["changed"] {
				t.Fatalf("import call=%#v", call)
			}
		})
	}
}

func TestSignalSuppressionTransferImportManagerSkipsMalformedRecord(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	result := dataplane.SignalSuppressionImportResult{Skipped: 1}
	dp.suppressionImportResult = &result
	rec := doReq(t, h, http.MethodPost, "/api/dataplane/signals/suppressions/import", testToken, []byte(`{"strategy":"keepMine","items":{"bad":{"mode":"forever","createdAt":1,"updatedAt":1,"fingerprintVersion":999}}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := mustDecodeJSON(t, rec.Body.Bytes())
	got, _ := body["result"].(map[string]any)
	if got["skipped"] != float64(1) {
		t.Fatalf("result=%#v", got)
	}
}

func TestSignalSuppressionTransferImportValidation(t *testing.T) {
	valid := `{"strategy":"keepMine","items":{}}`
	tests := []struct {
		name string
		body []byte
	}{
		{name: "malformed", body: []byte(`{"strategy":`)},
		{name: "trailing", body: []byte(valid + `{}`)},
		{name: "unknown", body: []byte(`{"strategy":"keepMine","items":{},"surprise":true}`)},
		{name: "context", body: []byte(`{"strategy":"keepMine","items":{},"context":"victim"}`)},
		{name: "contexts", body: []byte(`{"strategy":"keepMine","items":{},"contexts":{}}`)},
		{name: "active", body: []byte(`{"strategy":"keepMine","items":{},"active":"victim"}`)},
		{name: "invalid strategy", body: []byte(`{"strategy":"merge","items":{}}`)},
		{name: "missing items", body: []byte(`{"strategy":"keepMine"}`)},
		{name: "null items", body: []byte(`{"strategy":"keepMine","items":null}`)},
		{name: "oversized", body: toJSON(t, map[string]any{"strategy": "keepMine", "items": map[string]any{}, "padding": strings.Repeat("x", int(signalSuppressionTransferMaxBodyBytes))})},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodPost, "/api/dataplane/signals/suppressions/import", testToken, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSignalSuppressionTransferResetOptionalEmptyBodyAndContextOwnership(t *testing.T) {
	s, h := newTestServer(t)
	dp := s.dp.(*stubDataplane)
	dp.suppressions["owned-context\x00mine"] = dataplane.SignalSuppressionRecord{Mode: dataplane.SignalSuppressionModeSnooze}
	dp.suppressions["other-context\x00theirs"] = dataplane.SignalSuppressionRecord{Mode: dataplane.SignalSuppressionModeSnooze}
	for i, body := range [][]byte{nil, []byte(`{}`)} {
		rec := doReqWithHeader(t, h, http.MethodDelete, "/api/dataplane/signals/suppressions/reset", map[string]string{
			"Authorization": "Bearer " + testToken, "X-Kview-Context": "owned-context",
		}, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("reset %d status=%d body=%s", i, rec.Code, rec.Body.String())
		}
		response := mustDecodeJSON(t, rec.Body.Bytes())
		if response["active"] != "owned-context" || response["reset"] != true {
			t.Fatalf("reset %d response=%#v", i, response)
		}
	}
	dp.mu.Lock()
	defer dp.mu.Unlock()
	if _, ok := dp.suppressions["other-context\x00theirs"]; !ok || len(dp.suppressionResetCalls) != 2 {
		t.Fatalf("remaining=%#v calls=%#v", dp.suppressions, dp.suppressionResetCalls)
	}
	for _, call := range dp.suppressionResetCalls {
		if call != (stubSuppressionResetCall{contextName: "owned-context", historyKey: ""}) {
			t.Fatalf("reset call=%#v", call)
		}
	}
}

func TestSignalSuppressionTransferResetValidation(t *testing.T) {
	tests := []struct {
		name string
		body []byte
	}{
		{name: "malformed", body: []byte(`{`)},
		{name: "null", body: []byte(`null`)},
		{name: "trailing", body: []byte(`{}{}`)},
		{name: "unknown", body: []byte(`{"surprise":true}`)},
		{name: "context", body: []byte(`{"context":"victim"}`)},
		{name: "contexts", body: []byte(`{"contexts":{}}`)},
		{name: "active", body: []byte(`{"active":"victim"}`)},
		{name: "oversized", body: []byte(`{"padding":"` + strings.Repeat("x", int(signalSuppressionTransferMaxBodyBytes)) + `"}`)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, h := newTestServer(t)
			rec := doReq(t, h, http.MethodDelete, "/api/dataplane/signals/suppressions/reset", testToken, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSignalSuppressionTransferRequiresAuth(t *testing.T) {
	_, h := newTestServer(t)
	for _, route := range []struct {
		method string
		path   string
		body   []byte
	}{
		{http.MethodGet, "/api/dataplane/signals/suppressions/export", nil},
		{http.MethodPost, "/api/dataplane/signals/suppressions/import", []byte(`{"strategy":"keepMine","items":{}}`)},
		{http.MethodDelete, "/api/dataplane/signals/suppressions/reset", nil},
	} {
		rec := doReq(t, h, route.method, route.path, "", route.body)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s status=%d body=%s", route.method, route.path, rec.Code, rec.Body.String())
		}
	}
}

func TestSignalSuppressionTransferUnavailable(t *testing.T) {
	s, _ := newTestServer(t)
	s.dp = nil
	h := chi.NewRouter()
	s.registerActivityAndDataplaneRoutes(h)
	for _, route := range []struct {
		method string
		path   string
		body   []byte
	}{
		{http.MethodGet, "/dataplane/signals/suppressions/export", nil},
		{http.MethodPost, "/dataplane/signals/suppressions/import", []byte(`{"strategy":"keepMine","items":{}}`)},
		{http.MethodDelete, "/dataplane/signals/suppressions/reset", nil},
	} {
		rec := doReq(t, h, route.method, route.path, testToken, route.body)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s status=%d body=%s", route.method, route.path, rec.Code, rec.Body.String())
		}
	}
}

func TestSignalSuppressionTransferManagerErrorsAreSanitized(t *testing.T) {
	secretErr := errors.New("sqlite /secret/path failed")
	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   []byte
	}{
		{name: "import", method: http.MethodPost, path: "/api/dataplane/signals/suppressions/import", body: []byte(`{"strategy":"keepMine","items":{}}`)},
		{name: "reset", method: http.MethodDelete, path: "/api/dataplane/signals/suppressions/reset"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			if tc.name == "import" {
				dp.suppressionImportErr = secretErr
			} else {
				dp.suppressionResetErr = secretErr
			}
			rec := doReq(t, h, tc.method, tc.path, testToken, tc.body)
			if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), secretErr.Error()) {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
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
