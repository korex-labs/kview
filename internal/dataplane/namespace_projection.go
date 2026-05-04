package dataplane

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

const (
	namespaceSummaryMaxProblematic = 10
)

// NamespaceSummaryProjection is a projection-backed view of namespace resources plus metadata.
type NamespaceSummaryProjection struct {
	Resources dto.NamespaceSummaryResourcesDTO
	Meta      SnapshotMetadata
	Err       *NormalizedError
}

type namespaceProjectionSnapshots struct {
	pods            PodsSnapshot
	podsErr         error
	deps            DeploymentsSnapshot
	depsErr         error
	svcs            ServicesSnapshot
	svcsErr         error
	ing             IngressesSnapshot
	ingErr          error
	pvcs            PVCsSnapshot
	pvcsErr         error
	cms             ConfigMapsSnapshot
	cmsErr          error
	secs            SecretsSnapshot
	secsErr         error
	ds              DaemonSetsSnapshot
	dsErr           error
	sts             StatefulSetsSnapshot
	stsErr          error
	rs              ReplicaSetsSnapshot
	rsErr           error
	jobs            JobsSnapshot
	jobsErr         error
	cj              CronJobsSnapshot
	cjErr           error
	hpa             HPAsSnapshot
	hpaErr          error
	sa              ServiceAccountsSnapshot
	saErr           error
	roles           RolesSnapshot
	rolesErr        error
	roleBindings    RoleBindingsSnapshot
	roleBindingsErr error
	helm            HelmReleasesSnapshot
	helmErr         error
	rq              ResourceQuotasSnapshot
	rqErr           error
	lr              LimitRangesSnapshot
	lrErr           error
}

func (m *manager) loadNamespaceProjectionSnapshots(
	ctx context.Context,
	plane *clusterPlane,
	namespace string,
	prio WorkPriority,
) namespaceProjectionSnapshots {
	var snaps namespaceProjectionSnapshots
	var wg sync.WaitGroup

	wg.Add(19)
	go func() {
		defer wg.Done()
		snaps.pods, snaps.podsErr = plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.deps, snaps.depsErr = plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.svcs, snaps.svcsErr = plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.ing, snaps.ingErr = plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.pvcs, snaps.pvcsErr = plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.cms, snaps.cmsErr = plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.secs, snaps.secsErr = plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.ds, snaps.dsErr = plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.sts, snaps.stsErr = plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.rs, snaps.rsErr = plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.jobs, snaps.jobsErr = plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.cj, snaps.cjErr = plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.hpa, snaps.hpaErr = plane.HPAsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.sa, snaps.saErr = plane.ServiceAccountsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.roles, snaps.rolesErr = plane.RolesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.roleBindings, snaps.roleBindingsErr = plane.RoleBindingsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.helm, snaps.helmErr = plane.HelmReleasesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.rq, snaps.rqErr = plane.ResourceQuotasSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()
	go func() {
		defer wg.Done()
		snaps.lr, snaps.lrErr = plane.LimitRangesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	}()

	wg.Wait()
	return snaps
}

// NamespaceSummaryProjection builds a namespace summary from dataplane snapshots (projection-led).
// It must not perform ad hoc kube client reads; only DataPlaneManager snapshot entrypoints.
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

	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceProjection)

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

	prio := WorkPriorityHigh
	snaps := m.loadNamespaceProjectionSnapshots(ctx, plane, namespace, prio)

	return buildNamespaceSummaryProjectionFromSnapshots(snaps)
}

