package dataplane

import (
	"testing"

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
