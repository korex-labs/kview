package dto

// CustomResourceInstanceDTO represents a single deployed custom resource instance
// in the aggregated cross-kind list.
type CustomResourceInstanceDTO struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace,omitempty"`
	Kind           string `json:"kind"`
	Group          string `json:"group"`
	Version        string `json:"version"`
	Resource       string `json:"resource"` // plural name, e.g. "certificates"
	AgeSec         int64  `json:"ageSec"`
	SignalSeverity string `json:"signalSeverity,omitempty"` // ok | warning | error | unknown
	StatusSummary  string `json:"statusSummary,omitempty"`
}

// CustomResourceAggregationMeta summarises how the server-side fan-out went.
type CustomResourceAggregationMeta struct {
	TotalKinds      int `json:"totalKinds"`
	AccessibleKinds int `json:"accessibleKinds"`
	DeniedKinds     int `json:"deniedKinds"`
	ErrorKinds      int `json:"errorKinds"`
}

// CustomResourceDetailsDTO is the full representation for a single CR instance drawer.
type CustomResourceDetailsDTO struct {
	Summary    CustomResourceSummaryDTO `json:"summary"`
	Conditions []CRDConditionDTO        `json:"conditions,omitempty"`
	YAML       string                   `json:"yaml"`
}

type CustomResourceSummaryDTO struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Group       string            `json:"group"`
	Version     string            `json:"version"`
	Kind        string            `json:"kind"`
	AgeSec      int64             `json:"ageSec"`
	CreatedAt   int64             `json:"createdAt"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
