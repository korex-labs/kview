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
	p := newClusterPlane("c", ProfileFocused, DiscoveryModeTargeted, ObservationScope{})
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

	res, hot, wh, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, 0)
	if res.Pods != 1 {
		t.Fatalf("pods: %d", res.Pods)
	}
	if res.DaemonSets != 1 || res.StatefulSets != 1 || res.ReplicaSets != 1 || res.Jobs != 1 || res.CronJobs != 1 {
		t.Fatalf("workload totals: %+v", res)
	}
	if res.ConfigMaps != 1 || res.Secrets != 1 || res.ServiceAccounts != 1 || res.Roles != 1 || res.RoleBindings != 1 || res.HelmReleases != 1 {
		t.Fatalf("config/access totals: %+v", res)
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
	if cov.ResourceTotalsCompleteness != "complete" || cov.NamespacesInResourceTotals != 1 {
		t.Fatalf("cov %+v", cov)
	}
	if cov.VisibleNamespaces != 1 {
		t.Fatalf("visible %d", cov.VisibleNamespaces)
	}
}

func TestAggregateClusterDashboard_NoCacheUnknownTotals(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx2")
	plane := planeAny.(*clusterPlane)

	res, _, _, cov := mm.aggregateClusterDashboard(plane, []string{"x", "y"}, 2, 0)
	if res.Pods != 0 || cov.ResourceTotalsCompleteness != "unknown" || cov.NamespacesInResourceTotals != 0 {
		t.Fatalf("res=%+v cov=%+v", res, cov)
	}
}
