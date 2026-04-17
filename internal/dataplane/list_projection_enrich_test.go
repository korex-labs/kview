package dataplane

import (
	"testing"

	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func TestListRestartSeverity(t *testing.T) {
	if ListRestartSeverity(0) != listRestartNone {
		t.Fatalf("0")
	}
	if ListRestartSeverity(4) != listRestartLow {
		t.Fatalf("low")
	}
	if ListRestartSeverity(7) != listRestartMedium {
		t.Fatalf("medium")
	}
	if ListRestartSeverity(25) != listRestartHigh {
		t.Fatalf("high")
	}
}

func TestEnrichPodListItemsForAPI(t *testing.T) {
	out := EnrichPodListItemsForAPI([]dto.PodListItemDTO{
		{Name: "a", Phase: "Running", Ready: "1/1", Restarts: 0},
		{Name: "b", Phase: "Pending", Ready: "0/1", Restarts: 0},
		{Name: "c", Phase: "Running", Ready: "0/1", Restarts: 4},
		{Name: "d", Phase: "Running", Ready: "1/1", Restarts: 4},
	})
	if out[0].ListHealthHint != podListHintOK || out[0].RestartSeverity != listRestartNone {
		t.Fatalf("row0: %+v", out[0])
	}
	if out[1].ListHealthHint != podListHintProblem {
		t.Fatalf("row1: %+v", out[1])
	}
	if out[2].ListHealthHint != podListHintProblem {
		t.Fatalf("row2 not ready: %+v", out[2])
	}
	if out[3].ListHealthHint != podListHintAttention {
		t.Fatalf("row3 restarts only: %+v", out[3])
	}
}

func TestEnrichDeploymentListItemsForAPI(t *testing.T) {
	out := EnrichDeploymentListItemsForAPI([]dto.DeploymentListItemDTO{
		{Status: "Available", Ready: "2/2"},
		{Status: "Progressing", Ready: "1/2", UpToDate: 2, Available: 1},
		{Status: "Unknown", Ready: "0/2", UpToDate: 2, Available: 0},
	})
	if out[0].HealthBucket != deployBucketHealthy || out[0].RolloutNeedsAttention {
		t.Fatalf("row0 %+v", out[0])
	}
	if out[1].HealthBucket != deployBucketProgressing {
		t.Fatalf("row1 bucket %+v", out[1])
	}
	if out[2].HealthBucket != deployBucketDegraded || !out[2].RolloutNeedsAttention {
		t.Fatalf("row2 %+v", out[2])
	}
}

func TestEnrichWorkloadListItemsForAPI(t *testing.T) {
	ds := EnrichDaemonSetListItemsForAPI([]dto.DaemonSetDTO{
		{Desired: 3, Ready: 3},
		{Desired: 3, Current: 2, Updated: 2, Ready: 1},
		{Desired: 3, Current: 3, Updated: 3, Ready: 1},
	})
	if ds[0].HealthBucket != deployBucketHealthy || ds[1].HealthBucket != deployBucketProgressing {
		t.Fatalf("daemonset healthy/progressing: %+v", ds)
	}
	if ds[2].HealthBucket != deployBucketDegraded || !ds[2].NeedsAttention {
		t.Fatalf("daemonset degraded: %+v", ds[2])
	}

	sts := EnrichStatefulSetListItemsForAPI([]dto.StatefulSetDTO{{Desired: 2, Current: 2, Updated: 2, Ready: 1}})
	if sts[0].HealthBucket != deployBucketDegraded || !sts[0].NeedsAttention {
		t.Fatalf("statefulset degraded: %+v", sts[0])
	}

	rs := EnrichReplicaSetListItemsForAPI([]dto.ReplicaSetDTO{{Desired: 2, Ready: 1}})
	if rs[0].HealthBucket != deployBucketProgressing || rs[0].NeedsAttention {
		t.Fatalf("replicaset progressing: %+v", rs[0])
	}

	jobs := EnrichJobListItemsForAPI([]dto.JobDTO{{Status: "Failed", Failed: 1}, {Status: "Running", Active: 1}})
	if jobs[0].HealthBucket != deployBucketDegraded || !jobs[0].NeedsAttention {
		t.Fatalf("job degraded: %+v", jobs[0])
	}
	if jobs[1].HealthBucket != deployBucketProgressing || jobs[1].NeedsAttention {
		t.Fatalf("job progressing: %+v", jobs[1])
	}

	cjs := EnrichCronJobListItemsForAPI([]dto.CronJobDTO{{Active: 9}, {Suspend: true}, {Active: 1}})
	if cjs[0].HealthBucket != deployBucketDegraded || !cjs[0].NeedsAttention {
		t.Fatalf("cronjob degraded: %+v", cjs[0])
	}
	if cjs[1].HealthBucket != deployBucketHealthy || cjs[1].NeedsAttention {
		t.Fatalf("cronjob suspended: %+v", cjs[1])
	}
	if cjs[2].HealthBucket != deployBucketProgressing || cjs[2].NeedsAttention {
		t.Fatalf("cronjob progressing: %+v", cjs[2])
	}
}
