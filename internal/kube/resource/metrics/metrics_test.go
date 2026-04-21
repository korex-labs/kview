package metrics

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func TestMapPodMetrics(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	pm := metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "ns"},
		Timestamp:  metav1.NewTime(ts),
		Window:     metav1.Duration{Duration: 30 * time.Second},
		Containers: []metricsv1beta1.ContainerMetrics{
			{
				Name: "a",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("250m"),
					corev1.ResourceMemory: resource.MustParse("128Mi"),
				},
			},
			{
				Name: "b",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU: resource.MustParse("1500m"),
				},
			},
		},
	}
	out := mapPodMetrics(pm)
	if out.Name != "p" || out.Namespace != "ns" {
		t.Fatalf("identity: %+v", out)
	}
	if out.WindowSec != 30 || out.CapturedAt != ts.Unix() {
		t.Fatalf("window/captured: %+v", out)
	}
	if len(out.Containers) != 2 {
		t.Fatalf("containers: %d", len(out.Containers))
	}
	if out.Containers[0].CPUMilli != 250 || out.Containers[0].MemoryBytes != 128*1024*1024 {
		t.Fatalf("c0: %+v", out.Containers[0])
	}
	if out.Containers[1].CPUMilli != 1500 || out.Containers[1].MemoryBytes != 0 {
		t.Fatalf("c1: %+v", out.Containers[1])
	}
}

func TestMapNodeMetrics(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	nm := metricsv1beta1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "n1"},
		Timestamp:  metav1.NewTime(ts),
		Window:     metav1.Duration{Duration: 60 * time.Second},
		Usage: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("2"),
			corev1.ResourceMemory: resource.MustParse("1Gi"),
		},
	}
	out := mapNodeMetrics(nm)
	if out.Name != "n1" || out.WindowSec != 60 || out.CapturedAt != ts.Unix() {
		t.Fatalf("identity: %+v", out)
	}
	if out.CPUMilli != 2000 || out.MemoryBytes != 1024*1024*1024 {
		t.Fatalf("usage: %+v", out)
	}
}

func TestDurationSeconds(t *testing.T) {
	if durationSeconds(0) != 0 {
		t.Fatal("zero")
	}
	if durationSeconds(-1) != 0 {
		t.Fatal("negative")
	}
	if got := durationSeconds(45 * time.Second); got != 45 {
		t.Fatalf("got %d", got)
	}
}
