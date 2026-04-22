package dto

type DaemonSetDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Desired            int32  `json:"desired"`
	Current            int32  `json:"current"`
	Ready              int32  `json:"ready"`
	Updated            int32  `json:"updated"`
	Available          int32  `json:"available"`
	UpdateStrategy     string `json:"updateStrategy,omitempty"`
	Selector           string `json:"selector,omitempty"`
	AgeSec             int64  `json:"ageSec"`
	HealthBucket       string `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type DaemonSetDetailsDTO struct {
	Summary    DaemonSetSummaryDTO     `json:"summary"`
	Conditions []DaemonSetConditionDTO `json:"conditions"`
	Pods       []DaemonSetPodDTO       `json:"pods"`
	Spec       DaemonSetSpecDTO        `json:"spec"`
	Metadata   DaemonSetMetadataDTO    `json:"metadata"`
	YAML       string                  `json:"yaml"`
}

type DaemonSetSummaryDTO struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	UpdateStrategy string `json:"updateStrategy,omitempty"`
	MaxUnavailable string `json:"maxUnavailable,omitempty"`
	MaxSurge       string `json:"maxSurge,omitempty"`
	Selector       string `json:"selector,omitempty"`
	Desired        int32  `json:"desired"`
	Current        int32  `json:"current"`
	Ready          int32  `json:"ready"`
	Updated        int32  `json:"updated"`
	Available      int32  `json:"available"`
	AgeSec         int64  `json:"ageSec"`
}

type DaemonSetConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type DaemonSetPodDTO struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Node     string `json:"node,omitempty"`
	AgeSec   int64  `json:"ageSec"`
}

type DaemonSetSpecDTO struct {
	PodTemplate       PodTemplateSummaryDTO        `json:"podTemplate"`
	Scheduling        DaemonSetSchedulingDTO       `json:"scheduling"`
	Volumes           []VolumeDTO                  `json:"volumes,omitempty"`
	MissingReferences []MissingReferenceDTO        `json:"missingReferences,omitempty"`
	Metadata          DaemonSetTemplateMetadataDTO `json:"metadata"`
}

type DaemonSetSchedulingDTO struct {
	NodeSelector              map[string]string             `json:"nodeSelector,omitempty"`
	AffinitySummary           string                        `json:"affinitySummary,omitempty"`
	Tolerations               []TolerationDTO               `json:"tolerations,omitempty"`
	TopologySpreadConstraints []TopologySpreadConstraintDTO `json:"topologySpreadConstraints,omitempty"`
}

type DaemonSetTemplateMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type DaemonSetMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
