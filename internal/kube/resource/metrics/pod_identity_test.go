package metrics

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func TestMapPodMetricsPreservesInstanceEvidence(t *testing.T) {
	pm := metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "ns", CreationTimestamp: metav1.NewTime(time.Unix(999, 0))},
		Timestamp:  metav1.NewTime(time.Unix(200, 0)), Window: metav1.Duration{Duration: 30500 * time.Millisecond},
	}
	got := mapPodMetrics(pm)
	if got.UID != "" || got.CapturedAt != 200 || got.WindowSec != 31 {
		t.Fatalf("UID-less sample evidence: %+v", got)
	}
	pm.UID = "pod-A"
	got = mapPodMetrics(pm)
	if got.UID != "pod-A" {
		t.Fatalf("lost UID: %+v", got)
	}
	pm.Timestamp = metav1.Time{}
	pm.Window.Duration = -time.Second
	got = mapPodMetrics(pm)
	if got.CapturedAt != 0 || got.WindowSec != -1 {
		t.Fatalf("unknown/invalid time became positive evidence: %+v", got)
	}
}
