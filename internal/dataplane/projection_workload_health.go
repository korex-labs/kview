package dataplane

import (
	"kview/internal/kube/dto"
)

// WorkloadHealthProjection summarizes coarse health across workload list snapshots for one namespace.
// It is snapshot-only and intended for reuse (namespace summary, future rollups).
type WorkloadHealthProjection struct {
	Rollup dto.NamespaceWorkloadHealthRollupDTO
	// Meta composes observed-at / freshness / degradation from participating snapshots.
	Meta SnapshotMetadata
	// FirstNormalizedErr is the first non-nil snapshot normalized error among inputs (if any).
	FirstNormalizedErr *NormalizedError
}

// ProjectWorkloadHealthFromNamespaceSnapshots builds a workload health rollup from dataplane list snapshots.
// Fetch errors should be passed separately; when non-nil, rollup still runs on empty items for that kind.
func ProjectWorkloadHealthFromNamespaceSnapshots(
	deployments DeploymentsSnapshot, deploymentsErr error,
	daemonSets DaemonSetsSnapshot, daemonSetsErr error,
	statefulSets StatefulSetsSnapshot, statefulSetsErr error,
	replicaSets ReplicaSetsSnapshot, replicaSetsErr error,
	jobs JobsSnapshot, jobsErr error,
	cronJobs CronJobsSnapshot, cronJobsErr error,
) WorkloadHealthProjection {
	var metas []SnapshotMetadata
	var nerrs []*NormalizedError

	record := func(snap SnapshotMetadata, n *NormalizedError, fetchOK bool) {
		if fetchOK {
			metas = append(metas, snap)
		}
		if n != nil {
			nerrs = append(nerrs, n)
		}
	}

	record(deployments.Meta, deployments.Err, deploymentsErr == nil)
	record(daemonSets.Meta, daemonSets.Err, daemonSetsErr == nil)
	record(statefulSets.Meta, statefulSets.Err, statefulSetsErr == nil)
	record(replicaSets.Meta, replicaSets.Err, replicaSetsErr == nil)
	record(jobs.Meta, jobs.Err, jobsErr == nil)
	record(cronJobs.Meta, cronJobs.Err, cronJobsErr == nil)

	var out WorkloadHealthProjection
	out.Rollup.Deployments = rollupDeployments(deployments.Items)
	out.Rollup.DaemonSets = rollupDaemonSets(daemonSets.Items)
	out.Rollup.StatefulSets = rollupStatefulSets(statefulSets.Items)
	out.Rollup.ReplicaSets = rollupReplicaSets(replicaSets.Items)
	out.Rollup.Jobs = rollupJobs(jobs.Items)
	out.Rollup.CronJobs = rollupCronJobs(cronJobs.Items)

	contract := ProjectionContract{
		Coverage:     CoverageClassPartial,
		Completeness: CompletenessClassInexact,
	}
	if len(metas) > 0 {
		out.Meta = contract.Apply(
			ObservedAtFromSnapshots(metas...),
			WorstFreshnessFromSnapshots(metas...),
			WorstDegradationFromSnapshots(metas...),
		)
	} else {
		out.Meta = contract.Apply(
			ObservedAtFromSnapshots(),
			FreshnessClassUnknown,
			DegradationClassSevere,
		)
	}
	out.FirstNormalizedErr = FirstNonNilNormalizedError(nerrs...)
	return out
}

func rollupDeployments(items []dto.DeploymentListItemDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, d := range items {
		switch d.Status {
		case "Available":
			r.Healthy++
		case "Progressing":
			r.Progressing++
		default:
			if d.Ready != "" && d.Ready != "0/0" {
				r.Degraded++
			} else {
				r.Progressing++
			}
		}
	}
	return r
}

