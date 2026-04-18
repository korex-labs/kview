package dto

type HorizontalPodAutoscalerDTO struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	ScaleTargetRef   ScaleTargetRefDTO `json:"scaleTargetRef"`
	MinReplicas      int32             `json:"minReplicas"`
	MaxReplicas      int32             `json:"maxReplicas"`
	CurrentReplicas  int32             `json:"currentReplicas"`
	DesiredReplicas  int32             `json:"desiredReplicas"`
	CurrentGauge     HPAGaugeDTO       `json:"currentGauge"`
	DesiredGauge     HPAGaugeDTO       `json:"desiredGauge"`
	CurrentMetrics   []HPAMetricDTO    `json:"currentMetrics,omitempty"`
	Conditions       []HPAConditionDTO `json:"conditions,omitempty"`
	AgeSec           int64             `json:"ageSec"`
	HealthBucket     string            `json:"healthBucket,omitempty"`
	NeedsAttention   bool              `json:"needsAttention,omitempty"`
	AttentionReasons []string          `json:"attentionReasons,omitempty"`
	LastScaleTime    int64             `json:"lastScaleTime,omitempty"`
}

type HorizontalPodAutoscalerDetailsDTO struct {
	Summary    HorizontalPodAutoscalerDTO `json:"summary"`
	Spec       HPASpecDTO                 `json:"spec"`
	Metrics    []HPAMetricDTO             `json:"metrics,omitempty"`
	Conditions []HPAConditionDTO          `json:"conditions,omitempty"`
	Metadata   HPAMetadataDTO             `json:"metadata"`
	YAML       string                     `json:"yaml"`
}

type ScaleTargetRefDTO struct {
	Kind       string `json:"kind,omitempty"`
	Name       string `json:"name,omitempty"`
	APIVersion string `json:"apiVersion,omitempty"`
}

type HPASpecDTO struct {
	ScaleTargetRef ScaleTargetRefDTO `json:"scaleTargetRef"`
	MinReplicas    int32             `json:"minReplicas"`
	MaxReplicas    int32             `json:"maxReplicas"`
	Behavior       string            `json:"behavior,omitempty"`
}

type HPAMetricDTO struct {
	Type         string   `json:"type"`
	Name         string   `json:"name,omitempty"`
	Target       string   `json:"target,omitempty"`
	Current      string   `json:"current,omitempty"`
	CurrentValue *float64 `json:"currentValue,omitempty"`
	TargetValue  *float64 `json:"targetValue,omitempty"`
	GaugePercent *float64 `json:"gaugePercent,omitempty"`
	GaugeTone    string   `json:"gaugeTone,omitempty"`
	Utilization  *int32   `json:"utilization,omitempty"`
}

type HPAGaugeDTO struct {
	Value   float64 `json:"value"`
	Max     float64 `json:"max"`
	Percent float64 `json:"percent"`
	Tone    string  `json:"tone,omitempty"`
}

type HPAConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type HPAMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
