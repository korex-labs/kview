package dto

type StatefulSetDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Desired            int32  `json:"desired"`
	Ready              int32  `json:"ready"`
	Current            int32  `json:"current"`
	Updated            int32  `json:"updated"`
	ServiceName        string `json:"serviceName,omitempty"`
	UpdateStrategy     string `json:"updateStrategy,omitempty"`
	Selector           string `json:"selector,omitempty"`
	AgeSec             int64  `json:"ageSec"`
	HealthBucket       string `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type StatefulSetDetailsDTO struct {
	Summary    StatefulSetSummaryDTO     `json:"summary"`
	Conditions []StatefulSetConditionDTO `json:"conditions"`
	Pods       []StatefulSetPodDTO       `json:"pods"`
	Spec       StatefulSetSpecDTO        `json:"spec"`
	Metadata   StatefulSetMetadataDTO    `json:"metadata"`
	YAML       string                    `json:"yaml"`
}

type StatefulSetSummaryDTO struct {
	Name                 string `json:"name"`
	Namespace            string `json:"namespace"`
	ServiceName          string `json:"serviceName,omitempty"`
	PodManagementPolicy  string `json:"podManagementPolicy,omitempty"`
	UpdateStrategy       string `json:"updateStrategy,omitempty"`
	UpdatePartition      *int32 `json:"updatePartition,omitempty"`
	RevisionHistoryLimit *int32 `json:"revisionHistoryLimit,omitempty"`
	Selector             string `json:"selector,omitempty"`
	Desired              int32  `json:"desired"`
	Current              int32  `json:"current"`
	Ready                int32  `json:"ready"`
	Updated              int32  `json:"updated"`
	AgeSec               int64  `json:"ageSec"`
}

type StatefulSetConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type StatefulSetPodDTO struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Node     string `json:"node,omitempty"`
	AgeSec   int64  `json:"ageSec"`
}

type StatefulSetSpecDTO struct {
	PodTemplate       PodTemplateSummaryDTO          `json:"podTemplate"`
	Scheduling        StatefulSetSchedulingDTO       `json:"scheduling"`
	Volumes           []VolumeDTO                    `json:"volumes,omitempty"`
	MissingReferences []MissingReferenceDTO          `json:"missingReferences,omitempty"`
	Metadata          StatefulSetTemplateMetadataDTO `json:"metadata"`
}

type StatefulSetSchedulingDTO struct {
	NodeSelector              map[string]string             `json:"nodeSelector,omitempty"`
	AffinitySummary           string                        `json:"affinitySummary,omitempty"`
	Tolerations               []TolerationDTO               `json:"tolerations,omitempty"`
	TopologySpreadConstraints []TopologySpreadConstraintDTO `json:"topologySpreadConstraints,omitempty"`
}

type StatefulSetTemplateMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type StatefulSetMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
