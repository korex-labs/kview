package dataplane

import (
	"sync"
	"time"
)

// CapabilityKey uniquely identifies a capability fact.
type CapabilityKey struct {
	Cluster       string
	ResourceGroup string
	Resource      string
	Verb          string
	Scope         CapabilityScope
	Namespace     string
}

// CapabilityRegistry stores learned capability records per cluster.
type CapabilityRegistry struct {
	mu    sync.RWMutex
	store map[CapabilityKey]CapabilityRecord
}

func NewCapabilityRegistry() *CapabilityRegistry {
	return &CapabilityRegistry{
		store: make(map[CapabilityKey]CapabilityRecord),
	}
}

// LearnReadResult updates capabilities based on the outcome of a read.
// It records provenance and confidence according to normalized error class.
func (r *CapabilityRegistry) LearnReadResult(cluster, group, resource, namespace, verb string, scope CapabilityScope, err error) {
	now := time.Now().UTC()
	key := CapabilityKey{
		Cluster:       cluster,
		ResourceGroup: group,
		Resource:      resource,
		Verb:          verb,
		Scope:         scope,
		Namespace:     namespace,
	}

	rec := CapabilityRecord{
		ResourceGroup: group,
		Resource:      resource,
		Verb:          verb,
		Scope:         scope,
		Namespace:     namespace,
		ObservedAt:    now,
		ExpiresAt:     now.Add(10 * time.Minute),
	}

	if err == nil {
		rec.State = CapabilityStateAllowed
		rec.Provenance = CapabilityProvenanceRBACScan
		rec.Confidence = CapabilityConfidenceHigh
	} else {
		norm := NormalizeError(err)
		switch norm.Class {
		case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
			rec.State = CapabilityStateDenied
			rec.Provenance = CapabilityProvenanceRBACScan
			rec.Confidence = CapabilityConfidenceHigh
		case NormalizedErrorClassNotFound:
			// Resource itself might not exist in this cluster; treat as not-applicable.
			rec.State = CapabilityStateNotApplicable
			rec.Provenance = CapabilityProvenanceHeuristic
			rec.Confidence = CapabilityConfidenceMedium
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			rec.State = CapabilityStateDegraded
			rec.Provenance = CapabilityProvenanceHeuristic
			rec.Confidence = CapabilityConfidenceLow
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			// Environment/proxy issues: do not infer hard denial.
			rec.State = CapabilityStateUnknown
			rec.Provenance = CapabilityProvenanceHeuristic
			rec.Confidence = CapabilityConfidenceLow
		default:
			rec.State = CapabilityStateUnknown
			rec.Provenance = CapabilityProvenanceHeuristic
			rec.Confidence = CapabilityConfidenceLow
		}
	}

	r.mu.Lock()
	r.store[key] = rec
	r.mu.Unlock()
}

func (r *CapabilityRegistry) Get(key CapabilityKey) (CapabilityRecord, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.store[key]
	return rec, ok
}

