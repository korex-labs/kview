package dto

type OwnerReferenceDTO struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type ReplicaSetDTO struct {
	Name           string             `json:"name"`
	Namespace      string             `json:"namespace"`
	Revision       int32              `json:"revision"`
	Desired        int32              `json:"desired"`
	Ready          int32              `json:"ready"`
	Owner          *OwnerReferenceDTO `json:"owner,omitempty"`
	AgeSec         int64              `json:"ageSec"`
	HealthBucket   string             `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	NeedsAttention bool               `json:"needsAttention,omitempty"`
}

type ReplicaSetDetailsDTO struct {
	Summary    ReplicaSetSummaryDTO     `json:"summary"`
	Conditions []ReplicaSetConditionDTO `json:"conditions"`
	Pods       []ReplicaSetPodDTO       `json:"pods"`
	Spec       ReplicaSetSpecDTO        `json:"spec"`
	LinkedPods ReplicaSetPodsSummaryDTO `json:"linkedPods"`
	YAML       string                   `json:"yaml"`
}

type ReplicaSetSummaryDTO struct {
	Name      string             `json:"name"`
	Namespace string             `json:"namespace"`
	Owner     *OwnerReferenceDTO `json:"owner,omitempty"`
	Revision  int32              `json:"revision"`
	Selector  string             `json:"selector"`
	Desired   int32              `json:"desired"`
	Current   int32              `json:"current"`
	Ready     int32              `json:"ready"`
	AgeSec    int64              `json:"ageSec"`
}

type ReplicaSetConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type ReplicaSetPodDTO struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Node     string `json:"node,omitempty"`
	AgeSec   int64  `json:"ageSec"`
}

type ReplicaSetSpecDTO struct {
	PodTemplate PodTemplateSummaryDTO   `json:"podTemplate"`
	Scheduling  ReplicaSetSchedulingDTO `json:"scheduling"`
	Volumes     []VolumeDTO             `json:"volumes,omitempty"`
	Metadata    ReplicaSetMetadataDTO   `json:"metadata"`
}

type ReplicaSetSchedulingDTO struct {
	NodeSelector    map[string]string `json:"nodeSelector,omitempty"`
	AffinitySummary string            `json:"affinitySummary,omitempty"`
	Tolerations     []TolerationDTO   `json:"tolerations,omitempty"`
}

type ReplicaSetMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type ReplicaSetPodsSummaryDTO struct {
	Total int32 `json:"total"`
	Ready int32 `json:"ready"`
}
