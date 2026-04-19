package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func TestResourceTotalsCompletenessLabel(t *testing.T) {
	tests := []struct {
		visible, cached int
		want            string
	}{
		{0, 0, "unknown"},
		{5, 0, "unknown"},
		{5, 2, "partial"},
		{3, 3, "complete"},
		{10, 11, "complete"},
	}
	for _, tc := range tests {
		if g := resourceTotalsCompletenessLabel(tc.visible, tc.cached); g != tc.want {
			t.Fatalf("visible=%d cached=%d: got %q want %q", tc.visible, tc.cached, g, tc.want)
		}
	}
}

func TestVisibleNamespacesWithCachedDataplaneLists(t *testing.T) {
	p := newClusterPlane("c", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	now := time.Now().UTC()
	meta := SnapshotMetadata{ObservedAt: now}
	setNamespacedSnapshot(&p.helmReleasesStore, "bravo", HelmReleasesSnapshot{Items: []dto.HelmReleaseDTO{{Name: "rel1"}}, Meta: meta})

	vis := []string{"alpha", "bravo", "charlie"}
	got := visibleNamespacesWithCachedDataplaneLists(p, vis)
	if len(got) != 1 || got[0] != "bravo" {
		t.Fatalf("got %#v", got)
	}
}

func TestAggregateClusterDashboard_FromCachedPodsOnly(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx1")
	plane := planeAny.(*clusterPlane)

	now := time.Now().UTC()
	meta := SnapshotMetadata{ObservedAt: now}
	ns := "app"
	setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{
		Meta: meta,
		Items: []dto.PodListItemDTO{
			{Name: "pod-a", Namespace: ns, Restarts: 5, Phase: "Running", Ready: "1/1"},
		},
	})
	setNamespacedSnapshot(&plane.depsStore, ns, DeploymentsSnapshot{Meta: meta, Items: nil})
	setNamespacedSnapshot(&plane.dsStore, ns, DaemonSetsSnapshot{Meta: meta, Items: []dto.DaemonSetDTO{{Name: "ds", Namespace: ns}}})
	setNamespacedSnapshot(&plane.stsStore, ns, StatefulSetsSnapshot{Meta: meta, Items: []dto.StatefulSetDTO{{Name: "sts", Namespace: ns}}})
	setNamespacedSnapshot(&plane.rsStore, ns, ReplicaSetsSnapshot{Meta: meta, Items: []dto.ReplicaSetDTO{{Name: "rs", Namespace: ns}}})
	setNamespacedSnapshot(&plane.jobsStore, ns, JobsSnapshot{Meta: meta, Items: []dto.JobDTO{{Name: "job", Namespace: ns}}})
	setNamespacedSnapshot(&plane.cjStore, ns, CronJobsSnapshot{Meta: meta, Items: []dto.CronJobDTO{{Name: "cj", Namespace: ns}}})
	setNamespacedSnapshot(&plane.svcsStore, ns, ServicesSnapshot{Meta: meta, Items: nil})
	setNamespacedSnapshot(&plane.ingStore, ns, IngressesSnapshot{Meta: meta, Items: nil})
	setNamespacedSnapshot(&plane.pvcsStore, ns, PVCsSnapshot{Meta: meta, Items: nil})
	setNamespacedSnapshot(&plane.cmsStore, ns, ConfigMapsSnapshot{Meta: meta, Items: []dto.ConfigMapDTO{{Name: "cm", Namespace: ns}}})
	setNamespacedSnapshot(&plane.secsStore, ns, SecretsSnapshot{Meta: meta, Items: []dto.SecretDTO{{Name: "sec", Namespace: ns}}})
	setNamespacedSnapshot(&plane.saStore, ns, ServiceAccountsSnapshot{Meta: meta, Items: []dto.ServiceAccountListItemDTO{{Name: "sa", Namespace: ns}}})
	setNamespacedSnapshot(&plane.rolesStore, ns, RolesSnapshot{Meta: meta, Items: []dto.RoleListItemDTO{{Name: "role", Namespace: ns}}})
	setNamespacedSnapshot(&plane.roleBindingsStore, ns, RoleBindingsSnapshot{Meta: meta, Items: []dto.RoleBindingListItemDTO{{Name: "rb", Namespace: ns}}})
	setNamespacedSnapshot(&plane.helmReleasesStore, ns, HelmReleasesSnapshot{Meta: meta, Items: []dto.HelmReleaseDTO{{Name: "rel", Namespace: ns}}})
	ratio := 0.93
	setNamespacedSnapshot(&plane.rqStore, ns, ResourceQuotasSnapshot{Meta: meta, Items: []dto.ResourceQuotaDTO{{
		Name:      "rq",
		Namespace: ns,
		Entries:   []dto.ResourceQuotaEntryDTO{{Key: "pods", Used: "9", Hard: "10", Ratio: &ratio}},
	}}})
	setNamespacedSnapshot(&plane.lrStore, ns, LimitRangesSnapshot{Meta: meta, Items: []dto.LimitRangeDTO{{Name: "limits", Namespace: ns}}})

	res, signalPanel, derived, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, NodesSnapshot{}, "denied", ClusterDashboardListOptions{})
	if res.Pods != 1 {
		t.Fatalf("pods: %d", res.Pods)
	}
	if res.DaemonSets != 1 || res.StatefulSets != 1 || res.ReplicaSets != 1 || res.Jobs != 1 || res.CronJobs != 1 {
		t.Fatalf("workload totals: %+v", res)
	}
	if res.ConfigMaps != 1 || res.Secrets != 1 || res.ServiceAccounts != 1 || res.Roles != 1 || res.RoleBindings != 1 || res.HelmReleases != 1 {
		t.Fatalf("config/access totals: %+v", res)
	}
	if res.ResourceQuotas != 1 || res.LimitRanges != 1 {
		t.Fatalf("quota/limit totals: %+v", res)
	}
	if signalPanel.EmptyConfigMaps != 1 || signalPanel.EmptySecrets != 1 {
		t.Fatalf("signals %+v", signalPanel)
	}
	if signalPanel.QuotaWarnings != 1 || signalPanel.High == 0 {
		t.Fatalf("quota signals %+v", signalPanel)
	}
	if cov.ResourceTotalsCompleteness != "complete" || cov.NamespacesInResourceTotals != 1 {
		t.Fatalf("cov %+v", cov)
	}
	if cov.VisibleNamespaces != 1 {
		t.Fatalf("visible %d", cov.VisibleNamespaces)
	}
	if derived.Nodes.Total != 1 || len(derived.Nodes.Nodes) != 1 || derived.Nodes.Nodes[0].Name == "" {
		t.Fatalf("derived nodes %+v", derived.Nodes)
	}
	if derived.HelmCharts.Total != 1 || len(derived.HelmCharts.Charts) != 1 {
		t.Fatalf("derived helm charts %+v", derived.HelmCharts)
	}
}

