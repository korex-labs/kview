package dataplane

import (
	"context"
	"strconv"
	"strings"
	"time"

	"kview/internal/kube/dto"
)

const (
	namespaceSummaryMaxProblematic = 10
	namespaceSummaryHotspotLimit   = 15
)

// NamespaceSummaryProjection is a projection-backed view of namespace resources plus metadata.
type NamespaceSummaryProjection struct {
	Resources dto.NamespaceSummaryResourcesDTO
	Meta      SnapshotMetadata
	Err       *NormalizedError
}

// NamespaceSummaryProjection builds a namespace summary from dataplane snapshots (projection-led).
// Helm releases are not snapshot-owned yet: counts stay zero and releases list empty unless a later
// stage adds a dataplane/Helm snapshot. Coverage/completeness metadata stays partial/inexact.
func (m *manager) NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error) {
	var out NamespaceSummaryProjection

	if m.clients == nil {
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassUnknown,
			Coverage:     CoverageClassUnknown,
			Degradation:  DegradationClassSevere,
			Completeness: CompletenessClassUnknown,
		}
		return out, nil
	}

	if _, _, err := m.clients.GetClientsForContext(ctx, clusterName); err != nil {
		n := NormalizeError(err)
		out.Err = &n
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassUnknown,
			Coverage:     CoverageClassUnknown,
			Degradation:  DegradationClassSevere,
			Completeness: CompletenessClassUnknown,
		}
		return out, err
	}

	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	podsSnap, podsErr := plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace)
	depsSnap, depsErr := plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace)
	svcsSnap, svcsErr := plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace)
	ingSnap, ingErr := plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace)
	pvcsSnap, pvcsErr := plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace)
	cmsSnap, cmsErr := plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace)
	secsSnap, secsErr := plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace)
	dsSnap, dsErr := plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace)
	stsSnap, stsErr := plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace)
	rsSnap, rsErr := plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace)
	jobsSnap, jobsErr := plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace)
	cjSnap, cjErr := plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace)

	res := dto.NamespaceSummaryResourcesDTO{
		Problematic: []dto.ProblematicResource{},
	}

	if podsErr == nil {
		res.Counts.Pods = len(podsSnap.Items)
	}
	if depsErr == nil {
		res.Counts.Deployments = len(depsSnap.Items)
	}
	if svcsErr == nil {
		res.Counts.Services = len(svcsSnap.Items)
	}
	if ingErr == nil {
		res.Counts.Ingresses = len(ingSnap.Items)
	}
	if pvcsErr == nil {
		res.Counts.PVCs = len(pvcsSnap.Items)
	}
	if cmsErr == nil {
		res.Counts.ConfigMaps = len(cmsSnap.Items)
	}
	if secsErr == nil {
		res.Counts.Secrets = len(secsSnap.Items)
	}
	if dsErr == nil {
		res.Counts.DaemonSets = len(dsSnap.Items)
	}
	if stsErr == nil {
		res.Counts.StatefulSets = len(stsSnap.Items)
	}
	if jobsErr == nil {
		res.Counts.Jobs = len(jobsSnap.Items)
	}
	if cjErr == nil {
		res.Counts.CronJobs = len(cjSnap.Items)
	}
	// Helm: not snapshot-backed in dataplane yet
	res.Counts.HelmReleases = 0
	res.HelmReleases = nil

	if podsErr == nil {
		res.PodHealth = podPhaseRollup(podsSnap.Items)
	}
	if depsErr == nil {
		res.DeployHealth = deploymentHealthRollup(depsSnap.Items)
	}

	wh := ProjectWorkloadHealthFromNamespaceSnapshots(
		depsSnap, depsErr,
		dsSnap, dsErr,
		stsSnap, stsErr,
		rsSnap, rsErr,
		jobsSnap, jobsErr,
		cjSnap, cjErr,
	)
	res.WorkloadByKind = &wh.Rollup

	if podsErr == nil {
		hot := ProjectRestartHotspotsFromPods(namespace, podsSnap, namespaceSummaryHotspotLimit)
		res.RestartHotspots = hot.Items
	}

	workloadProblems := WorkloadProblematicCandidates(
		depsSnap.Items,
		dsSnap.Items,
		stsSnap.Items,
		jobsSnap.Items,
		cjSnap.Items,
		namespaceSummaryMaxProblematic,
	)
	var podProblems []dto.ProblematicResource
	if podsErr == nil {
		podProblems = podProblematicFromList(podsSnap.Items, namespaceSummaryMaxProblematic)
	}
	res.Problematic = mergeProblematicUnique(namespaceSummaryMaxProblematic, workloadProblems, podProblems)

	meta := composeNamespaceSummaryProjectionMeta(
		podsSnap.Meta,
		depsSnap.Meta,
		svcsSnap.Meta,
		ingSnap.Meta,
		pvcsSnap.Meta,
		cmsSnap.Meta,
		secsSnap.Meta,
		dsSnap.Meta,
		stsSnap.Meta,
		rsSnap.Meta,
		jobsSnap.Meta,
		cjSnap.Meta,
	)
	out.Meta = meta

	firstNorm := FirstNonNilNormalizedError(
		podsSnap.Err, depsSnap.Err, svcsSnap.Err, ingSnap.Err, pvcsSnap.Err, cmsSnap.Err, secsSnap.Err,
		dsSnap.Err, stsSnap.Err, rsSnap.Err, jobsSnap.Err, cjSnap.Err,
	)

	meaningful := res.Counts.Pods + res.Counts.Deployments + res.Counts.Services +
		res.Counts.Ingresses + res.Counts.PVCs + res.Counts.ConfigMaps + res.Counts.Secrets +
		res.Counts.DaemonSets + res.Counts.StatefulSets + res.Counts.Jobs + res.Counts.CronJobs
	state := ProjectionCoarseState(firstNorm, meaningful)

	res.Meta = &dto.NamespaceSummaryMetaDTO{
		Freshness:    string(meta.Freshness),
		Coverage:     string(meta.Coverage),
		Degradation:  string(meta.Degradation),
		Completeness: string(meta.Completeness),
		State:        state,
	}

	out.Resources = res
	out.Err = firstNorm
	return out, FirstError(
		podsErr, depsErr, svcsErr, ingErr, pvcsErr, cmsErr, secsErr,
		dsErr, stsErr, rsErr, jobsErr, cjErr,
	)
}

