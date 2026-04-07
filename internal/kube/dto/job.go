package dto

type JobDTO struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Active         int32  `json:"active"`
	Succeeded      int32  `json:"succeeded"`
	Failed         int32  `json:"failed"`
	DurationSec    int64  `json:"durationSec,omitempty"`
	AgeSec         int64  `json:"ageSec"`
	Status         string `json:"status"`
	HealthBucket   string `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	NeedsAttention bool   `json:"needsAttention,omitempty"`
}

type JobDetailsDTO struct {
	Summary    JobSummaryDTO     `json:"summary"`
	Conditions []JobConditionDTO `json:"conditions"`
	Pods       []JobPodDTO       `json:"pods"`
	LinkedPods JobPodsSummaryDTO `json:"linkedPods"`
	Metadata   JobMetadataDTO    `json:"metadata"`
	Selector   string            `json:"selector,omitempty"`
	YAML       string            `json:"yaml"`
}

type JobSummaryDTO struct {
	Name           string             `json:"name"`
	Namespace      string             `json:"namespace"`
	Owner          *OwnerReferenceDTO `json:"owner,omitempty"`
	Status         string             `json:"status"`
	Active         int32              `json:"active"`
	Succeeded      int32              `json:"succeeded"`
	Failed         int32              `json:"failed"`
	Completions    *int32             `json:"completions,omitempty"`
	Parallelism    *int32             `json:"parallelism,omitempty"`
	BackoffLimit   *int32             `json:"backoffLimit,omitempty"`
	StartTime      int64              `json:"startTime,omitempty"`
	CompletionTime int64              `json:"completionTime,omitempty"`
	DurationSec    int64              `json:"durationSec,omitempty"`
	AgeSec         int64              `json:"ageSec"`
}

type JobConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type JobPodDTO struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Node     string `json:"node,omitempty"`
	AgeSec   int64  `json:"ageSec"`
}

type JobPodsSummaryDTO struct {
	Total int32 `json:"total"`
	Ready int32 `json:"ready"`
}

type JobMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