func TestAggregateClusterDashboard_NoCacheUnknownTotals(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx2")
	plane := planeAny.(*clusterPlane)

	res, _, _, cov := mm.aggregateClusterDashboard(plane, []string{"x", "y"}, 2, NodesSnapshot{}, "empty", ClusterDashboardListOptions{})
	if res.Pods != 0 || cov.ResourceTotalsCompleteness != "unknown" || cov.NamespacesInResourceTotals != 0 {
		t.Fatalf("res=%+v cov=%+v", res, cov)
	}
}

func TestAggregateClusterDashboard_PodRestartsAreSignals(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx3")
	plane := planeAny.(*clusterPlane)

	ns := "app"
	setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.PodListItemDTO{
			{Name: "pod-a", Namespace: ns, Restarts: 10, Phase: "Running", Ready: "1/1"},
		},
	})

	res, signalPanel, _, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, NodesSnapshot{}, "empty", ClusterDashboardListOptions{})
	if res.Pods != 1 {
		t.Fatalf("pods: got %d, want 1", res.Pods)
	}
	if signalPanel.PodRestartSignals != 1 || signalPanel.Total != 1 || len(signalPanel.Items) != 1 {
		t.Fatalf("pod restart signal not summarized: %+v", signalPanel)
	}
	if cov.ResourceTotalsCompleteness != "complete" {
		t.Fatalf("coverage: %+v", cov)
	}
}

func TestDetectHPASignalsPinnedMaxIsLowSeverity(t *testing.T) {
	items := detectHPANeedsAttentionSignals(time.Now(), "app", dashboardSnapshotSet{
		hpasOK: true,
		hpas: HPAsSnapshot{Items: []dto.HorizontalPodAutoscalerDTO{{
			Name:             "api",
			Namespace:        "app",
			MinReplicas:      1,
			MaxReplicas:      1,
			CurrentReplicas:  1,
			DesiredReplicas:  1,
			NeedsAttention:   true,
			AttentionReasons: []string{"replicas are pinned at maxReplicas"},
		}}},
	})
	if len(items) != 1 {
		t.Fatalf("expected one HPA signal, got %d", len(items))
	}
	if items[0].Severity != "low" {
		t.Fatalf("expected pinned max to be low severity, got %+v", items[0])
	}
}