func podPhaseRollup(items []dto.PodListItemDTO) dto.NamespacePodHealth {
	var h dto.NamespacePodHealth
	for _, p := range items {
		switch p.Phase {
		case "Running":
			h.Running++
		case "Pending":
			h.Pending++
		case "Failed":
			h.Failed++
		case "Succeeded":
			h.Succeeded++
		default:
			h.Unknown++
		}
	}
	return h
}

func deploymentHealthRollup(items []dto.DeploymentListItemDTO) dto.NamespaceDeploymentHealth {
	var h dto.NamespaceDeploymentHealth
	for _, d := range items {
		switch d.Status {
		case "Available":
			h.Healthy++
		case "Progressing":
			h.Progressing++
		default:
			if d.Ready != "" && d.Ready != "0/0" {
				h.Degraded++
			}
		}
	}
	return h
}

func podProblematicFromList(items []dto.PodListItemDTO, limit int) []dto.ProblematicResource {
	if limit <= 0 {
		limit = namespaceSummaryMaxProblematic
	}
	var out []dto.ProblematicResource
	for _, p := range items {
		if len(out) >= limit {
			break
		}
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
		if p.Restarts >= 10 {
			isProblematic = true
			reason = "HighRestarts"
		}
		if isProblematic {
			if p.LastEvent != nil && p.LastEvent.Reason != "" {
				reason = p.LastEvent.Reason
			}
			out = append(out, dto.ProblematicResource{
				Kind:   "Pod",
				Name:   p.Name,
				Reason: reason,
			})
		}
	}
	return out
}

func mergeProblematicUnique(limit int, parts ...[]dto.ProblematicResource) []dto.ProblematicResource {
	if limit <= 0 {
		limit = namespaceSummaryMaxProblematic
	}
	seen := make(map[string]struct{})
	var out []dto.ProblematicResource
	for _, part := range parts {
		for _, pr := range part {
			if len(out) >= limit {
				return out
			}
			key := pr.Kind + "\x00" + pr.Name
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, pr)
		}
	}
	return out
}
