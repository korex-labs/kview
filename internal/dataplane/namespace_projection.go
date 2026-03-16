package dataplane

import (
	"context"
	"time"

	"kview/internal/kube"
	"kview/internal/kube/dto"
)

// NamespaceSummaryProjection is a projection-backed view of namespace resources plus metadata.
type NamespaceSummaryProjection struct {
	Resources dto.NamespaceSummaryResourcesDTO
	Meta      SnapshotMetadata
	Err       *NormalizedError
}

// NamespaceSummaryProjection builds a namespace summary projection for the given cluster/namespace.
// For Stage 5C, this reuses the existing summary logic but wraps it in explicit projection metadata.
func (m *manager) NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error) {
	var out NamespaceSummaryProjection

	if m.clients == nil {
		out.Meta = SnapshotMetadata{
			ObservedAt:  time.Now().UTC(),
			Freshness:   FreshnessClassUnknown,
			Coverage:    CoverageClassUnknown,
			Degradation: DegradationClassSevere,
			Completeness: CompletenessClassUnknown,
		}
		return out, nil
	}

	clients, _, err := m.clients.GetClientsForContext(ctx, clusterName)
	if err != nil {
		n := NormalizeError(err)
		out.Err = &n
		out.Meta = SnapshotMetadata{
			ObservedAt:  time.Now().UTC(),
			Freshness:   FreshnessClassUnknown,
			Coverage:    CoverageClassUnknown,
			Degradation: DegradationClassSevere,
			Completeness: CompletenessClassUnknown,
		}
		return out, err
	}

	res, err := kube.GetNamespaceSummary(ctx, clients, namespace)
	if err != nil {
		n := NormalizeError(err)
		out.Err = &n

		meta := SnapshotMetadata{
			ObservedAt:  time.Now().UTC(),
			Freshness:   FreshnessClassCold,
			Coverage:    CoverageClassPartial,
			Degradation: DegradationClassMinor,
			Completeness: CompletenessClassInexact,
		}
		out.Meta = meta

		state := "degraded"
		switch n.Class {
		case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
			state = "denied"
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			state = "degraded"
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			state = "partial_proxy"
		default:
			state = "degraded"
		}
		res.Meta = &dto.NamespaceSummaryMetaDTO{
			Freshness:   string(meta.Freshness),
			Coverage:    string(meta.Coverage),
			Degradation: string(meta.Degradation),
			Completeness: string(meta.Completeness),
			State:       state,
		}

		out.Resources = *res
		return out, err
	}

	// Successful projection; treat as hot but still only partially authoritative for all resources.
	meta := SnapshotMetadata{
		ObservedAt:  time.Now().UTC(),
		Freshness:   FreshnessClassHot,
		Coverage:    CoverageClassPartial,
		Degradation: DegradationClassNone,
		Completeness: CompletenessClassInexact,
	}
	out.Meta = meta

	state := "complete"
	if res.Counts.Pods == 0 && res.Counts.Deployments == 0 {
		state = "empty"
	}

	res.Meta = &dto.NamespaceSummaryMetaDTO{
		Freshness:   string(meta.Freshness),
		Coverage:    string(meta.Coverage),
		Degradation: string(meta.Degradation),
		Completeness: string(meta.Completeness),
		State:       state,
	}

	out.Resources = *res
	return out, nil
}

