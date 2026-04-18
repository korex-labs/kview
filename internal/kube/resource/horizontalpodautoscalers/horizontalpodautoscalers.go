package horizontalpodautoscalers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	apiresource "k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

const (
	hpaGaugeWarnPercent = 80
	hpaGaugeCritPercent = 100
)

func ListHorizontalPodAutoscalers(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.HorizontalPodAutoscalerDTO, error) {
	items, err := c.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.HorizontalPodAutoscalerDTO, 0, len(items.Items))
	for _, hpa := range items.Items {
		out = append(out, summarizeHPA(hpa, now))
	}
	return out, nil
}

func GetHorizontalPodAutoscalerDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.HorizontalPodAutoscalerDetailsDTO, error) {
	hpa, err := c.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := hpaYAML(hpa)
	if err != nil {
		return nil, err
	}

	summary := summarizeHPA(*hpa, time.Now())
	return &dto.HorizontalPodAutoscalerDetailsDTO{
		Summary: summary,
		Spec: dto.HPASpecDTO{
			ScaleTargetRef: scaleTargetRef(hpa.Spec.ScaleTargetRef),
			MinReplicas:    minReplicas(hpa.Spec.MinReplicas),
			MaxReplicas:    hpa.Spec.MaxReplicas,
			Behavior:       hpaBehaviorSummary(hpa.Spec.Behavior),
		},
		Metrics:    summary.CurrentMetrics,
		Conditions: summary.Conditions,
		Metadata: dto.HPAMetadataDTO{
			Labels:      hpa.Labels,
			Annotations: hpa.Annotations,
		},
		YAML: string(y),
	}, nil
}

func GetHorizontalPodAutoscalerYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	hpa, err := c.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	y, err := hpaYAML(hpa)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func summarizeHPA(hpa autoscalingv2.HorizontalPodAutoscaler, now time.Time) dto.HorizontalPodAutoscalerDTO {
	age := int64(0)
	if !hpa.CreationTimestamp.IsZero() {
		age = int64(now.Sub(hpa.CreationTimestamp.Time).Seconds())
	}
	lastScaleTime := int64(0)
	if hpa.Status.LastScaleTime != nil {
		lastScaleTime = hpa.Status.LastScaleTime.Unix()
	}
	out := dto.HorizontalPodAutoscalerDTO{
		Name:             hpa.Name,
		Namespace:        hpa.Namespace,
		ScaleTargetRef:   scaleTargetRef(hpa.Spec.ScaleTargetRef),
		MinReplicas:      minReplicas(hpa.Spec.MinReplicas),
		MaxReplicas:      hpa.Spec.MaxReplicas,
		CurrentReplicas:  hpa.Status.CurrentReplicas,
		DesiredReplicas:  hpa.Status.DesiredReplicas,
		CurrentGauge:     hpaGauge(hpa.Status.CurrentReplicas, hpa.Spec.MaxReplicas),
		DesiredGauge:     hpaGauge(hpa.Status.DesiredReplicas, hpa.Spec.MaxReplicas),
		CurrentMetrics:   hpaMetrics(hpa.Status.CurrentMetrics, hpa.Spec.Metrics),
		Conditions:       hpaConditions(hpa.Status.Conditions),
		AgeSec:           age,
		LastScaleTime:    lastScaleTime,
		HealthBucket:     "healthy",
		NeedsAttention:   false,
		AttentionReasons: nil,
	}
	out.AttentionReasons = hpaAttentionReasons(out)
	if len(out.AttentionReasons) > 0 {
		out.NeedsAttention = true
		out.HealthBucket = "degraded"
	} else if out.CurrentReplicas != out.DesiredReplicas {
		out.HealthBucket = "progressing"
	}
	return out
}

func minReplicas(v *int32) int32 {
	if v == nil {
		return 1
	}
	return *v
}

func hpaGauge(value, max int32) dto.HPAGaugeDTO {
	out := dto.HPAGaugeDTO{
		Value: float64(value),
		Max:   float64(max),
	}
	if max <= 0 {
		return out
	}
	out.Percent = clampPercent((float64(value) / float64(max)) * 100)
	out.Tone = hpaGaugeTone(out.Percent)
	return out
}

func scaleTargetRef(ref autoscalingv2.CrossVersionObjectReference) dto.ScaleTargetRefDTO {
	return dto.ScaleTargetRefDTO{
		Kind:       ref.Kind,
		Name:       ref.Name,
		APIVersion: ref.APIVersion,
	}
}

