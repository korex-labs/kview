package dataplane

import (
	"testing"
	"time"

	"kview/internal/kube/dto"
)

func TestBuildNamespaceListRowProjection_OKWithCounts(t *testing.T) {
	pods := PodsSnapshot{
		Items: []dto.PodListItemDTO{
			{Name: "a", Phase: "Running", Ready: "1/1", Restarts: 0},
			{Name: "b", Phase: "Running", Ready: "1/1", Restarts: 6},
		},
	}
	deps := DeploymentsSnapshot{
		Items: []dto.DeploymentListItemDTO{
			{Name: "d1", Status: "Available", UpToDate: 1, Available: 1},
		},
	}
	got := buildNamespaceListRowProjection(pods, deps)
	if !got.RowEnriched {
		t.Fatal("expected row enriched")
	}
	if got.SummaryState != "ok" {
		t.Fatalf("state %q", got.SummaryState)
	}
	if got.PodCount != 2 || got.DeploymentCount != 1 {
		t.Fatalf("counts %d %d", got.PodCount, got.DeploymentCount)
	}
	if got.PodsWithRestarts != 1 || !got.RestartHotspot {
		t.Fatalf("restarts %d hotspot %v", got.PodsWithRestarts, got.RestartHotspot)
	}
	if got.ProblematicCount != 0 {
		t.Fatalf("problematic %d", got.ProblematicCount)
	}
}

func TestBuildNamespaceListRowProjection_ProblematicPodAndDeploy(t *testing.T) {
	pods := PodsSnapshot{
		Items: []dto.PodListItemDTO{
			{Name: "bad", Phase: "Failed", Ready: "0/1", Restarts: 0},
		},
	}
	deps := DeploymentsSnapshot{
		Items: []dto.DeploymentListItemDTO{
			{Name: "roll", Status: "Progressing", UpToDate: 2, Available: 1},
		},
	}
	got := buildNamespaceListRowProjection(pods, deps)
	if got.ProblematicCount != 2 {
		t.Fatalf("expected 2 unique problematic, got %d", got.ProblematicCount)
	}
}

func TestBuildNamespaceListRowProjection_Denied(t *testing.T) {
	pods := PodsSnapshot{
		Err: &NormalizedError{Class: NormalizedErrorClassAccessDenied},
	}
	deps := DeploymentsSnapshot{
		Items: []dto.DeploymentListItemDTO{{Name: "d", Status: "Available", UpToDate: 1, Available: 1}},
	}
	got := buildNamespaceListRowProjection(pods, deps)
	if got.SummaryState != "denied" {
		t.Fatalf("state %q", got.SummaryState)
	}
	if got.PodCount != 0 || got.DeploymentCount != 1 {
		t.Fatalf("podCount=%d depCount=%d", got.PodCount, got.DeploymentCount)
	}
}

func TestBuildNamespaceListRowProjection_Empty(t *testing.T) {
	got := buildNamespaceListRowProjection(PodsSnapshot{}, DeploymentsSnapshot{})
	if got.SummaryState != "empty" {
		t.Fatalf("state %q", got.SummaryState)
	}
}

func TestCountUniqueProblematic_DedupesKindName(t *testing.T) {
	a := []dto.ProblematicResource{{Kind: "Pod", Name: "x"}}
	b := []dto.ProblematicResource{{Kind: "Pod", Name: "x"}}
	if n := countUniqueProblematic(a, b); n != 1 {
		t.Fatalf("got %d", n)
	}
}

func TestMergeNamespaceRowIntoIgnoresListOnlyPatch(t *testing.T) {
	dst := dto.NamespaceListItemDTO{
		Name:             "app",
		RowEnriched:      true,
		SummaryState:     "warning",
		PodCount:         3,
		DeploymentCount:  2,
		ProblematicCount: 1,
		PodsWithRestarts: 1,
		RestartHotspot:   true,
	}

	mergeNamespaceRowInto(&dst, dto.NamespaceListItemDTO{Name: "app"})

	if !dst.RowEnriched || dst.PodCount != 3 || dst.DeploymentCount != 2 || dst.SummaryState != "warning" || !dst.RestartHotspot {
		t.Fatalf("list-only patch should not reset enriched fields: %+v", dst)
	}
}

func TestBuildCachedNamespaceListRowProjection_QuotaAndLimits(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil)
	ratio := 0.91
	setNamespacedSnapshot(&plane.rqStore, "app", ResourceQuotasSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.ResourceQuotaDTO{{
			Name:      "rq",
			Namespace: "app",
			Entries:   []dto.ResourceQuotaEntryDTO{{Key: "pods", Used: "9", Hard: "10", Ratio: &ratio}},
		}},
	})
	setNamespacedSnapshot(&plane.lrStore, "app", LimitRangesSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.LimitRangeDTO{{Name: "limits", Namespace: "app"}},
	})

	got, ok := buildCachedNamespaceListRowProjection(plane, "app")
	if !ok || !got.RowEnriched {
		t.Fatalf("expected cached projection, ok=%v got=%+v", ok, got)
	}
	if got.ResourceQuotaCount != 1 || got.LimitRangeCount != 1 || !got.QuotaCritical || !got.QuotaWarning {
		t.Fatalf("quota/limit fields: %+v", got)
	}
}

func TestMergeCachedNamespaceRowProjectionOverlaysItems(t *testing.T) {
	m := &manager{
		planes: map[string]*clusterPlane{},
	}
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil)
	m.planes["ctx"] = plane

	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.PodListItemDTO{
			{Name: "p1", Phase: "Running", Ready: "1/1", Restarts: 0},
		},
	})
	setNamespacedSnapshot(&plane.depsStore, "app", DeploymentsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.DeploymentListItemDTO{
			{Name: "d1", Status: "Available", UpToDate: 1, Available: 1},
		},
	})

	items, enriched := m.MergeCachedNamespaceRowProjection(t.Context(), "ctx", []dto.NamespaceListItemDTO{
		{Name: "app", Phase: "Active"},
		{Name: "plain", Phase: "Active"},
	})
	if enriched != 1 {
		t.Fatalf("expected 1 enriched item, got %d", enriched)
	}
	if !items[0].RowEnriched || items[0].PodCount != 1 || items[0].DeploymentCount != 1 {
		t.Fatalf("expected cached metrics on first row, got %+v", items[0])
	}
	if items[1].RowEnriched {
		t.Fatalf("expected second row to remain list-only, got %+v", items[1])
	}
}