func TestDetectHPASignalsFailuresStayMediumSeverity(t *testing.T) {
	items := detectHPANeedsAttentionSignals(time.Now(), "app", dashboardSnapshotSet{
		hpasOK: true,
		hpas: HPAsSnapshot{Items: []dto.HorizontalPodAutoscalerDTO{{
			Name:             "api",
			Namespace:        "app",
			MinReplicas:      2,
			MaxReplicas:      5,
			CurrentReplicas:  1,
			DesiredReplicas:  2,
			NeedsAttention:   true,
			AttentionReasons: []string{"current replicas are below minReplicas"},
		}}},
	})
	if len(items) != 1 {
		t.Fatalf("expected one HPA signal, got %d", len(items))
	}
	if items[0].Severity != "medium" {
		t.Fatalf("expected HPA failure to be medium severity, got %+v", items[0])
	}
}

func TestDetectDashboardSignalsRanksSignals(t *testing.T) {
	now := time.Now().UTC()
	ns := "app"
	signals := detectDashboardSignals(now, ns, dashboardSnapshotSet{
		pods:    PodsSnapshot{Items: nil},
		podsOK:  true,
		deps:    DeploymentsSnapshot{Items: nil},
		depsOK:  true,
		ds:      DaemonSetsSnapshot{Items: nil},
		dsOK:    true,
		sts:     StatefulSetsSnapshot{Items: nil},
		stsOK:   true,
		rs:      ReplicaSetsSnapshot{Items: nil},
		rsOK:    true,
		jobs:    JobsSnapshot{Items: []dto.JobDTO{{Name: "failed", Namespace: ns, Status: "Failed", Failed: 1}}},
		jobsOK:  true,
		cjs:     CronJobsSnapshot{Items: []dto.CronJobDTO{{Name: "stale", Namespace: ns, AgeSec: int64((48 * time.Hour).Seconds())}}},
		cjsOK:   true,
		svcs:    ServicesSnapshot{Items: []dto.ServiceListItemDTO{{Name: "svc", Namespace: ns, EndpointsReady: 0, EndpointsNotReady: 1}}},
		svcsOK:  true,
		ings:    IngressesSnapshot{Items: []dto.IngressListItemDTO{{Name: "ing", Namespace: ns, Hosts: []string{"app.example"}}}},
		ingsOK:  true,
		pvcs:    PVCsSnapshot{Items: []dto.PersistentVolumeClaimDTO{{Name: "data", Namespace: ns, Phase: "Pending", AgeSec: int64((48 * time.Hour).Seconds())}}},
		pvcsOK:  true,
		cms:     ConfigMapsSnapshot{Items: []dto.ConfigMapDTO{{Name: "empty-cm", Namespace: ns}}},
		cmsOK:   true,
		secs:    SecretsSnapshot{Items: []dto.SecretDTO{{Name: "empty-secret", Namespace: ns}}},
		secsOK:  true,
		sas:     ServiceAccountsSnapshot{Items: []dto.ServiceAccountListItemDTO{{Name: "builder", Namespace: ns, AgeSec: int64((48 * time.Hour).Seconds())}}},
		sasOK:   true,
		roles:   RolesSnapshot{Items: []dto.RoleListItemDTO{{Name: "wide-role", Namespace: ns, RulesCount: 12}}},
		rolesOK: true,
		roleBindings: RoleBindingsSnapshot{Items: []dto.RoleBindingListItemDTO{{
			Name:          "wide-binding",
			Namespace:     ns,
			RoleRefKind:   "Role",
			SubjectsCount: 12,
		}}},
		roleBindingsOK: true,
		helmReleases:   HelmReleasesSnapshot{Items: []dto.HelmReleaseDTO{{Name: "rel", Namespace: ns, Status: "pending-upgrade", Updated: now.Add(-time.Hour).Unix()}}},
		helmOK:         true,
	})
	summary := summarizeDashboardSignals(signals, 3, ClusterDashboardListOptions{SignalsFilter: "top", SignalsLimit: len(signals)})
	if summary.Total != len(signals) || summary.High < 2 || summary.EmptyConfigMaps != 1 || summary.EmptySecrets != 1 ||
		summary.ServiceWarnings != 1 || summary.IngressWarnings != 1 || summary.PVCWarnings != 1 ||
		summary.RoleWarnings != 1 || summary.RoleBindingWarnings != 1 {
		t.Fatalf("summary %+v signals %+v", summary, signals)
	}
	if len(summary.Top) != 3 {
		t.Fatalf("top not capped: %+v", summary.Top)
	}
	if summary.Top[0].Kind != "HelmRelease" || summary.Top[1].Kind != "Job" || summary.Top[2].Kind != "CronJob" {
		t.Fatalf("top not ordered by attention priority: %+v", summary.Top)
	}
	if summary.Top[0].SignalType != "stale_transitional_helm_release" || summary.Top[0].ResourceKind != "HelmRelease" || summary.Top[0].ResourceName != "rel" {
		t.Fatalf("top signal identity not populated: %+v", summary.Top[0])
	}
	if summary.Top[0].Scope != "namespace" || summary.Top[0].ScopeLocation != ns || summary.Top[0].ActualData == "" || summary.Top[0].CalculatedData == "" {
		t.Fatalf("top signal scope/data not populated: %+v", summary.Top[0])
	}
	if summary.ItemsTotal != 3 || len(summary.Items) != 3 || summary.ItemsHasMore {
		t.Fatalf("top items should be capped: %+v", summary)
	}
}

