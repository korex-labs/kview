package dataplane

import (
	"testing"

	"kview/internal/kube/dto"
)

func TestRestartSeverityFromCount(t *testing.T) {
	if restartSeverityFromCount(25) != restartSeverityHigh {
		t.Fatalf("expected high")
	}
	if restartSeverityFromCount(7) != restartSeverityMedium {
		t.Fatalf("expected medium")
	}
	if restartSeverityFromCount(1) != restartSeverityLow {
		t.Fatalf("expected low")
	}
}

func TestProjectRestartHotspotsFromPods_SortAndLimit(t *testing.T) {
	snap := PodsSnapshot{
		Items: []dto.PodListItemDTO{
			{Name: "a", Restarts: 2, Phase: "Running"},
			{Name: "b", Restarts: 9, Phase: "Running"},
			{Name: "c", Restarts: 9, Phase: "Running"},
			{Name: "d", Restarts: 0, Phase: "Running"},
		},
	}
	out := ProjectRestartHotspotsFromPods("ns", snap, 2)
	if len(out.Items) != 2 {
		t.Fatalf("len=%d", len(out.Items))
	}
	// Same restarts: stable sort by name → b then c
	if out.Items[0].Name != "b" || out.Items[1].Name != "c" {
		t.Fatalf("expected b,c got %q,%q", out.Items[0].Name, out.Items[1].Name)
	}
	if out.Items[0].Namespace != "ns" {
		t.Fatalf("namespace")
	}
}

func TestMergeRestartHotspots(t *testing.T) {
	a := []dto.PodRestartHotspotDTO{{Namespace: "n1", Name: "p1", Restarts: 3}}
	b := []dto.PodRestartHotspotDTO{{Namespace: "n2", Name: "p2", Restarts: 10}}
	m := MergeRestartHotspots(2, a, b)
	if len(m) != 2 || m[0].Restarts != 10 {
		t.Fatalf("merge order: %+v", m)
	}
}
