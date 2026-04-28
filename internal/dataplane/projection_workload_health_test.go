package dataplane

import (
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestRollupDeployments(t *testing.T) {
	r := rollupDeployments([]dto.DeploymentListItemDTO{
		{Status: "Available"},
		{Status: "Progressing"},
		{Status: "Degraded", Ready: "0/1"},
	})
	if r.Total != 3 || r.Healthy != 1 || r.Progressing != 1 || r.Degraded != 1 {
		t.Fatalf("got %+v", r)
	}
}

func TestRollupDaemonSets(t *testing.T) {
	r := rollupDaemonSets([]dto.DaemonSetDTO{
		{Desired: 3, Ready: 3, Current: 3, Updated: 3},
		{Desired: 3, Ready: 1, Current: 2, Updated: 2},
	})
	if r.Healthy != 1 || r.Progressing != 1 {
		t.Fatalf("got %+v", r)
	}
}

func TestProjectWorkloadHealthFromNamespaceSnapshots_NoFetchErrors(t *testing.T) {
	out := ProjectWorkloadHealthFromNamespaceSnapshots(
		DeploymentsSnapshot{Items: []dto.DeploymentListItemDTO{{Status: "Available"}}}, nil,
		DaemonSetsSnapshot{}, nil,
		StatefulSetsSnapshot{}, nil,
		ReplicaSetsSnapshot{}, nil,
		JobsSnapshot{}, nil,
		CronJobsSnapshot{}, nil,
	)
	if out.Rollup.Deployments.Total != 1 || out.Rollup.Deployments.Healthy != 1 {
		t.Fatalf("rollup: %+v", out.Rollup.Deployments)
	}
}
