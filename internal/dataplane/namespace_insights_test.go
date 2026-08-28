package dataplane

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestNamespaceFallbackSignalsForProblematic(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	now := time.Unix(100, 0)
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now},
		Items: []dto.PodListItemDTO{
			{Name: "bad", Namespace: "app", Phase: "Failed", Ready: "0/1"},
		},
	})

	got := namespaceFallbackSignalsForProblematic(now, "app", []dto.ProblematicResource{
		{Kind: "Pod", Name: "bad", Reason: "Pod failed"},
	}, nil, plane, DefaultDataplanePolicy(), "ctx")
	if len(got) != 1 {
		t.Fatalf("expected one fallback signal, got %+v", got)
	}
	if got[0].Kind != "Pod" || got[0].Namespace != "app" || got[0].Name != "bad" {
		t.Fatalf("unexpected signal identity: %+v", got[0])
	}
	if got[0].SignalType != "resource_needs_attention_fallback" || got[0].HistoryKey == "" {
		t.Fatalf("unexpected fallback signal metadata: %+v", got[0])
	}

	detected := []ClusterDashboardSignal{{
		SignalType: "pod_failed", ResourceKind: "Pod", ResourceName: "bad", Namespace: "app",
		Scope: ResourceSignalsScopeNamespace, ScopeLocation: "app",
	}}
	got = namespaceFallbackSignalsForProblematic(now, "app", []dto.ProblematicResource{
		{Kind: "Pod", Name: "bad", Reason: "Pod failed"},
	}, detected, plane, DefaultDataplanePolicy(), "ctx")
	if len(got) != 0 {
		t.Fatalf("detected resource resurfaced as fallback: %+v", got)
	}
}

func TestNamespaceInsightResourceSignalsFromSignalsIncludesFallback(t *testing.T) {
	items := []dto.NamespaceInsightSignalDTO{
		{
			Kind:          "Pod",
			Namespace:     "app",
			Name:          "bad",
			ResourceKind:  "Pod",
			ResourceName:  "bad",
			Scope:         ResourceSignalsScopeNamespace,
			ScopeLocation: "app",
			Reason:        "Pod failed.",
		},
	}

	got := namespaceInsightResourceSignalsFromSignals(items)
	if len(got) != 1 {
		t.Fatalf("expected one resource signal group, got %+v", got)
	}
	if got[0].ResourceKind != "Pod" || got[0].ResourceName != "bad" || got[0].ScopeLocation != "app" || len(got[0].Signals) != 1 {
		t.Fatalf("unexpected resource signal group: %+v", got[0])
	}
}

type namespaceInsightsCachedClients struct{}

func (namespaceInsightsCachedClients) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return &cluster.Clients{}, "", nil
}

func seedNamespaceInsightsSnapshots(t *testing.T, m *manager, contextName, namespace string, pods []dto.PodListItemDTO) {
	t.Helper()
	planeAny, _ := m.PlaneForCluster(t.Context(), contextName)
	plane := planeAny.(*clusterPlane)
	meta := SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Completeness: CompletenessClassComplete}
	setNamespacedSnapshot(&plane.podsStore, namespace, PodsSnapshot{Meta: meta, Items: pods})
	setNamespacedSnapshot(&plane.depsStore, namespace, DeploymentsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.svcsStore, namespace, ServicesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.ingStore, namespace, IngressesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.networkPoliciesStore, namespace, NetworkPoliciesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.pvcsStore, namespace, PVCsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.cmsStore, namespace, ConfigMapsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.secsStore, namespace, SecretsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.dsStore, namespace, DaemonSetsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.stsStore, namespace, StatefulSetsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.rsStore, namespace, ReplicaSetsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.jobsStore, namespace, JobsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.cjStore, namespace, CronJobsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.hpaStore, namespace, HPAsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.saStore, namespace, ServiceAccountsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.rolesStore, namespace, RolesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.roleBindingsStore, namespace, RoleBindingsSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.helmReleasesStore, namespace, HelmReleasesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.rqStore, namespace, ResourceQuotasSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.lrStore, namespace, LimitRangesSnapshot{Meta: meta})
	setNamespacedSnapshot(&plane.customResourcesStore, namespace, CustomResourcesSnapshot{Meta: meta})
}