func TestSummarizeDashboardSignalsPrefersHigherValueKindsOverScore(t *testing.T) {
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{
		{Kind: "Job", Severity: "high", Score: 95, Namespace: "ns", Name: "job-a"},
		{Kind: "HelmRelease", Severity: "high", Score: 86, Namespace: "ns", Name: "rel-a"},
		{Kind: "Secret", Severity: "high", Score: 99, Namespace: "ns", Name: "sec-a"},
	}, 10, ClusterDashboardListOptions{SignalsLimit: 10})

	if len(summary.Top) != 3 {
		t.Fatalf("top len = %d", len(summary.Top))
	}
	if summary.Top[0].Kind != "HelmRelease" || summary.Top[1].Kind != "Job" || summary.Top[2].Kind != "Secret" {
		t.Fatalf("unexpected attention ordering: %+v", summary.Top)
	}
}

func TestSummarizeDashboardSignalsFiltersAndPaginatesItems(t *testing.T) {
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{
		{Kind: "Job", Severity: "high", Score: 95, Namespace: "team-a", Name: "api-migrate"},
		{Kind: "Job", Severity: "high", Score: 90, Namespace: "team-b", Name: "worker-migrate"},
		{Kind: "Secret", Severity: "low", Score: 30, Namespace: "team-a", Name: "empty-secret"},
		{Kind: "Service", Severity: "medium", Score: 70, Namespace: "team-a", Name: "api"},
	}, 10, ClusterDashboardListOptions{
		SignalsFilter: "high",
		SignalsQuery:  "migrate",
		SignalsOffset: 1,
		SignalsLimit:  1,
	})

	if summary.Total != 4 || summary.High != 2 || summary.Medium != 1 || summary.Low != 1 {
		t.Fatalf("global counts should ignore page filters: %+v", summary)
	}
	if summary.ItemsTotal != 2 || summary.ItemsOffset != 1 || summary.ItemsLimit != 1 || summary.ItemsHasMore {
		t.Fatalf("page metadata mismatch: %+v", summary)
	}
	if len(summary.Items) != 1 || summary.Items[0].Name != "worker-migrate" {
		t.Fatalf("unexpected page items: %+v", summary.Items)
	}
}

func TestSummarizeDashboardSignalsFiltersBySignalType(t *testing.T) {
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{
		dashboardSignalItem("empty_configmap", "ConfigMap", "team-a", "empty-cm", "low", 35, "ConfigMap has no data keys.", "high", "configmaps"),
		dashboardSignalItem("empty_secret", "Secret", "team-a", "empty-secret", "low", 35, "Secret has no data keys.", "high", "secrets"),
	}, 10, ClusterDashboardListOptions{SignalsFilter: "empty_secret", SignalsLimit: 10})

	if summary.ItemsTotal != 1 || len(summary.Items) != 1 || summary.Items[0].SignalType != "empty_secret" {
		t.Fatalf("expected signal-type filtered secret signal, got %+v", summary)
	}
	if !dashboardSignalFilterExists(summary.Filters, "signal:empty_secret", "Empty Secrets", 1) {
		t.Fatalf("expected empty-secret filter in %+v", summary.Filters)
	}
}

