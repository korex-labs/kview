package dto

// PodMetricsDTO is a point-in-time pod resource usage sample from
// metrics.k8s.io. Values are canonical numeric units (milliCPU, bytes) so
// projections and detectors can compare against request/limit quantities
// parsed from pod specs without re-parsing formatted strings.
type PodMetricsDTO struct {
	// UID is optional source identity; metrics-server normally omits it.
	// Consumers must not join on name alone when UID is absent: use the
	// sample interval [CapturedAt-WindowSec, CapturedAt] and Pod CreatedAt.
	UID        string                `json:"uid,omitempty"`
	Name       string                `json:"name"`
	Namespace  string                `json:"namespace"`
	WindowSec  int64                 `json:"windowSec,omitempty"`
	CapturedAt int64                 `json:"capturedAt,omitempty"`
	Containers []ContainerMetricsDTO `json:"containers,omitempty"`
}

// ContainerMetricsDTO is per-container usage inside a PodMetricsDTO.
type ContainerMetricsDTO struct {
	Name        string `json:"name"`
	CPUMilli    int64  `json:"cpuMilli"`
	MemoryBytes int64  `json:"memoryBytes"`
}

// NodeMetricsDTO is a point-in-time node resource usage sample from
// metrics.k8s.io. CPU is canonical milliCPU, memory is canonical bytes.
type NodeMetricsDTO struct {
	Name        string `json:"name"`
	WindowSec   int64  `json:"windowSec,omitempty"`
	CapturedAt  int64  `json:"capturedAt,omitempty"`
	CPUMilli    int64  `json:"cpuMilli"`
	MemoryBytes int64  `json:"memoryBytes"`
}