func rollupDaemonSets(items []dto.DaemonSetDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, ds := range items {
		switch {
		case ds.Desired == 0:
			r.Healthy++
		case ds.Ready == ds.Desired:
			r.Healthy++
		case ds.Current < ds.Desired || ds.Updated < ds.Desired:
			r.Progressing++
		default:
			r.Degraded++
		}
	}
	return r
}

func rollupStatefulSets(items []dto.StatefulSetDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, s := range items {
		switch {
		case s.Desired == 0:
			r.Healthy++
		case s.Ready == s.Desired && s.Desired > 0:
			r.Healthy++
		case s.Current < s.Desired:
			r.Progressing++
		default:
			r.Degraded++
		}
	}
	return r
}

func rollupReplicaSets(items []dto.ReplicaSetDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, rs := range items {
		switch {
		case rs.Desired == 0:
			r.Healthy++
		case rs.Ready == rs.Desired && rs.Desired > 0:
			r.Healthy++
		case rs.Ready < rs.Desired:
			r.Progressing++
		default:
			r.Degraded++
		}
	}
	return r
}

func rollupJobs(items []dto.JobDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, j := range items {
		switch j.Status {
		case "Complete":
			r.Healthy++
		case "Failed":
			r.Degraded++
		case "Running":
			r.Progressing++
		default:
			if j.Failed > 0 {
				r.Degraded++
			} else if j.Active > 0 {
				r.Progressing++
			} else {
				r.Degraded++
			}
		}
	}
	return r
}

func rollupCronJobs(items []dto.CronJobDTO) dto.WorkloadKindHealthRollupDTO {
	var r dto.WorkloadKindHealthRollupDTO
	r.Total = len(items)
	for _, cj := range items {
		if cj.Suspend {
			r.Healthy++
			continue
		}
		if cj.Active > 0 {
			r.Progressing++
		} else {
			r.Healthy++
		}
	}
	return r
}

// WorkloadProblematicCandidates returns a bounded list of problematic workload entries for summary views.
func WorkloadProblematicCandidates(
	deployments []dto.DeploymentListItemDTO,
	daemonSets []dto.DaemonSetDTO,
	statefulSets []dto.StatefulSetDTO,
	jobs []dto.JobDTO,
	cronJobs []dto.CronJobDTO,
	limit int,
) []dto.ProblematicResource {
	if limit <= 0 {
		limit = 10
	}
	var out []dto.ProblematicResource

	for _, d := range deployments {
		if len(out) >= limit {
			return out
		}
		if d.Status != "Available" && d.UpToDate > 0 && d.Available < d.UpToDate {
			reason := d.Status
			if d.LastEvent != nil && d.LastEvent.Reason != "" {
				reason = d.LastEvent.Reason
			}
			out = append(out, dto.ProblematicResource{Kind: "Deployment", Name: d.Name, Reason: reason})
		}
	}
	for _, ds := range daemonSets {
		if len(out) >= limit {
			return out
		}
		if ds.Desired > 0 && ds.Ready < ds.Desired {
			out = append(out, dto.ProblematicResource{Kind: "DaemonSet", Name: ds.Name, Reason: "NotReady"})
		}
	}
	for _, s := range statefulSets {
		if len(out) >= limit {
			return out
		}
		if s.Desired > 0 && s.Ready < s.Desired {
			out = append(out, dto.ProblematicResource{Kind: "StatefulSet", Name: s.Name, Reason: "NotReady"})
		}
	}
	for _, j := range jobs {
		if len(out) >= limit {
			return out
		}
		if j.Status == "Failed" || j.Failed > 0 {
			out = append(out, dto.ProblematicResource{Kind: "Job", Name: j.Name, Reason: j.Status})
		}
	}
	for _, cj := range cronJobs {
		if len(out) >= limit {
			return out
		}
		if !cj.Suspend && cj.Active >= 8 {
			out = append(out, dto.ProblematicResource{Kind: "CronJob", Name: cj.Name, Reason: "ManyConcurrentJobs"})
		}
	}
	return out
}