func buildNamespaceSummaryProjectionFromSnapshots(snaps namespaceProjectionSnapshots) (NamespaceSummaryProjection, error) {
	var out NamespaceSummaryProjection
	res := dto.NamespaceSummaryResourcesDTO{
		Problematic: []dto.ProblematicResource{},
	}

	if snaps.podsErr == nil {
		res.Counts.Pods = len(snaps.pods.Items)
	}
	if snaps.depsErr == nil {
		res.Counts.Deployments = len(snaps.deps.Items)
	}
	if snaps.svcsErr == nil {
		res.Counts.Services = len(snaps.svcs.Items)
	}
	if snaps.ingErr == nil {
		res.Counts.Ingresses = len(snaps.ing.Items)
	}
	if snaps.pvcsErr == nil {
		res.Counts.PVCs = len(snaps.pvcs.Items)
	}
	if snaps.cmsErr == nil {
		res.Counts.ConfigMaps = len(snaps.cms.Items)
	}
	if snaps.secsErr == nil {
		res.Counts.Secrets = len(snaps.secs.Items)
	}
	if snaps.saErr == nil {
		res.Counts.ServiceAccounts = len(snaps.sa.Items)
	}
	if snaps.rolesErr == nil {
		res.Counts.Roles = len(snaps.roles.Items)
	}
	if snaps.roleBindingsErr == nil {
		res.Counts.RoleBindings = len(snaps.roleBindings.Items)
	}
	if snaps.dsErr == nil {
		res.Counts.DaemonSets = len(snaps.ds.Items)
	}
	if snaps.stsErr == nil {
		res.Counts.StatefulSets = len(snaps.sts.Items)
	}
	if snaps.jobsErr == nil {
		res.Counts.Jobs = len(snaps.jobs.Items)
	}
	if snaps.cjErr == nil {
		res.Counts.CronJobs = len(snaps.cj.Items)
	}
	if snaps.hpaErr == nil {
		res.Counts.HPAs = len(snaps.hpa.Items)
	}
	if snaps.helmErr == nil {
		res.Counts.HelmReleases = len(snaps.helm.Items)
		res.HelmReleases = namespaceHelmReleasesFromSnapshot(snaps.helm.Items)
	}
	if snaps.rqErr == nil {
		res.Counts.ResourceQuotas = len(snaps.rq.Items)
	}
	if snaps.lrErr == nil {
		res.Counts.LimitRanges = len(snaps.lr.Items)
	}

	if snaps.podsErr == nil {
		res.PodHealth = podPhaseRollup(snaps.pods.Items)
	}
	if snaps.depsErr == nil {
		res.DeployHealth = deploymentHealthRollup(snaps.deps.Items)
	}

	wh := ProjectWorkloadHealthFromNamespaceSnapshots(
		snaps.deps, snaps.depsErr,
		snaps.ds, snaps.dsErr,
		snaps.sts, snaps.stsErr,
		snaps.rs, snaps.rsErr,
		snaps.jobs, snaps.jobsErr,
		snaps.cj, snaps.cjErr,
	)
	res.WorkloadByKind = &wh.Rollup

	workloadProblems := WorkloadProblematicCandidates(
		snaps.deps.Items,
		snaps.ds.Items,
		snaps.sts.Items,
		snaps.jobs.Items,
		snaps.cj.Items,
		namespaceSummaryMaxProblematic,
	)
	var podProblems []dto.ProblematicResource
	if snaps.podsErr == nil {
		podProblems = podProblematicFromList(snaps.pods.Items, namespaceSummaryMaxProblematic)
	}
	res.Problematic = mergeProblematicUnique(namespaceSummaryMaxProblematic, workloadProblems, podProblems)

	meta := composeNamespaceSummaryProjectionMeta(
		snaps.pods.Meta,
		snaps.deps.Meta,
		snaps.svcs.Meta,
		snaps.ing.Meta,
		snaps.pvcs.Meta,
		snaps.cms.Meta,
		snaps.secs.Meta,
		snaps.ds.Meta,
		snaps.sts.Meta,
		snaps.rs.Meta,
		snaps.jobs.Meta,
		snaps.cj.Meta,
		snaps.hpa.Meta,
		snaps.sa.Meta,
		snaps.roles.Meta,
		snaps.roleBindings.Meta,
		snaps.helm.Meta,
		snaps.rq.Meta,
		snaps.lr.Meta,
	)
	out.Meta = meta

	firstNorm := FirstNonNilNormalizedError(
		snaps.pods.Err, snaps.deps.Err, snaps.svcs.Err, snaps.ing.Err, snaps.pvcs.Err, snaps.cms.Err, snaps.secs.Err,
		snaps.ds.Err, snaps.sts.Err, snaps.rs.Err, snaps.jobs.Err, snaps.cj.Err, snaps.hpa.Err,
		snaps.sa.Err, snaps.roles.Err, snaps.roleBindings.Err, snaps.helm.Err, snaps.rq.Err, snaps.lr.Err,
	)

	meaningful := res.Counts.Pods + res.Counts.Deployments + res.Counts.Services +
		res.Counts.Ingresses + res.Counts.PVCs + res.Counts.ConfigMaps + res.Counts.Secrets +
		res.Counts.DaemonSets + res.Counts.StatefulSets + res.Counts.Jobs + res.Counts.CronJobs +
		res.Counts.HPAs +
		res.Counts.ServiceAccounts + res.Counts.Roles + res.Counts.RoleBindings + res.Counts.HelmReleases +
		res.Counts.ResourceQuotas + res.Counts.LimitRanges
	usable := namespaceSummaryHasUsableSnapshot(
		snaps.podsErr, snaps.depsErr, snaps.svcsErr, snaps.ingErr, snaps.pvcsErr, snaps.cmsErr, snaps.secsErr,
		snaps.dsErr, snaps.stsErr, snaps.rsErr, snaps.jobsErr, snaps.cjErr, snaps.hpaErr,
		snaps.saErr, snaps.rolesErr, snaps.roleBindingsErr, snaps.helmErr, snaps.rqErr, snaps.lrErr,
	)
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
	err := FirstError(
		snaps.podsErr, snaps.depsErr, snaps.svcsErr, snaps.ingErr, snaps.pvcsErr, snaps.cmsErr, snaps.secsErr,
		snaps.dsErr, snaps.stsErr, snaps.rsErr, snaps.jobsErr, snaps.cjErr, snaps.hpaErr,
		snaps.saErr, snaps.rolesErr, snaps.roleBindingsErr, snaps.helmErr, snaps.rqErr, snaps.lrErr,
	)
	return out, namespaceSummaryProjectionError(err, usable)
}

func namespaceSummaryHasUsableSnapshot(errs ...error) bool {
	for _, err := range errs {
		if err == nil {
			return true
		}
	}
	return false
}

func namespaceSummaryProjectionError(err error, hasUsableSnapshot bool) error {
	if hasUsableSnapshot {
		return nil
	}
	return err
}

func namespaceHelmReleasesFromSnapshot(items []dto.HelmReleaseDTO) []dto.NamespaceHelmRelease {
	out := make([]dto.NamespaceHelmRelease, 0, len(items))
	for _, r := range items {
		out = append(out, dto.NamespaceHelmRelease{
			Name:     r.Name,
			Status:   r.Status,
			Revision: r.Revision,
		})
	}
	return out
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
		if p.Restarts >= signalPodRestartNoteThreshold {
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
