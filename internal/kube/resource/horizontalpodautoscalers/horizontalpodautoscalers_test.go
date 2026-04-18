package horizontalpodautoscalers

import (
	"testing"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestHPAMetricsUseSpecWhenStatusIsEmpty(t *testing.T) {
	utilization := int32(5000)
	got := hpaMetrics(nil, []autoscalingv2.MetricSpec{
		{
			Type: autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricSource{
				Name: corev1.ResourceCPU,
				Target: autoscalingv2.MetricTarget{
					Type:               autoscalingv2.UtilizationMetricType,
					AverageUtilization: &utilization,
				},
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("expected one metric, got %d", len(got))
	}
	if got[0].Type != "Resource" {
		t.Fatalf("expected metric type Resource, got %q", got[0].Type)
	}
	if got[0].Name != "cpu" {
		t.Fatalf("expected metric name cpu, got %q", got[0].Name)
	}
	if got[0].Target != "5000% average utilization" {
		t.Fatalf("expected target from spec, got %q", got[0].Target)
	}
	if got[0].Current != "" {
		t.Fatalf("expected no current metric without status, got %q", got[0].Current)
	}
	if got[0].TargetValue == nil || *got[0].TargetValue != 5000 {
		t.Fatalf("expected normalized target value 5000, got %#v", got[0].TargetValue)
	}
	if got[0].GaugePercent != nil {
		t.Fatalf("expected no gauge without current status, got %#v", got[0].GaugePercent)
	}
}

func TestHPAMetricsOverlayStatusOnSpecMetric(t *testing.T) {
	target := int32(80)
	current := int32(50)
	got := hpaMetrics([]autoscalingv2.MetricStatus{
		{
			Type: autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricStatus{
				Name: corev1.ResourceCPU,
				Current: autoscalingv2.MetricValueStatus{
					AverageUtilization: &current,
				},
			},
		},
	}, []autoscalingv2.MetricSpec{
		{
			Type: autoscalingv2.ResourceMetricSourceType,
			Resource: &autoscalingv2.ResourceMetricSource{
				Name: corev1.ResourceCPU,
				Target: autoscalingv2.MetricTarget{
					Type:               autoscalingv2.UtilizationMetricType,
					AverageUtilization: &target,
				},
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("expected one merged metric, got %d", len(got))
	}
	if got[0].Name != "cpu" || got[0].Target != "80% average utilization" || got[0].Current != "50%" {
		t.Fatalf("unexpected merged metric: %#v", got[0])
	}
	if got[0].CurrentValue == nil || *got[0].CurrentValue != 50 {
		t.Fatalf("expected normalized current value 50, got %#v", got[0].CurrentValue)
	}
	if got[0].TargetValue == nil || *got[0].TargetValue != 80 {
		t.Fatalf("expected normalized target value 80, got %#v", got[0].TargetValue)
	}
	if got[0].GaugePercent == nil || *got[0].GaugePercent != 62.5 {
		t.Fatalf("expected gauge percent 62.5, got %#v", got[0].GaugePercent)
	}
	if got[0].GaugeTone != "success" {
		t.Fatalf("expected success gauge tone, got %q", got[0].GaugeTone)
	}
}

func TestHPAMetricsNormalizeQuantityTargets(t *testing.T) {
	current := resource.MustParse("6250m")
	target := resource.MustParse("40")
	got := hpaMetrics([]autoscalingv2.MetricStatus{
		{
			Type: autoscalingv2.ExternalMetricSourceType,
			External: &autoscalingv2.ExternalMetricStatus{
				Metric: autoscalingv2.MetricIdentifier{Name: "s2-prometheus"},
				Current: autoscalingv2.MetricValueStatus{
					AverageValue: &current,
				},
			},
		},
	}, []autoscalingv2.MetricSpec{
		{
			Type: autoscalingv2.ExternalMetricSourceType,
			External: &autoscalingv2.ExternalMetricSource{
				Metric: autoscalingv2.MetricIdentifier{Name: "s2-prometheus"},
				Target: autoscalingv2.MetricTarget{
					Type:         autoscalingv2.AverageValueMetricType,
					AverageValue: &target,
				},
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("expected one merged metric, got %d", len(got))
	}
	if got[0].Current != "6250m" || got[0].Target != "40 average" {
		t.Fatalf("unexpected quantity labels: %#v", got[0])
	}
	if got[0].CurrentValue == nil || *got[0].CurrentValue != 6.25 {
		t.Fatalf("expected normalized current value 6.25, got %#v", got[0].CurrentValue)
	}
	if got[0].TargetValue == nil || *got[0].TargetValue != 40 {
		t.Fatalf("expected normalized target value 40, got %#v", got[0].TargetValue)
	}
	if got[0].GaugePercent == nil || *got[0].GaugePercent != 15.625 {
		t.Fatalf("expected gauge percent 15.625, got %#v", got[0].GaugePercent)
	}
	if got[0].GaugeTone != "success" {
		t.Fatalf("expected success gauge tone, got %q", got[0].GaugeTone)
	}
}