func TestNamespaceInsightsRuntimeSuppressionHidesDetectorAndResourceProjection(t *testing.T) {
	mm := NewManager(ManagerConfig{}).(*manager)
	mm.clients = namespaceInsightsCachedClients{}
	pod := dto.PodListItemDTO{Name: "api", Namespace: "apps", Restarts: 12, Phase: "Running", Ready: "1/1"}
	seedNamespaceInsightsSnapshots(t, mm, "ctx-namespace-suppression", "apps", []dto.PodListItemDTO{pod})
	seedNamespaceInsightsSnapshots(t, mm, "ctx-namespace-other", "apps", []dto.PodListItemDTO{pod})
	initial, err := mm.NamespaceInsightsProjection(t.Context(), "ctx-namespace-suppression", "apps")
	if err != nil || len(initial.Insights.Signals) != 1 {
		t.Fatalf("initial namespace projection = %+v, %v", initial, err)
	}
	signal := initial.Insights.Signals[0]
	if signal.HistoryKey == "" || signal.StateFingerprint == "" {
		t.Fatalf("initial signal missing suppression identity: %+v", signal)
	}
	if _, err := mm.suppressSignalAt("ctx-namespace-suppression", SignalSuppressionRequest{HistoryKey: signal.HistoryKey, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: signal.StateFingerprint, Comment: "maintenance"}, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	got, err := mm.NamespaceInsightsProjection(t.Context(), "ctx-namespace-suppression", "apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Insights.Signals) != 0 || len(got.Insights.ResourceSignals) != 0 {
		t.Fatalf("suppressed detector remained visible or resurfaced through fallback: %+v", got.Insights)
	}
	if got.Insights.SuppressedSignalCount != 1 || len(got.Insights.SuppressedSignals) != 1 {
		t.Fatalf("suppressed namespace summary/list = %+v", got.Insights)
	}
	suppressed := got.Insights.SuppressedSignals[0]
	if suppressed.HistoryKey != signal.HistoryKey || suppressed.StateFingerprint != signal.StateFingerprint || suppressed.Suppression == nil || suppressed.Suppression.Comment != "maintenance" {
		t.Fatalf("suppressed namespace metadata = %+v", suppressed)
	}
	other, err := mm.NamespaceInsightsProjection(t.Context(), "ctx-namespace-other", "apps")
	if err != nil || len(other.Insights.Signals) != 1 || other.Insights.SuppressedSignalCount != 0 {
		t.Fatalf("suppression leaked to same identity in another context: %+v, %v", other, err)
	}
}

func suppressionCapTestSignals(count int, namespace, resourceName, keyPrefix string) []ClusterDashboardSignal {
	severities := []string{"low", "high", "medium"}
	out := make([]ClusterDashboardSignal, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, ClusterDashboardSignal{
			Kind:          "Pod",
			Namespace:     namespace,
			Name:          resourceName,
			Severity:      severities[i%len(severities)],
			Score:         i,
			Reason:        fmt.Sprintf("suppression cap signal %03d", i),
			SignalType:    fmt.Sprintf("%s-type-%03d", keyPrefix, i),
			ResourceKind:  "Pod",
			ResourceName:  resourceName,
			Scope:         ResourceSignalsScopeNamespace,
			ScopeLocation: namespace,
			ActualData:    fmt.Sprintf("sample-%03d", i),
			HistoryKey:    fmt.Sprintf("%s-key-%03d", keyPrefix, i),
		})
	}
	return out
}

func installSuppressionCapTestDetector(t *testing.T, signals []ClusterDashboardSignal) {
	t.Helper()
	original := dashboardSignalDetectors
	dashboardSignalDetectors = append(append([]dashboardSignalDetector(nil), original...), dashboardSignalDetector{
		Type: "suppression_cap_test",
		Detect: func(time.Time, string, dashboardSnapshotSet) []ClusterDashboardSignal {
			return append([]ClusterDashboardSignal(nil), signals...)
		},
	})
	t.Cleanup(func() { dashboardSignalDetectors = original })
}