func TestSummarizeDashboardSignalsCountsBySignalType(t *testing.T) {
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{
		dashboardSignalItem("pvc_needs_attention", "PersistentVolumeClaim", "team-a", "data", "medium", 63, "Potentially unused wording should not decide this bucket.", "medium", "persistentvolumeclaims"),
		dashboardSignalItem("potentially_unused_pvc", "PersistentVolumeClaim", "team-a", "archive", "low", 30, "No magic wording required.", "low", "persistentvolumeclaims"),
		dashboardSignalItem("long_running_job", "Job", "team-a", "slow", "medium", 62, "Job has been running for more than 6 hours.", "medium", "jobs"),
		dashboardSignalItem("cronjob_no_recent_success", "CronJob", "team-a", "nightly", "medium", 60, "CronJob has no successful run recorded after more than 24 hours.", "medium", "cronjobs"),
	}, 10, ClusterDashboardListOptions{SignalsLimit: 10})

	if summary.PVCWarnings != 1 || summary.PotentiallyUnusedPVCs != 1 {
		t.Fatalf("PVC counters should use signal type, got %+v", summary)
	}
	if summary.AbnormalJobs != 1 || summary.AbnormalCronJobs != 1 {
		t.Fatalf("job counters should include signal-type variants, got %+v", summary)
	}
}

func TestDashboardSignalFiltersSortEachGroupBySeverity(t *testing.T) {
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{
		dashboardSignalItem("empty_configmap", "ConfigMap", "team-a", "empty-cm", "low", 35, "ConfigMap has no data keys.", "high", "configmaps"),
		dashboardSignalItem("service_no_ready_endpoints", "Service", "team-b", "api", "medium", 70, "Service has no ready endpoints.", "medium", "services"),
		dashboardSignalItem("abnormal_job", "Job", "team-c", "migrate", "high", 95, "Job failed recently.", "high", "jobs"),
		dashboardSignalItem("empty_secret", "Secret", "team-a", "empty-secret", "low", 35, "Secret has no data keys.", "high", "secrets"),
	}, 10, ClusterDashboardListOptions{SignalsLimit: 10})

	if got := dashboardSignalFilterIDsByCategory(summary.Filters, "kind"); !dashboardStringSliceEqual(got, []string{"kind:Job", "kind:Service", "kind:ConfigMap", "kind:Secret"}) {
		t.Fatalf("kind filters not sorted by severity: %v", got)
	}
	if got := dashboardSignalFilterIDsByCategory(summary.Filters, "signal_type"); !dashboardStringSliceEqual(got, []string{"signal:abnormal_job", "signal:service_no_ready_endpoints", "signal:empty_configmap", "signal:empty_secret"}) {
		t.Fatalf("signal-type filters not sorted by severity: %v", got)
	}
	if got := dashboardSignalFilterIDsByCategory(summary.Filters, "namespace"); !dashboardStringSliceEqual(got, []string{"namespace:team-c", "namespace:team-b", "namespace:team-a"}) {
		t.Fatalf("namespace filters not sorted by severity: %v", got)
	}
}

func TestDashboardPodRestartSignalUsesSignalShape(t *testing.T) {
	item := dashboardPodRestartSignal("team-a", dto.PodListItemDTO{Name: "api-0", Restarts: 10, AgeSec: int64((48 * time.Hour).Seconds())})
	summary := summarizeDashboardSignals([]ClusterDashboardSignal{item}, 10, ClusterDashboardListOptions{SignalsFilter: "signal:pod_restarts", SignalsLimit: 10})

	if summary.PodRestartSignals != 1 || summary.ItemsTotal != 1 || len(summary.Items) != 1 {
		t.Fatalf("expected pod restart signal count and filter, got %+v", summary)
	}
	got := summary.Items[0]
	if got.SignalType != "pod_restarts" || got.ResourceKind != "Pod" || got.ResourceName != "api-0" {
		t.Fatalf("pod restart identity missing: %+v", got)
	}
	if got.ActualData != "10 restarts · age 2.0d" || got.CalculatedData != "5.0/day restart rate" {
		t.Fatalf("pod restart signal data mismatch: %+v", got)
	}
	if !dashboardSignalFilterExists(summary.Filters, "signal:pod_restarts", "Pod restarts", 1) {
		t.Fatalf("expected pod restart filter in %+v", summary.Filters)
	}
	if !dashboardSignalFilterExists(summary.Filters, "kind:Pod", "Pod", 1) {
		t.Fatalf("expected pod kind filter in %+v", summary.Filters)
	}
	if !dashboardSignalFilterExists(summary.Filters, "namespace:team-a", "team-a", 1) {
		t.Fatalf("expected namespace filter in %+v", summary.Filters)
	}
}

