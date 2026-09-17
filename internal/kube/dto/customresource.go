package dto

import "encoding/json"

type CustomResourceProvenance string

const (
	CustomResourceProvenanceKubernetes   CustomResourceProvenance = "kubernetes"
	CustomResourceProvenanceHelmManifest CustomResourceProvenance = "helmManifest"
)

// CustomResourceInstanceDTO represents an observed instance or a manifest-only
// reference in the aggregated cross-kind list.
type CustomResourceInstanceDTO struct {
	ResourceRelationshipCarrier `json:"-"`
	Name                        string                   `json:"name"`
	Namespace                   string                   `json:"namespace,omitempty"`
	Kind                        string                   `json:"kind"`
	Group                       string                   `json:"group"`
	Version                     string                   `json:"version"`
	Resource                    string                   `json:"resource"` // plural name, e.g. "certificates"
	AgeSec                      int64                    `json:"ageSec"`
	SignalSeverity              string                   `json:"signalSeverity,omitempty"` // ok | warning | error | unknown
	StatusSummary               string                   `json:"statusSummary,omitempty"`
	Provenance                  CustomResourceProvenance `json:"provenance,omitempty"`
}

// CustomResourceDiscoveryMeta describes an incomplete, GET-confirmed type index.
// Counts describe metadata probes, independently of instance-list counters.
type CustomResourceDiscoveryMeta struct {
	Source          string `json:"source"`
	ListDenied      bool   `json:"listDenied"`
	UniverseUnknown bool   `json:"universeUnknown"`
	CandidateLimit  int    `json:"candidateLimit"`
	Candidates      int    `json:"candidates"`
	Confirmed       int    `json:"confirmed"`
	Denied          int    `json:"denied"`
	NotFound        int    `json:"notFound"`
	Errors          int    `json:"errors"`
	Truncated       bool   `json:"truncated"`
}

type CustomResourceAggregationMeta struct {
	Discovery       *CustomResourceDiscoveryMeta `json:"discovery,omitempty"`
	TotalKinds      int                          `json:"totalKinds"`
	AccessibleKinds int                          `json:"accessibleKinds"`
	DeniedKinds     int                          `json:"deniedKinds"`
	ErrorKinds      int                          `json:"errorKinds"`
}

// CustomResourceDetailsDTO is the full representation for a single CR instance drawer.
type CustomResourceDetailsDTO struct {
	Summary    CustomResourceSummaryDTO     `json:"summary"`
	Conditions []CustomResourceConditionDTO `json:"conditions,omitempty"`
	// Nil omits an absent field; non-nil JSON "null" preserves explicit null.
	Spec   json.RawMessage `json:"spec,omitempty"`
	Status json.RawMessage `json:"status,omitempty"`
	YAML   string          `json:"yaml"`
}

type CustomResourceConditionDTO struct {
	CRDConditionDTO
	ObservedGeneration *int64 `json:"observedGeneration,omitempty"`
}

type CustomResourceSummaryDTO struct {
	UID                      string            `json:"uid"`
	ResourceVersion          string            `json:"resourceVersion"`
	Generation               *int64            `json:"generation,omitempty"`
	StatusObservedGeneration *int64            `json:"statusObservedGeneration,omitempty"`
	Name                     string            `json:"name"`
	Namespace                string            `json:"namespace,omitempty"`
	Group                    string            `json:"group"`
	Version                  string            `json:"version"`
	Kind                     string            `json:"kind"`
	AgeSec                   int64             `json:"ageSec"`
	CreatedAt                int64             `json:"createdAt"`
	SignalSeverity           string            `json:"signalSeverity,omitempty"`
	StatusSummary            string            `json:"statusSummary,omitempty"`
	Labels                   map[string]string `json:"labels,omitempty"`
	Annotations              map[string]string `json:"annotations,omitempty"`
}
