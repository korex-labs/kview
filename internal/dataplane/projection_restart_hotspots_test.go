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
			{Name: "a", Restarts: 2, Phase: "Running", AgeSec: 86400},
			{Name: "b", Restarts: 9, Phase: "Running", AgeSec: 43200},
			{Name: "c", Restarts: 9, Phase: "Running", AgeSec: 21600},
			{Name: "d", Restarts: 0, Phase: "Running", AgeSec: 86400},
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
	if out.Items[0].RestartRatePerDay != 18 {
		t.Fatalf("expected restart rate 18/day, got %v", out.Items[0].RestartRatePerDay)
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

func TestRestartRatePerDay(t *testing.T) {
	if got := restartRatePerDay(12, 86400); got != 12 {
		t.Fatalf("expected 12, got %v", got)
	}
	if got := restartRatePerDay(3, 3600); got != 72 {
		t.Fatalf("expected 72, got %v", got)
	}
	if got := restartRatePerDay(1, 172800); got != 0.5 {
		t.Fatalf("expected 0.5, got %v", got)
	}
	if got := restartRatePerDay(0, 86400); got != 0 {
		t.Fatalf("expected 0, got %v", got)
	}
}
