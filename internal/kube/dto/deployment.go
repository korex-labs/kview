package dto

type DeploymentListItemDTO struct {
	Name                string         `json:"name"`
	Namespace           string         `json:"namespace"`
	Ready               string         `json:"ready"`
	UpToDate            int32          `json:"upToDate"`
	Available           int32          `json:"available"`
	Strategy            string         `json:"strategy"`
	AgeSec              int64          `json:"ageSec"`
	LastRolloutComplete int64          `json:"lastRolloutComplete,omitempty"`
	LastEvent           *EventBriefDTO `json:"lastEvent,omitempty"`
	Status              string         `json:"status"`
	// List enrichment (Stage 5C): derived from snapshot row only.
	HealthBucket          string `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	RolloutNeedsAttention bool   `json:"rolloutNeedsAttention,omitempty"`
	ListStatus            string `json:"listStatus,omitempty"`
	ListSignalSeverity    string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount       int    `json:"listSignalCount,omitempty"`
}

type DeploymentDetailsDTO struct {
	Summary     DeploymentSummaryDTO      `json:"summary"`
	Conditions  []DeploymentConditionDTO  `json:"conditions"`
	Rollout     DeploymentRolloutDTO      `json:"rollout"`
	ReplicaSets []DeploymentReplicaSetDTO `json:"replicaSets"`
	Pods        []DeploymentPodDTO        `json:"pods"`
	Spec        DeploymentSpecDTO         `json:"spec"`
	YAML        string                    `json:"yaml"`
}

type DeploymentSummaryDTO struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Strategy  string `json:"strategy"`
	Selector  string `json:"selector"`
	Desired   int32  `json:"desired"`
	Current   int32  `json:"current"`
	Ready     int32  `json:"ready"`
	Available int32  `json:"available"`
	UpToDate  int32  `json:"upToDate"`
	AgeSec    int64  `json:"ageSec"`
}

type DeploymentConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type DeploymentRolloutDTO struct {
	CurrentRevision          string   `json:"currentRevision,omitempty"`
	ObservedGeneration       int64    `json:"observedGeneration"`
	Generation               int64    `json:"generation"`
	ProgressDeadlineExceeded bool     `json:"progressDeadlineExceeded"`
	LastRolloutStart         int64    `json:"lastRolloutStart,omitempty"`
	LastRolloutComplete      int64    `json:"lastRolloutComplete,omitempty"`
	InProgress               bool     `json:"inProgress"`
	Warnings                 []string `json:"warnings,omitempty"`
	MissingReplicas          int32    `json:"missingReplicas"`
	UnavailableReplicas      int32    `json:"unavailableReplicas"`
}

type DeploymentReplicaSetDTO struct {
	Name          string `json:"name"`
	Revision      int32  `json:"revision"`
	Desired       int32  `json:"desired"`
	Current       int32  `json:"current"`
	Ready         int32  `json:"ready"`
	AgeSec        int64  `json:"ageSec"`
	Status        string `json:"status"`
	IsActive      bool   `json:"isActive"`
	UnhealthyPods bool   `json:"unhealthyPods"`
}

type DeploymentPodDTO struct {
	Name     string `json:"name"`
	Phase    string `json:"phase"`
	Ready    string `json:"ready"`
	Restarts int32  `json:"restarts"`
	Node     string `json:"node,omitempty"`
	AgeSec   int64  `json:"ageSec"`
}

type DeploymentSpecDTO struct {
	PodTemplate       PodTemplateSummaryDTO   `json:"podTemplate"`
	Scheduling        DeploymentSchedulingDTO `json:"scheduling"`
	Volumes           []VolumeDTO             `json:"volumes,omitempty"`
	MissingReferences []MissingReferenceDTO   `json:"missingReferences,omitempty"`
	Metadata          DeploymentMetadataDTO   `json:"metadata"`
}

type DeploymentMissingReferenceDTO = MissingReferenceDTO

type PodTemplateSummaryDTO struct {
	Containers       []ContainerSummaryDTO `json:"containers,omitempty"`
	InitContainers   []ContainerSummaryDTO `json:"initContainers,omitempty"`
	ImagePullSecrets []string              `json:"imagePullSecrets,omitempty"`
}

type ContainerSummaryDTO struct {
	Name          string `json:"name"`
	Image         string `json:"image,omitempty"`
	CPURequest    string `json:"cpuRequest,omitempty"`
	CPULimit      string `json:"cpuLimit,omitempty"`
	MemoryRequest string `json:"memoryRequest,omitempty"`
	MemoryLimit   string `json:"memoryLimit,omitempty"`
}

type DeploymentSchedulingDTO struct {
	NodeSelector              map[string]string             `json:"nodeSelector,omitempty"`
	AffinitySummary           string                        `json:"affinitySummary,omitempty"`
	Tolerations               []TolerationDTO               `json:"tolerations,omitempty"`
	TopologySpreadConstraints []TopologySpreadConstraintDTO `json:"topologySpreadConstraints,omitempty"`
}

type DeploymentMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