func hpaConditions(items []autoscalingv2.HorizontalPodAutoscalerCondition) []dto.HPAConditionDTO {
	if len(items) == 0 {
		return nil
	}
	out := make([]dto.HPAConditionDTO, 0, len(items))
	for _, c := range items {
		out = append(out, dto.HPAConditionDTO{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: unixMetaTime(c.LastTransitionTime),
		})
	}
	return out
}

func hpaMetrics(status []autoscalingv2.MetricStatus, spec []autoscalingv2.MetricSpec) []dto.HPAMetricDTO {
	if len(status) == 0 && len(spec) == 0 {
		return nil
	}
	out := make([]dto.HPAMetricDTO, 0, max(len(status), len(spec)))
	byKey := map[string]int{}
	for _, metric := range spec {
		target, targetValue := metricTarget(metric)
		item := dto.HPAMetricDTO{
			Type:        string(metric.Type),
			Name:        metricSpecName(metric),
			Target:      target,
			TargetValue: targetValue,
		}
		setMetricGauge(&item)
		byKey[metricDTOKey(item)] = len(out)
		out = append(out, item)
	}
	for _, metric := range status {
		current, currentValue := metricCurrentValue(metric)
		item := dto.HPAMetricDTO{
			Type:         string(metric.Type),
			Name:         metricStatusName(metric),
			Current:      current,
			CurrentValue: currentValue,
		}
		if idx, ok := byKey[metricDTOKey(item)]; ok {
			out[idx].Current = item.Current
			out[idx].CurrentValue = item.CurrentValue
			setMetricGauge(&out[idx])
			continue
		}
		setMetricGauge(&item)
		out = append(out, item)
	}
	return out
}

func metricDTOKey(metric dto.HPAMetricDTO) string {
	return metric.Type + "/" + metric.Name
}

func metricStatusName(metric autoscalingv2.MetricStatus) string {
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if metric.Resource != nil {
			return string(metric.Resource.Name)
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if metric.ContainerResource != nil {
			return metric.ContainerResource.Container + "/" + string(metric.ContainerResource.Name)
		}
	case autoscalingv2.PodsMetricSourceType:
		if metric.Pods != nil {
			return metric.Pods.Metric.Name
		}
	case autoscalingv2.ObjectMetricSourceType:
		if metric.Object != nil {
			return metric.Object.DescribedObject.Kind + "/" + metric.Object.DescribedObject.Name + ":" + metric.Object.Metric.Name
		}
	case autoscalingv2.ExternalMetricSourceType:
		if metric.External != nil {
			return metric.External.Metric.Name
		}
	}
	return ""
}

func metricSpecName(metric autoscalingv2.MetricSpec) string {
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if metric.Resource != nil {
			return string(metric.Resource.Name)
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if metric.ContainerResource != nil {
			return metric.ContainerResource.Container + "/" + string(metric.ContainerResource.Name)
		}
	case autoscalingv2.PodsMetricSourceType:
		if metric.Pods != nil {
			return metric.Pods.Metric.Name
		}
	case autoscalingv2.ObjectMetricSourceType:
		if metric.Object != nil {
			return metric.Object.DescribedObject.Kind + "/" + metric.Object.DescribedObject.Name + ":" + metric.Object.Metric.Name
		}
	case autoscalingv2.ExternalMetricSourceType:
		if metric.External != nil {
			return metric.External.Metric.Name
		}
	}
	return ""
}

func metricCurrentValue(metric autoscalingv2.MetricStatus) (string, *float64) {
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if metric.Resource != nil {
			return metricValue(metric.Resource.Current)
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if metric.ContainerResource != nil {
			return metricValue(metric.ContainerResource.Current)
		}
	case autoscalingv2.PodsMetricSourceType:
		if metric.Pods != nil && metric.Pods.Current.AverageValue != nil {
			return metric.Pods.Current.AverageValue.String(), quantityFloat64(metric.Pods.Current.AverageValue)
		}
	case autoscalingv2.ObjectMetricSourceType:
		if metric.Object != nil {
			return metricValue(metric.Object.Current)
		}
	case autoscalingv2.ExternalMetricSourceType:
		if metric.External != nil {
			return metricValue(metric.External.Current)
		}
	}
	return "", nil
}