func TestDashboardResourceQuotaSignalUsesEntryData(t *testing.T) {
	ratio := 0.825
	items := detectDashboardSignals(time.Now(), "team-a", dashboardSnapshotSet{
		resourceQuotas: ResourceQuotasSnapshot{Items: []dto.ResourceQuotaDTO{{
			Name:      "rq",
			Namespace: "team-a",
			Entries:   []dto.ResourceQuotaEntryDTO{{Key: "pods", Used: "33", Hard: "40", Ratio: &ratio}},
		}}},
		quotasOK: true,
	})

	if len(items) != 1 {
		t.Fatalf("expected one quota signal, got %+v", items)
	}
	got := items[0]
	if got.SignalType != "resource_quota_pressure" || got.Severity != "medium" {
		t.Fatalf("quota signal identity mismatch: %+v", got)
	}
	if got.ActualData != "pods: 33 / 40" || got.CalculatedData != "82% of hard limit" {
		t.Fatalf("quota signal data mismatch: %+v", got)
	}
}

func TestDashboardSignalDefinitionRegistryPreservesKnownMetadata(t *testing.T) {
	secret := dashboardSignalDefinitionForType("empty_secret")
	if secret.Type != "empty_secret" || secret.Label != "Empty Secrets" {
		t.Fatalf("secret signal identity mismatch: %+v", secret)
	}
	if secret.ActualData != "0 data keys" || secret.CalculatedData != "empty Secret" {
		t.Fatalf("secret signal data mismatch: %+v", secret)
	}
	if secret.LikelyCause == "" || secret.SuggestedAction == "" {
		t.Fatalf("secret signal advice missing: %+v", secret)
	}

	longRunningJob := dashboardSignalDefinitionForType("long_running_job")
	if longRunningJob.Type != "long_running_job" || longRunningJob.CalculatedData != "running for more than 6 hours" {
		t.Fatalf("long-running job signal mismatch: %+v", longRunningJob)
	}

	if dashboardSignalDefinitionForType("pod_restarts").Priority != 0 {
		t.Fatalf("pod restart priority should come from the registry")
	}
	unknown := dashboardSignalDefinitionForType("unknown_signal")
	if unknown.Label != "unknown_signal" || unknown.Priority != 10 {
		t.Fatalf("unknown signal fallback mismatch: %+v", unknown)
	}
}

func TestDashboardSignalDetectorRegistryHasDefinitions(t *testing.T) {
	seen := map[string]bool{}
	for _, detector := range dashboardSignalDetectors {
		if detector.Type == "" || detector.Detect == nil {
			t.Fatalf("invalid detector entry: %+v", detector)
		}
		if seen[detector.Type] {
			t.Fatalf("duplicate detector for %q", detector.Type)
		}
		seen[detector.Type] = true
		def := dashboardSignalDefinitionForType(detector.Type)
		if def.Type != detector.Type || def.Label == "" {
			t.Fatalf("detector %q missing signal definition: %+v", detector.Type, def)
		}
		if def.SummaryCounter == "" {
			t.Fatalf("detector %q missing summary counter: %+v", detector.Type, def)
		}
	}
}

func TestDashboardSignalDetectorRegistryProducesExplicitTypes(t *testing.T) {
	ratio := 0.91
	now := time.Now().UTC()
	items := detectDashboardSignals(now, "team-a", dashboardSnapshotSet{
		pods:   PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "api-0", Restarts: 8, AgeSec: int64((48 * time.Hour).Seconds())}}},
		podsOK: true,
		jobs: JobsSnapshot{Items: []dto.JobDTO{
			{Name: "failed", Namespace: "team-a", Status: "Failed", Failed: 1},
			{Name: "running", Namespace: "team-a", Status: "Running", AgeSec: int64((7 * time.Hour).Seconds())},
		}},
		jobsOK: true,
		resourceQuotas: ResourceQuotasSnapshot{Items: []dto.ResourceQuotaDTO{{
			Name:      "rq",
			Namespace: "team-a",
			Entries:   []dto.ResourceQuotaEntryDTO{{Key: "pods", Used: "91", Hard: "100", Ratio: &ratio}},
		}}},
		quotasOK: true,
	})

	want := map[string]bool{
		"pod_restarts":            false,
		"abnormal_job":            false,
		"long_running_job":        false,
		"resource_quota_pressure": false,
	}
	for _, item := range items {
		if _, ok := want[item.SignalType]; ok {
			want[item.SignalType] = true
		}
	}
	for signalType, found := range want {
		if !found {
			t.Fatalf("expected detector output for %q in %+v", signalType, items)
		}
	}
}

