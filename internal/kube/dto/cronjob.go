package dto

type CronJobDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Schedule           string `json:"schedule"`
	ScheduleHint       string `json:"scheduleHint,omitempty"`
	Suspend            bool   `json:"suspend"`
	Active             int32  `json:"active"`
	LastScheduleTime   int64  `json:"lastScheduleTime,omitempty"`
	LastSuccessfulTime int64  `json:"lastSuccessfulTime,omitempty"`
	AgeSec             int64  `json:"ageSec"`
	HealthBucket       string `json:"healthBucket,omitempty"` // healthy | progressing | degraded | unknown
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type CronJobDetailsDTO struct {
	Summary       CronJobSummaryDTO  `json:"summary"`
	Policy        CronJobPolicyDTO   `json:"policy"`
	AllJobs       []CronJobJobDTO    `json:"allJobs,omitempty"`
	JobsForbidden bool               `json:"jobsForbidden,omitempty"`
	Spec          CronJobSpecDTO     `json:"spec"`
	Metadata      CronJobMetadataDTO `json:"metadata"`
	YAML          string             `json:"yaml"`
}

type CronJobSummaryDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Schedule           string `json:"schedule"`
	ScheduleHint       string `json:"scheduleHint,omitempty"`
	TimeZone           string `json:"timeZone,omitempty"`
	ConcurrencyPolicy  string `json:"concurrencyPolicy,omitempty"`
	Suspend            bool   `json:"suspend"`
	Active             int32  `json:"active"`
	LastScheduleTime   int64  `json:"lastScheduleTime,omitempty"`
	LastSuccessfulTime int64  `json:"lastSuccessfulTime,omitempty"`
	LastRunStatus      string `json:"lastRunStatus,omitempty"`
	AgeSec             int64  `json:"ageSec"`
}

type CronJobPolicyDTO struct {
	StartingDeadlineSeconds    *int64 `json:"startingDeadlineSeconds,omitempty"`
	SuccessfulJobsHistoryLimit *int32 `json:"successfulJobsHistoryLimit,omitempty"`
	FailedJobsHistoryLimit     *int32 `json:"failedJobsHistoryLimit,omitempty"`
}

type CronJobJobDTO struct {
	Name           string `json:"name"`
	Status         string `json:"status"`
	StartTime      int64  `json:"startTime,omitempty"`
	CompletionTime int64  `json:"completionTime,omitempty"`
	DurationSec    int64  `json:"durationSec,omitempty"`
	AgeSec         int64  `json:"ageSec,omitempty"`
}

type CronJobSpecDTO struct {
	JobTemplate       PodTemplateSummaryDTO      `json:"jobTemplate"`
	Scheduling        CronJobSchedulingDTO       `json:"scheduling"`
	Volumes           []VolumeDTO                `json:"volumes,omitempty"`
	MissingReferences []MissingReferenceDTO      `json:"missingReferences,omitempty"`
	Metadata          CronJobTemplateMetadataDTO `json:"metadata"`
}

type CronJobSchedulingDTO struct {
	NodeSelector              map[string]string             `json:"nodeSelector,omitempty"`
	AffinitySummary           string                        `json:"affinitySummary,omitempty"`
	Tolerations               []TolerationDTO               `json:"tolerations,omitempty"`
	TopologySpreadConstraints []TopologySpreadConstraintDTO `json:"topologySpreadConstraints,omitempty"`
}

type CronJobMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type CronJobTemplateMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
