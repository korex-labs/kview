package runtime

import "time"

type ActivityKind string
type ActivityType string
type ActivityStatus string

const (
	ActivityKindSession ActivityKind = "session"
	ActivityKindWorker  ActivityKind = "worker"
	ActivityKindStream  ActivityKind = "stream"
)

const (
	ActivityTypeTerminal       ActivityType = "terminal"
	ActivityTypePortForward    ActivityType = "portforward"
	ActivityTypeAnalyticsPoller ActivityType = "analytics-poller"
	ActivityTypeRuntimeLog     ActivityType = "runtime-log"
)

const (
	ActivityStatusPending  ActivityStatus = "pending"
	ActivityStatusStarting ActivityStatus = "starting"
	ActivityStatusRunning  ActivityStatus = "running"
	ActivityStatusStopping ActivityStatus = "stopping"
	ActivityStatusStopped  ActivityStatus = "stopped"
	ActivityStatusFailed   ActivityStatus = "failed"
)

type Activity struct {
	ID        string         `json:"id"`
	Kind      ActivityKind   `json:"kind"`
	Type      ActivityType   `json:"type"`
	Title     string         `json:"title"`
	Status    ActivityStatus `json:"status"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