func TestDashboardSignalStoreIndexesMultipleSignalsPerResource(t *testing.T) {
	store := newDashboardSignalStore()
	store.Add(
		dashboardSignalItem("pvc_needs_attention", "PersistentVolumeClaim", "team-a", "data", "medium", 63, "PVC needs attention.", "medium", "persistentvolumeclaims"),
		dashboardSignalItem("potentially_unused_pvc", "PersistentVolumeClaim", "team-a", "data", "low", 30, "PVC may be unused.", "low", "persistentvolumeclaims"),
		dashboardSignalItem("empty_secret", "Secret", "team-a", "token", "low", 35, "Secret has no data keys.", "high", "secrets"),
	)

	items := store.SignalsForResource("PersistentVolumeClaim", "data", "namespace", "team-a")
	if len(items) != 2 {
		t.Fatalf("expected two PVC signals from resource index, got %+v", items)
	}
	if items[0].SignalType != "pvc_needs_attention" || items[1].SignalType != "potentially_unused_pvc" {
		t.Fatalf("unexpected indexed PVC signals: %+v", items)
	}
	if got := store.SignalsForResource("Secret", "token", "namespace", "team-a"); len(got) != 1 || got[0].SignalType != "empty_secret" {
		t.Fatalf("expected one indexed secret signal, got %+v", got)
	}
	groups := store.ResourceSignals()
	if len(groups) != 2 {
		t.Fatalf("expected two resource signal groups, got %+v", groups)
	}
	if groups[0].ResourceKind != "PersistentVolumeClaim" || groups[0].ResourceName != "data" || len(groups[0].Signals) != 2 {
		t.Fatalf("unexpected first resource signal group: %+v", groups)
	}
}

func TestDashboardSignalStoreSummaryDoesNotMutateInsertionOrder(t *testing.T) {
	store := newDashboardSignalStore()
	store.Add(
		dashboardSignalItem("empty_secret", "Secret", "team-a", "token", "low", 35, "Secret has no data keys.", "high", "secrets"),
		dashboardSignalItem("abnormal_job", "Job", "team-a", "migrate", "high", 90, "Job failed.", "high", "jobs"),
	)

	summary := store.Summary(10, ClusterDashboardListOptions{SignalsLimit: 10})
	if len(summary.Top) != 2 || summary.Top[0].SignalType != "abnormal_job" {
		t.Fatalf("expected sorted summary from signal store, got %+v", summary.Top)
	}
	items := store.Items()
	if len(items) != 2 || items[0].SignalType != "empty_secret" || items[1].SignalType != "abnormal_job" {
		t.Fatalf("summary should not mutate signal-store insertion order, got %+v", items)
	}
}

func dashboardSignalFilterExists(filters []ClusterDashboardSignalFilter, id, label string, count int) bool {
	for _, filter := range filters {
		if filter.ID == id && filter.Label == label && filter.Count == count {
			return true
		}
	}
	return false
}

func dashboardSignalFilterIDsByCategory(filters []ClusterDashboardSignalFilter, category string) []string {
	var ids []string
	for _, filter := range filters {
		if filter.Category == category {
			ids = append(ids, filter.ID)
		}
	}
	return ids
}

func dashboardStringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestEmptyLookingNamespaceIgnoresKubeRootCAConfigMap(t *testing.T) {
	if !isEmptyLookingNamespace(dashboardSnapshotSet{
		pods:         PodsSnapshot{Items: nil},
		podsOK:       true,
		deps:         DeploymentsSnapshot{Items: nil},
		depsOK:       true,
		ds:           DaemonSetsSnapshot{Items: nil},
		dsOK:         true,
		sts:          StatefulSetsSnapshot{Items: nil},
		stsOK:        true,
		rs:           ReplicaSetsSnapshot{Items: nil},
		rsOK:         true,
		jobs:         JobsSnapshot{Items: nil},
		jobsOK:       true,
		cjs:          CronJobsSnapshot{Items: nil},
		cjsOK:        true,
		svcs:         ServicesSnapshot{Items: nil},
		svcsOK:       true,
		ings:         IngressesSnapshot{Items: nil},
		ingsOK:       true,
		pvcs:         PVCsSnapshot{Items: nil},
		pvcsOK:       true,
		cms:          ConfigMapsSnapshot{Items: []dto.ConfigMapDTO{{Name: "kube-root-ca.crt", Namespace: "empty"}}},
		cmsOK:        true,
		secs:         SecretsSnapshot{Items: nil},
		secsOK:       true,
		helmReleases: HelmReleasesSnapshot{Items: nil},
		helmOK:       true,
	}) {
		t.Fatal("expected auto-created kube-root-ca.crt to be ignored for empty namespace heuristic")
	}
}

