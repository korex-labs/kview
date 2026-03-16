package dataplane

import "time"

// Profile represents a high-level data plane behavior profile.
// Only ProfileFocused is active today; other profiles are reserved for future
// stages and documented here to reflect the intended architecture.
type Profile string

const (
	// ProfileManual disables background observation; reads happen on demand only.
	ProfileManual Profile = "manual"
	// ProfileFocused prioritizes a small, operator-selected scope (current namespace,
	// pinned namespaces, first-wave resources). This is the current default.
	ProfileFocused Profile = "focused"
	// ProfileBalanced is intended to balance breadth of observation with resource use.
	ProfileBalanced Profile = "balanced"
	// ProfileWide is intended for broader observation across many namespaces/resources.
	ProfileWide Profile = "wide"
	// ProfileDiagnostic is intended for short-lived, more intensive observation
	// during troubleshooting. Not yet implemented.
	ProfileDiagnostic Profile = "diagnostic"
)

// DiscoveryMode represents how the data plane discovers clusters and scopes.
// Only DiscoveryModeTargeted is active today; other modes are reserved for
// future stages and documented here to reflect the intended architecture.
type DiscoveryMode string

const (
	// DiscoveryModePassive does not perform its own discovery; it reacts only to
	// explicit UI-driven scopes. Not yet implemented.
	DiscoveryModePassive DiscoveryMode = "passive"
	// DiscoveryModeTargeted focuses discovery on the current cluster/context and
	// first-wave resources. This is the current default.
	DiscoveryModeTargeted DiscoveryMode = "targeted"
	// DiscoveryModeAdaptive is intended to expand or contract observation based on
	// recent activity or signals. Not yet implemented.
	DiscoveryModeAdaptive DiscoveryMode = "adaptive"
)

// ObservationScope is a first-class structure describing what a plane should observe.
type ObservationScope struct {
	// ClusterName is the logical identifier of the cluster context.
	ClusterName string

	// Namespaces limits observation to a set of namespaces. Empty means "all namespaces".
	Namespaces []string

	// ResourceKinds limits observation to specific resource kinds (e.g. "pods", "deployments").
	// Empty means "all supported kinds".
	ResourceKinds []string
}

// CapabilityState captures whether a capability is available and in what way.
type CapabilityState string

const (
	CapabilityStateUnknown          CapabilityState = "unknown"
	CapabilityStateAllowed          CapabilityState = "allowed"
	CapabilityStateDenied           CapabilityState = "denied"
	CapabilityStatePartiallyAllowed CapabilityState = "partially_allowed"
	CapabilityStateDegraded         CapabilityState = "degraded"
	CapabilityStateNotApplicable    CapabilityState = "not_applicable"
	CapabilityStateUnsupported      CapabilityState = "unsupported"
)

// CapabilityConfidence describes how confident the system is in the capability assessment.
type CapabilityConfidence string

const (
	CapabilityConfidenceLow    CapabilityConfidence = "low"
	CapabilityConfidenceMedium CapabilityConfidence = "medium"
	CapabilityConfidenceHigh   CapabilityConfidence = "high"
)

// CapabilityScope describes the logical scope for a capability.
type CapabilityScope string

const (
	CapabilityScopeCluster   CapabilityScope = "cluster"
	CapabilityScopeNamespace CapabilityScope = "namespace"
	CapabilityScopeResource  CapabilityScope = "resource"
)

// NamespaceSensitivity describes whether a capability is safe across namespaces.
type NamespaceSensitivity string

const (
	NamespaceSensitivityUnknown  NamespaceSensitivity = "unknown"
	NamespaceSensitivityScoped   NamespaceSensitivity = "scoped"
	NamespaceSensitivityCrossNS  NamespaceSensitivity = "cross_namespace"
)

// CapabilityProvenance describes where a capability record was derived from.
type CapabilityProvenance string

const (
	// CapabilityProvenanceRBACScan indicates a direct RBAC-related response from
	// the cluster (success or explicit access denial).
	CapabilityProvenanceRBACScan CapabilityProvenance = "rbac_scan"
	// CapabilityProvenanceReadSuccess indicates a successful read that implicitly
	// proved the capability.
	CapabilityProvenanceReadSuccess CapabilityProvenance = "read_success"
	// CapabilityProvenanceAccessDenied indicates an explicit access denial from
	// the cluster.
	CapabilityProvenanceAccessDenied CapabilityProvenance = "access_denied"
	// CapabilityProvenanceTransientFailure indicates a transient or rate-limited
	// failure where capability state is inferred as degraded but not denied.
	CapabilityProvenanceTransientFailure CapabilityProvenance = "transient_failure"
	// CapabilityProvenanceHeuristic covers heuristic inference where the system
	// cannot be certain (e.g. proxy issues, connectivity, not-found heuristics).
	CapabilityProvenanceHeuristic CapabilityProvenance = "heuristic"
	// CapabilityProvenanceUserHint indicates capability information provided or
	// adjusted explicitly by the user (reserved for future work).
	CapabilityProvenanceUserHint CapabilityProvenance = "user_hint"
)

