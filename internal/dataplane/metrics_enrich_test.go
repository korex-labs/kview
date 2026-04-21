package dataplane

import (
	"testing"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func TestParseCPUMilli(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"", 0},
		{"100m", 100},
		{"1", 1000},
		{"1.5", 1500},
		{"250m", 250},
		{"bogus", 0},
	}
	for _, c := range cases {
		if got := parseCPUMilli(c.in); got != c.want {
			t.Errorf("parseCPUMilli(%q) = %d want %d", c.in, got, c.want)
		}
	}
}

func TestParseMemoryBytes(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		{"", 0},
		{"128Mi", 128 * 1024 * 1024},
		{"1Gi", 1024 * 1024 * 1024},
		{"1024", 1024},
		{"bogus", 0},
	}
	for _, c := range cases {
		if got := parseMemoryBytes(c.in); got != c.want {
			t.Errorf("parseMemoryBytes(%q) = %d want %d", c.in, got, c.want)
		}
	}
}

func TestPercentMath(t *testing.T) {
	if percentOfMilli(100, 0) != 0 {
		t.Fatalf("zero spec must yield 0")
	}
	if percentOfMilli(500, 1000) != 50.0 {
		t.Fatalf("50 percent expected")
	}
	if percentOfBytes(1024, 0) != 0 {
		t.Fatalf("zero bytes spec must yield 0")
	}
	if got := percentOfBytes(512, 1024); got != 50.0 {
		t.Fatalf("got %v want 50", got)
	}
}

func TestEnrichPodListItemsWithMetrics(t *testing.T) {
	items := []dto.PodListItemDTO{
		{
			Name:               "p1",
			Namespace:          "ns",
			Phase:              "Running",
			Ready:              "1/1",
			CPURequestMilli:    100,
			CPULimitMilli:      200,
			MemoryRequestBytes: 100 * 1024 * 1024,
			MemoryLimitBytes:   200 * 1024 * 1024,
		},
		{
			Name:      "p2",
			Namespace: "ns",
			Phase:     "Running",
			Ready:     "1/1",
		},
	}
	metrics := PodMetricsByKey{
		"ns/p1": {
			"a": dto.ContainerMetricsDTO{Name: "a", CPUMilli: 50, MemoryBytes: 50 * 1024 * 1024},
			"b": dto.ContainerMetricsDTO{Name: "b", CPUMilli: 100, MemoryBytes: 100 * 1024 * 1024},
		},
	}
	out := EnrichPodListItemsWithMetrics(items, metrics)
	if !out[0].UsageAvailable {
		t.Fatalf("p1 should report usage available")
	}
	if out[0].CPUMilli != 150 || out[0].MemoryBytes != 150*1024*1024 {
		t.Fatalf("p1 totals: %+v", out[0])
	}
	if out[0].CPUPctRequest != 150.0 {
		t.Fatalf("CPUPctRequest expected 150 got %v", out[0].CPUPctRequest)
	}
	if out[0].CPUPctLimit != 75.0 {
		t.Fatalf("CPUPctLimit expected 75 got %v", out[0].CPUPctLimit)
	}
	if out[1].UsageAvailable {
		t.Fatalf("p2 must not report usage when no metrics matched")
	}
}

func TestEnrichNodeListItemsWithMetrics(t *testing.T) {
	items := []dto.NodeListItemDTO{
		{Name: "n1", CPUAllocatable: "2", MemoryAllocatable: "2Gi"},
		{Name: "n2", CPUAllocatable: "4", MemoryAllocatable: "8Gi"},
	}
	metrics := NodeMetricsByName{
		"n1": dto.NodeMetricsDTO{Name: "n1", CPUMilli: 1000, MemoryBytes: 1024 * 1024 * 1024},
	}
	out := EnrichNodeListItemsWithMetrics(items, metrics)
	if !out[0].UsageAvailable {
		t.Fatalf("n1 usage available expected")
	}
	if out[0].CPUPctAlloc != 50.0 {
		t.Fatalf("n1 cpu pct: %v", out[0].CPUPctAlloc)
	}
	if out[0].MemoryPctAlloc != 50.0 {
		t.Fatalf("n1 mem pct: %v", out[0].MemoryPctAlloc)
	}
	if out[1].UsageAvailable {
		t.Fatalf("n2 should be untouched without metrics")
	}
}

func TestMergePodDetailsUsage(t *testing.T) {
	det := &dto.PodDetailsDTO{
		Summary: dto.PodSummaryDTO{Name: "p", Namespace: "ns"},
		Containers: []dto.PodContainerDTO{
			{Name: "a", Resources: dto.ContainerResourcesDTO{CPURequest: "100m", CPULimit: "200m", MemoryRequest: "100Mi", MemoryLimit: "200Mi"}},
		},
	}
	items := []dto.PodMetricsDTO{
		{Name: "p", Namespace: "ns", Containers: []dto.ContainerMetricsDTO{{Name: "a", CPUMilli: 150, MemoryBytes: 150 * 1024 * 1024}}},
	}
	MergePodDetailsUsage(det, items)
	if det.Containers[0].Usage == nil {
		t.Fatalf("expected usage merged")
	}
	if det.Containers[0].Usage.CPUMilli != 150 {
		t.Fatalf("cpu milli got %d", det.Containers[0].Usage.CPUMilli)
	}
	if det.Containers[0].Usage.CPUPctLimit != 75.0 {
		t.Fatalf("cpu pct limit got %v", det.Containers[0].Usage.CPUPctLimit)
	}
}

func TestMergeNodeDetailsUsage(t *testing.T) {
	det := &dto.NodeDetailsDTO{
		Summary: dto.NodeSummaryDTO{Name: "n1"},
		Capacity: dto.NodeCapacityDTO{
			CPUAllocatable:    "4",
			MemoryAllocatable: "8Gi",
		},
	}
	items := []dto.NodeMetricsDTO{
		{Name: "n1", CPUMilli: 2000, MemoryBytes: 4 * 1024 * 1024 * 1024},
	}
	MergeNodeDetailsUsage(det, items)
	if !det.Capacity.UsageAvailable {
		t.Fatalf("expected usage available")
	}
	if det.Capacity.CPUPctAlloc != 50.0 {
		t.Fatalf("cpu pct alloc got %v", det.Capacity.CPUPctAlloc)
	}
	if det.Capacity.MemoryPctAlloc != 50.0 {
		t.Fatalf("mem pct alloc got %v", det.Capacity.MemoryPctAlloc)
	}
}