func TestEmptyLookingNamespaceIgnoresSupportivePolicyResources(t *testing.T) {
	if !isEmptyLookingNamespace(dashboardSnapshotSet{
		pods:           PodsSnapshot{Items: nil},
		podsOK:         true,
		deps:           DeploymentsSnapshot{Items: nil},
		depsOK:         true,
		ds:             DaemonSetsSnapshot{Items: nil},
		dsOK:           true,
		sts:            StatefulSetsSnapshot{Items: nil},
		stsOK:          true,
		rs:             ReplicaSetsSnapshot{Items: nil},
		rsOK:           true,
		jobs:           JobsSnapshot{Items: nil},
		jobsOK:         true,
		cjs:            CronJobsSnapshot{Items: nil},
		cjsOK:          true,
		svcs:           ServicesSnapshot{Items: nil},
		svcsOK:         true,
		ings:           IngressesSnapshot{Items: nil},
		ingsOK:         true,
		pvcs:           PVCsSnapshot{Items: nil},
		pvcsOK:         true,
		cms:            ConfigMapsSnapshot{Items: []dto.ConfigMapDTO{{Name: "kube-root-ca.crt", Namespace: "empty"}}},
		cmsOK:          true,
		secs:           SecretsSnapshot{Items: nil},
		secsOK:         true,
		helmReleases:   HelmReleasesSnapshot{Items: nil},
		helmOK:         true,
		resourceQuotas: ResourceQuotasSnapshot{Items: []dto.ResourceQuotaDTO{{Name: "rq", Namespace: "empty"}}},
		quotasOK:       true,
		limitRanges:    LimitRangesSnapshot{Items: []dto.LimitRangeDTO{{Name: "limits", Namespace: "empty"}}},
		limitRangesOK:  true,
	}) {
		t.Fatal("expected quotas/limits to be ignored for empty namespace heuristic")
	}
}

func TestBuildDashboardCoverageIncludesSweepTargets(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-sweep"
	mm.nsEnrich.byCluster[cluster] = &nsEnrichSession{
		workNames:  []string{"focused"},
		sweepNames: []string{"cold"},
		merged: map[string]dto.NamespaceListItemDTO{
			"focused": {Name: "focused", RowEnriched: true},
			"cold":    {Name: "cold", RowEnriched: true},
		},
		detailDone:  2,
		relatedDone: 2,
	}

	cov := mm.buildDashboardCoverage(cluster, []string{"cold", "focused", "other"}, 3)
	if cov.EnrichmentTargets != 2 {
		t.Fatalf("targets: got %d, want 2", cov.EnrichmentTargets)
	}
	if cov.AwaitingRelatedRowProjection != 2 {
		t.Fatalf("awaiting: got %d, want 2", cov.AwaitingRelatedRowProjection)
	}
	if cov.ListOnlyNamespaces != 3 {
		t.Fatalf("list-only: got %d, want 3", cov.ListOnlyNamespaces)
	}
}

func TestBuildDashboardCoverageCountsCachedRowProjectionNamespaces(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-cached-rows"
	planeAny, _ := mm.PlaneForCluster(t.Context(), cluster)
	plane := planeAny.(*clusterPlane)
	setNamespacedSnapshot(&plane.podsStore, "focused", PodsSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.PodListItemDTO{{Name: "pod", Namespace: "focused"}},
	})
	mm.nsEnrich.byCluster[cluster] = &nsEnrichSession{
		workNames:  []string{"focused"},
		sweepNames: []string{"cold"},
		merged:     map[string]dto.NamespaceListItemDTO{},
		detailDone: 1,
	}

	cov := mm.buildDashboardCoverage(cluster, []string{"cold", "focused", "other"}, 3)
	if cov.RelatedEnrichedNamespaces != 1 || cov.RowProjectionCachedNamespaces != 1 {
		t.Fatalf("cached row projection counts: %+v", cov)
	}
	if cov.AwaitingRelatedRowProjection != 1 {
		t.Fatalf("awaiting: got %d, want 1", cov.AwaitingRelatedRowProjection)
	}
	if cov.ListOnlyNamespaces != 2 {
		t.Fatalf("list-only: got %d, want 2", cov.ListOnlyNamespaces)
	}
}
