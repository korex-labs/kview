package dataplane

import (
	"testing"
	"time"

	"kview/internal/kube/dto"
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

	res, hot, find, derived, wh, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, 0, NodesSnapshot{}, "denied", ClusterDashboardListOptions{})
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
	if hot.PodsWithElevatedRestarts < 1 {
		t.Fatalf("elevated: %d", hot.PodsWithElevatedRestarts)
	}
	if len(hot.TopPodRestartHotspots) == 0 {
		t.Fatal("expected hotspot merge")
	}
	if wh.NamespacesWithWorkloadCache != 1 || wh.TotalNamespacesVisible != 1 {
		t.Fatalf("wh %+v", wh)
	}
	if find.EmptyConfigMaps != 1 || find.EmptySecrets != 1 {
		t.Fatalf("findings %+v", find)
	}
	if find.QuotaWarnings != 1 || find.High == 0 {
		t.Fatalf("quota findings %+v", find)
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

	res, _, _, _, _, cov := mm.aggregateClusterDashboard(plane, []string{"x", "y"}, 2, 0, NodesSnapshot{}, "empty", ClusterDashboardListOptions{})
	if res.Pods != 0 || cov.ResourceTotalsCompleteness != "unknown" || cov.NamespacesInResourceTotals != 0 {
		t.Fatalf("res=%+v cov=%+v", res, cov)
	}
}

func TestAggregateClusterDashboard_HonorsHotspotToggle(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	policy := mm.Policy()
	policy.Dashboard.IncludeHotspots = false
	mm.SetPolicy(policy)

	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx3")
	plane := planeAny.(*clusterPlane)

	ns := "app"
	setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.PodListItemDTO{
			{Name: "pod-a", Namespace: ns, Restarts: 10, Phase: "Running", Ready: "1/1"},
		},
	})

	res, hot, _, _, wh, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, 0, NodesSnapshot{}, "empty", ClusterDashboardListOptions{})
	if res.Pods != 1 {
		t.Fatalf("pods: got %d, want 1", res.Pods)
	}
	if hot.PodsWithElevatedRestarts != 0 || len(hot.TopPodRestartHotspots) != 0 || hot.ProblematicResources != 0 {
		t.Fatalf("hotspots should be disabled: %+v", hot)
	}
	if hot.Note == "" {
		t.Fatal("expected disabled hotspot note")
	}
	if wh.PodsWithElevatedRestarts != 0 || len(wh.TopPodRestartHotspots) != 0 {
		t.Fatalf("workload hints should not include hotspots: %+v", wh)
	}
	if cov.ResourceTotalsCompleteness != "complete" {
		t.Fatalf("coverage: %+v", cov)
	}
}

func TestDetectDashboardFindingsRanksSignals(t *testing.T) {
	now := time.Now().UTC()
	ns := "app"
	findings := detectDashboardFindings(now, ns, dashboardSnapshotSet{
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
	summary := summarizeDashboardFindings(findings, 3, ClusterDashboardListOptions{FindingsFilter: "top", FindingsLimit: len(findings)})
	if summary.Total != len(findings) || summary.High < 2 || summary.EmptyConfigMaps != 1 || summary.EmptySecrets != 1 ||
		summary.ServiceWarnings != 1 || summary.IngressWarnings != 1 || summary.PVCWarnings != 1 ||
		summary.RoleWarnings != 1 || summary.RoleBindingWarnings != 1 {
		t.Fatalf("summary %+v findings %+v", summary, findings)
	}
	if len(summary.Top) != 3 {
		t.Fatalf("top not capped: %+v", summary.Top)
	}
	if summary.Top[0].Kind != "HelmRelease" || summary.Top[1].Kind != "Job" || summary.Top[2].Kind != "CronJob" {
		t.Fatalf("top not ordered by attention priority: %+v", summary.Top)
	}
	if summary.ItemsTotal != 3 || len(summary.Items) != 3 || summary.ItemsHasMore {
		t.Fatalf("top items should be capped: %+v", summary)
	}
}

func TestSummarizeDashboardFindingsPrefersHigherValueKindsOverScore(t *testing.T) {
	summary := summarizeDashboardFindings([]ClusterDashboardFinding{
		{Kind: "Job", Severity: "high", Score: 95, Namespace: "ns", Name: "job-a"},
		{Kind: "HelmRelease", Severity: "high", Score: 86, Namespace: "ns", Name: "rel-a"},
		{Kind: "Secret", Severity: "high", Score: 99, Namespace: "ns", Name: "sec-a"},
	}, 10, ClusterDashboardListOptions{FindingsLimit: 10})

	if len(summary.Top) != 3 {
		t.Fatalf("top len = %d", len(summary.Top))
	}
	if summary.Top[0].Kind != "HelmRelease" || summary.Top[1].Kind != "Job" || summary.Top[2].Kind != "Secret" {
		t.Fatalf("unexpected attention ordering: %+v", summary.Top)
	}
}

func TestSummarizeDashboardFindingsFiltersAndPaginatesItems(t *testing.T) {
	summary := summarizeDashboardFindings([]ClusterDashboardFinding{
		{Kind: "Job", Severity: "high", Score: 95, Namespace: "team-a", Name: "api-migrate"},
		{Kind: "Job", Severity: "high", Score: 90, Namespace: "team-b", Name: "worker-migrate"},
		{Kind: "Secret", Severity: "low", Score: 30, Namespace: "team-a", Name: "empty-secret"},
		{Kind: "Service", Severity: "medium", Score: 70, Namespace: "team-a", Name: "api"},
	}, 10, ClusterDashboardListOptions{
		FindingsFilter: "high",
		FindingsQuery:  "migrate",
		FindingsOffset: 1,
		FindingsLimit:  1,
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

func TestRestartHotspotsFilterAndPaginate(t *testing.T) {
	items := []dto.PodRestartHotspotDTO{
		{Namespace: "team-a", Name: "api-0", Node: "node-a", Severity: "high", RestartRatePerDay: 10, Restarts: 20},
		{Namespace: "team-a", Name: "worker-0", Node: "node-b", Severity: "medium", RestartRatePerDay: 8, Restarts: 8},
		{Namespace: "team-b", Name: "api-1", Node: "node-a", Severity: "low", RestartRatePerDay: 3, Restarts: 2},
	}
	hot := ClusterDashboardHotspotsPanel{}
	page := paginateRestartHotspots(filterRestartHotspots(items, "node-a"), ClusterDashboardListOptions{
		RestartHotspotsQuery:  "node-a",
		RestartHotspotsOffset: 1,
		RestartHotspotsLimit:  1,
	}, &hot)

	if hot.RestartHotspotsTotal != 2 || hot.RestartHotspotsOffset != 1 || hot.RestartHotspotsLimit != 1 || hot.RestartHotspotsHasMore {
		t.Fatalf("hotspot page metadata mismatch: %+v", hot)
	}
	if len(page) != 1 || page[0].Name != "api-1" {
		t.Fatalf("unexpected hotspot page: %+v", page)
	}
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
