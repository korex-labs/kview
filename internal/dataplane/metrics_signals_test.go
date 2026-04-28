package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestDetectContainerNearLimitSignals(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	ns := "ns"
	s := dashboardSnapshotSet{
		podsOK:                true,
		podMetricsOK:          true,
		containerNearLimitPct: 80,
		pods: PodsSnapshot{Items: []dto.PodListItemDTO{
			{Name: "near", Namespace: ns, Phase: "Running", CPULimitMilli: 100, MemoryLimitBytes: 100 * 1024 * 1024},
			{Name: "calm", Namespace: ns, Phase: "Running", CPULimitMilli: 100, MemoryLimitBytes: 100 * 1024 * 1024},
			{Name: "nolimits", Namespace: ns, Phase: "Running"},
		}},
		podMetrics: PodMetricsSnapshot{Items: []dto.PodMetricsDTO{
			{Name: "near", Namespace: ns, Containers: []dto.ContainerMetricsDTO{{Name: "a", CPUMilli: 95, MemoryBytes: 50 * 1024 * 1024}}},
			{Name: "calm", Namespace: ns, Containers: []dto.ContainerMetricsDTO{{Name: "a", CPUMilli: 10, MemoryBytes: 10 * 1024 * 1024}}},
			{Name: "nolimits", Namespace: ns, Containers: []dto.ContainerMetricsDTO{{Name: "a", CPUMilli: 1000}}},
		}},
	}
	got := detectContainerNearLimitSignals(now, ns, s)
	if len(got) != 1 {
		t.Fatalf("want 1 signal, got %d: %+v", len(got), got)
	}
	if got[0].Name != "near" {
		t.Fatalf("want signal for 'near' got %q", got[0].Name)
	}
}

func TestDetectContainerNearLimitSignals_NoMetrics(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	s := dashboardSnapshotSet{podsOK: true, podMetricsOK: false, containerNearLimitPct: 80}
	if got := detectContainerNearLimitSignals(now, "ns", s); got != nil {
		t.Fatalf("want nil when metrics missing, got %+v", got)
	}
}
