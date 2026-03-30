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

func TestVisibleNamespacesWithCachedPods(t *testing.T) {
	p := newClusterPlane("c", ProfileFocused, DiscoveryModeTargeted, ObservationScope{})
	now := time.Now().UTC()
	meta := SnapshotMetadata{ObservedAt: now}
	p.podsStore.set("bravo", PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "p1"}}, Meta: meta})

	vis := []string{"alpha", "bravo", "charlie"}
	got := visibleNamespacesWithCachedPods(p, vis)
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
	plane.podsStore.set(ns, PodsSnapshot{
		Meta: meta,
		Items: []dto.PodListItemDTO{
			{Name: "pod-a", Namespace: ns, Restarts: 5, Phase: "Running", Ready: "1/1"},
		},
	})
	plane.depsStore.set(ns, DeploymentsSnapshot{Meta: meta, Items: nil})
	plane.svcsStore.set(ns, ServicesSnapshot{Meta: meta, Items: nil})
	plane.ingStore.set(ns, IngressesSnapshot{Meta: meta, Items: nil})
	plane.pvcsStore.set(ns, PVCsSnapshot{Meta: meta, Items: nil})

	res, hot, wh, cov := mm.aggregateClusterDashboard(plane, []string{ns}, 1, 0)
	if res.Pods != 1 {
		t.Fatalf("pods: %d", res.Pods)
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