func metricTarget(metric autoscalingv2.MetricSpec) (string, *float64) {
	switch metric.Type {
	case autoscalingv2.ResourceMetricSourceType:
		if metric.Resource != nil {
			return metricTargetValue(metric.Resource.Target)
		}
	case autoscalingv2.ContainerResourceMetricSourceType:
		if metric.ContainerResource != nil {
			return metricTargetValue(metric.ContainerResource.Target)
		}
	case autoscalingv2.PodsMetricSourceType:
		if metric.Pods != nil {
			return metricTargetValue(metric.Pods.Target)
		}
	case autoscalingv2.ObjectMetricSourceType:
		if metric.Object != nil {
			return metricTargetValue(metric.Object.Target)
		}
	case autoscalingv2.ExternalMetricSourceType:
		if metric.External != nil {
			return metricTargetValue(metric.External.Target)
		}
	}
	return "", nil
}

func metricValue(value autoscalingv2.MetricValueStatus) (string, *float64) {
	if value.AverageUtilization != nil {
		v := float64(*value.AverageUtilization)
		return fmt.Sprintf("%d%%", *value.AverageUtilization), &v
	}
	if value.AverageValue != nil {
		return value.AverageValue.String(), quantityFloat64(value.AverageValue)
	}
	if value.Value != nil {
		return value.Value.String(), quantityFloat64(value.Value)
	}
	return "", nil
}

func metricTargetValue(target autoscalingv2.MetricTarget) (string, *float64) {
	switch target.Type {
	case autoscalingv2.UtilizationMetricType:
		if target.AverageUtilization != nil {
			v := float64(*target.AverageUtilization)
			return fmt.Sprintf("%d%% average utilization", *target.AverageUtilization), &v
		}
	case autoscalingv2.AverageValueMetricType:
		if target.AverageValue != nil {
			return target.AverageValue.String() + " average", quantityFloat64(target.AverageValue)
		}
	case autoscalingv2.ValueMetricType:
		if target.Value != nil {
			return target.Value.String(), quantityFloat64(target.Value)
		}
	}
	return string(target.Type), nil
}

func quantityFloat64(q *apiresource.Quantity) *float64 {
	if q == nil {
		return nil
	}
	v := q.AsApproximateFloat64()
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return nil
	}
	return &v
}

func setMetricGauge(metric *dto.HPAMetricDTO) {
	if metric == nil || metric.CurrentValue == nil || metric.TargetValue == nil || *metric.TargetValue <= 0 {
		return
	}
	percent := clampPercent((*metric.CurrentValue / *metric.TargetValue) * 100)
	metric.GaugePercent = &percent
	metric.GaugeTone = hpaGaugeTone(percent)
}

func clampPercent(v float64) float64 {
	if math.IsInf(v, 0) || math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func hpaGaugeTone(percent float64) string {
	if percent >= hpaGaugeCritPercent {
		return "error"
	}
	if percent >= hpaGaugeWarnPercent {
		return "warning"
	}
	return "success"
}

func hpaAttentionReasons(hpa dto.HorizontalPodAutoscalerDTO) []string {
	var reasons []string
	if hpa.ScaleTargetRef.Kind == "" || hpa.ScaleTargetRef.Name == "" {
		reasons = append(reasons, "missing scale target reference")
	}
	if hpa.MaxReplicas > 0 && hpa.CurrentReplicas >= hpa.MaxReplicas && hpa.DesiredReplicas >= hpa.MaxReplicas {
		reasons = append(reasons, "replicas are pinned at maxReplicas")
	}
	if hpa.CurrentReplicas < hpa.MinReplicas {
		reasons = append(reasons, "current replicas are below minReplicas")
	}
	for _, c := range hpa.Conditions {
		if c.Type == "AbleToScale" && c.Status == "False" {
			reasons = append(reasons, conditionReason("unable to scale", c))
		}
		if c.Type == "ScalingActive" && c.Status == "False" {
			reasons = append(reasons, conditionReason("scaling is inactive", c))
		}
	}
	return reasons
}

func conditionReason(fallback string, c dto.HPAConditionDTO) string {
	if c.Reason == "" {
		return fallback
	}
	return fallback + ": " + c.Reason
}

func hpaBehaviorSummary(behavior *autoscalingv2.HorizontalPodAutoscalerBehavior) string {
	if behavior == nil {
		return ""
	}
	parts := []string{}
	if behavior.ScaleUp != nil {
		parts = append(parts, "scaleUp")
	}
	if behavior.ScaleDown != nil {
		parts = append(parts, "scaleDown")
	}
	return strings.Join(parts, ", ")
}

func unixMetaTime(t metav1.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
}

func hpaYAML(hpa *autoscalingv2.HorizontalPodAutoscaler) ([]byte, error) {
	copy := hpa.DeepCopy()
	copy.ManagedFields = nil
	b, err := json.Marshal(copy)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}
