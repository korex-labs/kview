package dataplane

import (
	"context"
	"strconv"
	"strings"
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
// It starts from the legacy kube summary (to preserve non-first-wave sections such as networking,
// storage, Helm, etc.) and then overlays dataplane-owned snapshots for first-wave resources
// (pods and deployments). In other words:
//   - Pods and deployments are dataplane-backed in this projection.
//   - Other sections remain legacy direct-read today.
func (m *manager) NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error) {
	var out NamespaceSummaryProjection

	// Start from the legacy kube summary so we preserve all existing fields (networking, storage, Helm, etc.).
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

	base, err := kube.GetNamespaceSummary(ctx, clients, namespace)
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
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			state = "partial_proxy"
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			state = "degraded"
		default:
			state = "degraded"
		}
		base.Meta = &dto.NamespaceSummaryMetaDTO{
			Freshness:   string(meta.Freshness),
			Coverage:    string(meta.Coverage),
			Degradation: string(meta.Degradation),
			Completeness: string(meta.Completeness),
			State:       state,
		}

		out.Resources = *base
		return out, err
	}

	// Overlay dataplane-owned first-wave snapshots for pods and deployments.
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	podsSnap, podsErr := plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace)
	depsSnap, depsErr := plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace)

	// Start from the legacy summary DTO to preserve networking/storage/Helm/etc.
	res := *base

	// If snapshots succeeded, override counts for pods/deployments.
	if podsErr == nil {
		res.Counts.Pods = len(podsSnap.Items)
	}
	if depsErr == nil {
		res.Counts.Deployments = len(depsSnap.Items)
	}

	// Pod health and problematic pods.
	// Reset pod/deployment health if we have snapshots; otherwise keep legacy values.
	if podsErr == nil {
		res.PodHealth = dto.NamespacePodHealth{}
		for _, p := range podsSnap.Items {
			switch p.Phase {
			case "Running":
				res.PodHealth.Running++
			case "Pending":
				res.PodHealth.Pending++
			case "Failed":
				res.PodHealth.Failed++
			case "Succeeded":
				res.PodHealth.Succeeded++
			default:
				res.PodHealth.Unknown++
			}
		}
	}

	if depsErr == nil {
		res.DeployHealth = dto.NamespaceDeploymentHealth{}
		for _, d := range depsSnap.Items {
			switch d.Status {
			case "Available":
				res.DeployHealth.Healthy++
			case "Progressing":
				res.DeployHealth.Progressing++
			default:
				if d.Ready != "" && d.Ready != "0/0" {
					res.DeployHealth.Degraded++
				}
			}
		}
	}

	// Problematic resources: keep legacy non-pod/deployment entries, rebuild pod/deployment from snapshots.
	baseProblems := base.Problematic
	kept := make([]dto.ProblematicResource, 0, len(baseProblems))
	for _, pr := range baseProblems {
		if pr.Kind != "Pod" && pr.Kind != "Deployment" {
			kept = append(kept, pr)
		}
	}
	newProblems := kept

	if podsErr == nil {
		for _, p := range podsSnap.Items {
			isProblematic := false
			reason := p.Phase
			if p.Phase == "Failed" || p.Phase == "Pending" {
				isProblematic = true
			} else if p.Ready != "" {
				if parts := strings.Split(p.Ready, "/"); len(parts) == 2 {
					if ready, err1 := strconv.Atoi(parts[0]); err1 == nil {
						if total, err2 := strconv.Atoi(parts[1]); err2 == nil && total > 0 && ready < total {
							isProblematic = true
							reason = "NotReady"
						}
					}
				}
			}
			if isProblematic {
				if p.LastEvent != nil && p.LastEvent.Reason != "" {
					reason = p.LastEvent.Reason
				}
				newProblems = append(newProblems, dto.ProblematicResource{
					Kind:   "Pod",
					Name:   p.Name,
					Reason: reason,
				})
			}
		}
	}

	if depsErr == nil {
		for _, d := range depsSnap.Items {
			isProblematic := false
			reason := d.Status
			if d.Status != "Available" && d.UpToDate > 0 && d.Available < d.UpToDate {
				isProblematic = true
				if d.LastEvent != nil && d.LastEvent.Reason != "" {
					reason = d.LastEvent.Reason
				}
			}
			if isProblematic {
				newProblems = append(newProblems, dto.ProblematicResource{
					Kind:   "Deployment",
					Name:   d.Name,
					Reason: reason,
				})
			}
		}
	}
	res.Problematic = newProblems

	// Combine metadata (first-wave only => partial/inexact).
	meta := SnapshotMetadata{
		ObservedAt:  mostRecent(podsSnap.Meta.ObservedAt, depsSnap.Meta.ObservedAt),
		Freshness:   minFreshness(podsSnap.Meta.Freshness, depsSnap.Meta.Freshness),
		Coverage:    CoverageClassPartial,
		Degradation: maxDegradation(podsSnap.Meta.Degradation, depsSnap.Meta.Degradation),
		Completeness: CompletenessClassInexact,
	}
	out.Meta = meta

	// Determine state.
	state := "ok"
	if podsErr != nil || depsErr != nil {
		if n := firstNonNilNormalized(podsSnap.Err, depsSnap.Err); n != nil {
			switch n.Class {
			case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
				state = "denied"
			case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
				state = "partial_proxy"
			case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
				state = "degraded"
			default:
				state = "degraded"
			}
		}
	} else if res.Counts.Pods == 0 && res.Counts.Deployments == 0 {
		state = "empty"
	}

	res.Meta = &dto.NamespaceSummaryMetaDTO{
		Freshness:   string(meta.Freshness),
		Coverage:    string(meta.Coverage),
		Degradation: string(meta.Degradation),
		Completeness: string(meta.Completeness),
		State:       state,
	}

	out.Resources = res
	out.Err = firstNonNilNormalized(podsSnap.Err, depsSnap.Err)
	return out, firstError(podsErr, depsErr)
}

func mostRecent(a, b time.Time) time.Time {
	if a.IsZero() {
		return b
	}
	if b.IsZero() {
		return a
	}
	if a.After(b) {
		return a
	}
	return b
}

func minFreshness(a, b FreshnessClass) FreshnessClass {
	// Simple ordering: hot < warm < cold < stale < unknown (worst).
	order := map[FreshnessClass]int{
		FreshnessClassHot:      0,
		FreshnessClassWarm:     1,
		FreshnessClassCold:     2,
		FreshnessClassStale:    3,
		FreshnessClassUnknown:  4,
	}
	if order[a] >= order[b] {
		return a
	}
	return b
}

func maxDegradation(a, b DegradationClass) DegradationClass {
	order := map[DegradationClass]int{
		DegradationClassNone:   0,
		DegradationClassMinor:  1,
		DegradationClassSevere: 2,
	}
	if order[a] >= order[b] {
		return a
	}
	return b
}

func firstNonNilNormalized(a, b *NormalizedError) *NormalizedError {
	if a != nil {
		return a
	}
	return b
}

func firstError(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