// CapabilityRecord describes a single normalized capability for a verb on a resource.
type CapabilityRecord struct {
	ResourceGroup string
	Resource      string
	Verb          string

	Scope      CapabilityScope
	Namespace  string
	State      CapabilityState
	Provenance CapabilityProvenance
	Confidence CapabilityConfidence

	// Timestamps describing when this capability was last evaluated and when it should be considered stale.
	ObservedAt time.Time
	ExpiresAt  time.Time
}

// NormalizedErrorClass identifies a coarse semantic error category.
type NormalizedErrorClass string

const (
	NormalizedErrorClassUnknown        NormalizedErrorClass = "unknown"
	NormalizedErrorClassAccessDenied   NormalizedErrorClass = "access_denied"
	NormalizedErrorClassUnauthorized   NormalizedErrorClass = "unauthorized"
	NormalizedErrorClassNotFound       NormalizedErrorClass = "not_found"
	NormalizedErrorClassConflict       NormalizedErrorClass = "conflict"
	NormalizedErrorClassRateLimited    NormalizedErrorClass = "rate_limited"
	NormalizedErrorClassTransient      NormalizedErrorClass = "transient_upstream"
	NormalizedErrorClassProxyFailure   NormalizedErrorClass = "proxy_failure"
	NormalizedErrorClassTimeout        NormalizedErrorClass = "timeout"
	NormalizedErrorClassCanceled       NormalizedErrorClass = "canceled"
	NormalizedErrorClassConnectivity   NormalizedErrorClass = "connectivity"
	NormalizedErrorClassInvalidRequest NormalizedErrorClass = "invalid_request"
)

// ErrorConsequenceHint provides hints to policies about likely impact.
type ErrorConsequenceHint string

const (
	ErrorConsequenceHintRetryable    ErrorConsequenceHint = "retryable"
	ErrorConsequenceHintUserAction   ErrorConsequenceHint = "user_action"
	ErrorConsequenceHintPermissions  ErrorConsequenceHint = "permissions"
	ErrorConsequenceHintEnvironment  ErrorConsequenceHint = "environment"
)

// NormalizedError wraps an upstream error with normalized classification.
type NormalizedError struct {
	// UpstreamMessage is a stable, operator-facing representation of the upstream error.
	UpstreamMessage string

	// Class is a semantic classification of the error.
	Class NormalizedErrorClass

	// Consequence provides guidance for policies and UI about likely impact or next steps.
	Consequence ErrorConsequenceHint
}

// FreshnessClass represents how fresh a snapshot or projection is.
type FreshnessClass string

const (
	FreshnessClassUnknown  FreshnessClass = "unknown"
	FreshnessClassHot      FreshnessClass = "hot"
	FreshnessClassWarm     FreshnessClass = "warm"
	FreshnessClassCold     FreshnessClass = "cold"
	FreshnessClassStale    FreshnessClass = "stale"
)

// CoverageClass represents how complete a snapshot or projection is expected to be.
type CoverageClass string

const (
	CoverageClassUnknown   CoverageClass = "unknown"
	CoverageClassFull      CoverageClass = "full"
	CoverageClassPartial   CoverageClass = "partial"
	CoverageClassSparse    CoverageClass = "sparse"
)

// DegradationClass represents any detected degradation in underlying observation.
type DegradationClass string

const (
	DegradationClassNone       DegradationClass = "none"
	DegradationClassMinor      DegradationClass = "minor"
	DegradationClassSevere     DegradationClass = "severe"
)

// CompletenessClass represents whether a projection is logically complete for its contract.
type CompletenessClass string

const (
	CompletenessClassUnknown CompletenessClass = "unknown"
	CompletenessClassComplete CompletenessClass = "complete"
	CompletenessClassInexact  CompletenessClass = "inexact"
)

// SnapshotMetadata describes common metadata for a data plane snapshot.
type SnapshotMetadata struct {
	ObservedAt time.Time

	Freshness   FreshnessClass
	Coverage    CoverageClass
	Degradation DegradationClass
	Completeness CompletenessClass
}

// ProjectionKind identifies a logical projection surface.
type ProjectionKind string

// ProjectionMetadata captures shared metadata for projection-backed views.
type ProjectionMetadata struct {
	Kind   ProjectionKind
	Source string

	Snapshot SnapshotMetadata
}

// PlaneHealth represents coarse health of a plane.
type PlaneHealth string

const (
	PlaneHealthUnknown  PlaneHealth = "unknown"
	PlaneHealthHealthy  PlaneHealth = "healthy"
	PlaneHealthDegraded PlaneHealth = "degraded"
	PlaneHealthFailed   PlaneHealth = "failed"
)

// ObserverState represents lifecycle state for any observer worker within a plane.
type ObserverState string

const (
	ObserverStateIdle            ObserverState = "idle"
	ObserverStateStarting        ObserverState = "starting"
	ObserverStateRunning         ObserverState = "running"
	ObserverStateStopping        ObserverState = "stopping"
	ObserverStateStopped         ObserverState = "stopped"
	ObserverStateFailed          ObserverState = "failed"
	ObserverStateActive          ObserverState = "active"
	ObserverStatePaused          ObserverState = "paused"
	ObserverStateDegraded        ObserverState = "degraded"
	ObserverStateBackoff         ObserverState = "backoff"
	ObserverStateBlockedByAccess ObserverState = "blocked_by_access"
	ObserverStateWaitingForScope ObserverState = "waiting_for_scope"
	ObserverStateUncertain       ObserverState = "uncertain"
)