func seedSuppressionCapTestRecords(m *manager, contextName string, signals []ClusterDashboardSignal) []ClusterDashboardSignal {
	policySignals := applySignalPolicy(signals, m.EffectivePolicy(contextName), contextName)
	now := time.Now().UTC()
	records := make(map[string]SignalSuppressionRecord, len(policySignals))
	for _, signal := range policySignals {
		records[signal.HistoryKey] = SignalSuppressionRecord{
			Mode:                SignalSuppressionModeUntilChanged,
			CreatedAt:           now.Unix(),
			UpdatedAt:           now.Unix(),
			BaselineFingerprint: clusterDashboardSignalStateFingerprint(signal),
			FingerprintVersion:  SignalFingerprintVersion,
			Comment:             "cap regression",
		}
	}
	m.signalSuppressionsMu.Lock()
	m.signalSuppressions[contextName] = records
	m.signalSuppressionsMu.Unlock()
	return policySignals
}

func sortedSuppressionCapTestSignals(signals []ClusterDashboardSignal) []ClusterDashboardSignal {
	out := append([]ClusterDashboardSignal(nil), signals...)
	sort.SliceStable(out, func(i, j int) bool { return dashboardSignalLess(out[i], out[j]) })
	return out
}

func TestNamespaceInsightsSuppressionSampleCapPreservesCountOrderAndFallbackBarrier(t *testing.T) {
	const extraSignals = 7
	contextName := "ctx-namespace-suppression-cap"
	namespace := "apps"
	signalCount := SignalSuppressionProjectionSampleLimit + extraSignals
	signals := suppressionCapTestSignals(signalCount, namespace, "api", "namespace-cap")
	installSuppressionCapTestDetector(t, signals)

	mm := NewManager(ManagerConfig{}).(*manager)
	mm.clients = namespaceInsightsCachedClients{}
	// The warning makes the pod problematic to the legacy fallback path. The
	// raw detector rows must remain its barrier even when they are suppressed.
	pod := dto.PodListItemDTO{Name: "api", Namespace: namespace, Phase: "Running", Ready: "1/1", LastEvent: &dto.EventBriefDTO{Type: "Warning", Reason: "BackOff"}}
	seedNamespaceInsightsSnapshots(t, mm, contextName, namespace, []dto.PodListItemDTO{pod})
	policySignals := seedSuppressionCapTestRecords(mm, contextName, signals)

	got, err := mm.NamespaceInsightsProjection(t.Context(), contextName, namespace)
	if err != nil {
		t.Fatal(err)
	}
	if got.Insights.SuppressedSignalCount != signalCount {
		t.Fatalf("suppressed count = %d, want uncapped %d", got.Insights.SuppressedSignalCount, signalCount)
	}
	if len(got.Insights.SuppressedSignals) != SignalSuppressionProjectionSampleLimit {
		t.Fatalf("suppressed sample length = %d, want %d", len(got.Insights.SuppressedSignals), SignalSuppressionProjectionSampleLimit)
	}
	if len(got.Insights.Signals) != 0 || len(got.Insights.ResourceSignals) != 0 {
		t.Fatalf("suppressed detector rows resurfaced in visible namespace projections: signals=%d resources=%d", len(got.Insights.Signals), len(got.Insights.ResourceSignals))
	}

	want := sortedSuppressionCapTestSignals(policySignals)[:SignalSuppressionProjectionSampleLimit]
	for i, item := range got.Insights.SuppressedSignals {
		if item.HistoryKey != want[i].HistoryKey {
			t.Fatalf("suppressed sample[%d] history key = %q, want %q", i, item.HistoryKey, want[i].HistoryKey)
		}
	}
	if got.Insights.SuppressedSignals[0].Severity != "high" || got.Insights.SuppressedSignals[len(got.Insights.SuppressedSignals)-1].HistoryKey != want[len(want)-1].HistoryKey {
		t.Fatalf("suppressed sample boundaries do not preserve priority order: first=%+v last=%+v", got.Insights.SuppressedSignals[0], got.Insights.SuppressedSignals[len(got.Insights.SuppressedSignals)-1])
	}
}
