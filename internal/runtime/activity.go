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
	ActivityTypeTerminal            ActivityType = "terminal"
	ActivityTypePortForward         ActivityType = "portforward"
	ActivityTypeAnalyticsPoller     ActivityType = "analytics-poller"
	ActivityTypeRuntimeLog          ActivityType = "runtime-log"
	ActivityTypeConnectivity        ActivityType = "connectivity"
	ActivityTypeNamespaceListEnrich ActivityType = "namespace-list-enrich"
	ActivityTypeDataplaneSnapshot   ActivityType = "dataplane-snapshot"
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
	// StartedAt is the wall-clock start of the operation (defaults to CreatedAt in the UI if omitted).
	StartedAt time.Time `json:"startedAt,omitempty"`
	// ResourceType names the primary resource or domain (e.g. kubernetes pod list, terminal session).
	ResourceType string `json:"resourceType,omitempty"`
	// ExecutionMs is wall time from StartedAt (or CreatedAt) to now while running, or to UpdatedAt when stopped/failed.
	// Populated when listing activities via WithDerivedTiming.
	ExecutionMs int64             `json:"executionMs,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// RuntimeActivityID is the well-known ID for the runtime/system activity.
const RuntimeActivityID = "runtime"
