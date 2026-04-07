package dataplane

import (
	"strconv"
	"strings"

	"kview/internal/kube/dto"
)

const (
	podListHintOK        = "ok"
	podListHintAttention = "attention"
	podListHintProblem   = "problem"

	listRestartNone   = "none"
	listRestartLow    = "low"
	listRestartMedium = "medium"
	listRestartHigh   = "high"

	deployBucketHealthy     = "healthy"
	deployBucketProgressing = "progressing"
	deployBucketDegraded    = "degraded"
	deployBucketUnknown     = "unknown"
)

// ListRestartSeverity maps total pod restarts to a coarse bucket for list APIs (zero → none).
func ListRestartSeverity(restarts int32) string {
	if restarts <= 0 {
		return listRestartNone
	}
	switch {
	case restarts >= 20:
		return listRestartHigh
	case restarts >= 5:
		return listRestartMedium
	default:
		return listRestartLow
	}
}

// EnrichPodListItemsForAPI returns a shallow copy slice with snapshot-derived list hints per row.
func EnrichPodListItemsForAPI(items []dto.PodListItemDTO) []dto.PodListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.PodListItemDTO, len(items))
	for i := range items {
		p := items[i]
		p.RestartSeverity = ListRestartSeverity(p.Restarts)
		p.ListHealthHint = podListHealthHint(p)
		out[i] = p
	}
	return out
}

func podListHealthHint(p dto.PodListItemDTO) string {
	if p.Phase == "Failed" || p.Phase == "Pending" {
		return podListHintProblem
	}
	if p.Restarts >= 10 {
		return podListHintProblem
	}
	if podListNotReady(p.Ready) {
		return podListHintProblem
	}
	if p.Restarts >= 3 {
		return podListHintAttention
	}
	if p.LastEvent != nil && p.LastEvent.Type == "Warning" {
		return podListHintAttention
	}
	return podListHintOK
}

func podListNotReady(ready string) bool {
	parts := strings.Split(ready, "/")
	if len(parts) != 2 {
		return false
	}
	a, e1 := strconv.Atoi(parts[0])
	b, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil {
		return false
	}
	return b > 0 && a < b
}

// EnrichDeploymentListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichDeploymentListItemsForAPI(items []dto.DeploymentListItemDTO) []dto.DeploymentListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.DeploymentListItemDTO, len(items))
	for i := range items {
		d := items[i]
		bucket, attention := deploymentListSignals(d)
		d.HealthBucket = bucket
		d.RolloutNeedsAttention = attention
		out[i] = d
	}
	return out
}

func deploymentListSignals(d dto.DeploymentListItemDTO) (bucket string, needsAttention bool) {
	switch d.Status {
	case "Available":
		return deployBucketHealthy, false
	case "Progressing":
		return deployBucketProgressing, false
	case "Paused", "ScaledDown":
		return deployBucketUnknown, false
	}
	if d.UpToDate > 0 && d.Available < d.UpToDate {
		return deployBucketDegraded, true
	}
	if podListNotReady(d.Ready) {
		return deployBucketDegraded, true
	}
	return deployBucketUnknown, false
}

// EnrichDaemonSetListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichDaemonSetListItemsForAPI(items []dto.DaemonSetDTO) []dto.DaemonSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.DaemonSetDTO, len(items))
	for i := range items {
		ds := items[i]
		ds.HealthBucket, ds.NeedsAttention = daemonSetListSignals(ds)
		out[i] = ds
	}
	return out
}

func daemonSetListSignals(ds dto.DaemonSetDTO) (bucket string, needsAttention bool) {
	switch {
	case ds.Desired == 0:
		return deployBucketHealthy, false
	case ds.Ready == ds.Desired:
		return deployBucketHealthy, false
	case ds.Current < ds.Desired || ds.Updated < ds.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichStatefulSetListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichStatefulSetListItemsForAPI(items []dto.StatefulSetDTO) []dto.StatefulSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.StatefulSetDTO, len(items))
	for i := range items {
		sts := items[i]
		sts.HealthBucket, sts.NeedsAttention = statefulSetListSignals(sts)
		out[i] = sts
	}
	return out
}

func statefulSetListSignals(sts dto.StatefulSetDTO) (bucket string, needsAttention bool) {
	switch {
	case sts.Desired == 0:
		return deployBucketHealthy, false
	case sts.Ready == sts.Desired && sts.Desired > 0:
		return deployBucketHealthy, false
	case sts.Current < sts.Desired || sts.Updated < sts.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichReplicaSetListItemsForAPI returns a shallow copy with snapshot-derived readiness hints.
func EnrichReplicaSetListItemsForAPI(items []dto.ReplicaSetDTO) []dto.ReplicaSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ReplicaSetDTO, len(items))
	for i := range items {
		rs := items[i]
		rs.HealthBucket, rs.NeedsAttention = replicaSetListSignals(rs)
		out[i] = rs
	}
	return out
}

func replicaSetListSignals(rs dto.ReplicaSetDTO) (bucket string, needsAttention bool) {
	switch {
	case rs.Desired == 0:
		return deployBucketHealthy, false
	case rs.Ready == rs.Desired && rs.Desired > 0:
		return deployBucketHealthy, false
	case rs.Ready < rs.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichJobListItemsForAPI returns a shallow copy with snapshot-derived status hints.
func EnrichJobListItemsForAPI(items []dto.JobDTO) []dto.JobDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.JobDTO, len(items))
	for i := range items {
		j := items[i]
		j.HealthBucket, j.NeedsAttention = jobListSignals(j)
		out[i] = j
	}
	return out
}

func jobListSignals(j dto.JobDTO) (bucket string, needsAttention bool) {
	switch j.Status {
	case "Complete":
		return deployBucketHealthy, false
	case "Failed":
		return deployBucketDegraded, true
	case "Running":
		return deployBucketProgressing, false
	default:
		if j.Failed > 0 {
			return deployBucketDegraded, true
		}
		if j.Active > 0 {
			return deployBucketProgressing, false
		}
		return deployBucketUnknown, false
	}
}

// EnrichCronJobListItemsForAPI returns a shallow copy with snapshot-derived status hints.
func EnrichCronJobListItemsForAPI(items []dto.CronJobDTO) []dto.CronJobDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.CronJobDTO, len(items))
	for i := range items {
		cj := items[i]
		cj.HealthBucket, cj.NeedsAttention = cronJobListSignals(cj)
		out[i] = cj
	}
	return out
}

func cronJobListSignals(cj dto.CronJobDTO) (bucket string, needsAttention bool) {
	switch {
	case cj.Suspend:
		return deployBucketHealthy, false
	case cj.Active >= 8:
		return deployBucketDegraded, true
	case cj.Active > 0:
		return deployBucketProgressing, false
	default:
		return deployBucketHealthy, false
	}
}
