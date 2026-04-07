package dataplane

import (
	"context"
	"testing"
)

// When no cluster manager is configured, snapshots should return unknown metadata without error
// (same contract as other namespaced snapshots).
func TestWorkloadSnapshots_NoClients_UnknownFreshness(t *testing.T) {
	dp := NewManager(ManagerConfig{})
	ctx := context.Background()
	cluster := "any-context"
	ns := "default"

	tests := []struct {
		name string
		fn   func() (SnapshotMetadata, error)
	}{
		{"daemonsets", func() (SnapshotMetadata, error) {
			s, err := dp.DaemonSetsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
		{"statefulsets", func() (SnapshotMetadata, error) {
			s, err := dp.StatefulSetsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
		{"replicasets", func() (SnapshotMetadata, error) {
			s, err := dp.ReplicaSetsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
		{"jobs", func() (SnapshotMetadata, error) {
			s, err := dp.JobsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
		{"cronjobs", func() (SnapshotMetadata, error) {
			s, err := dp.CronJobsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
		{"serviceaccounts", func() (SnapshotMetadata, error) {
			s, err := dp.ServiceAccountsSnapshot(ctx, cluster, ns)
			return s.Meta, err
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			meta, err := tc.fn()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if meta.Freshness != FreshnessClassUnknown {
				t.Fatalf("freshness: got %q want %q", meta.Freshness, FreshnessClassUnknown)
			}
			if meta.Coverage != CoverageClassUnknown {
				t.Fatalf("coverage: got %q want %q", meta.Coverage, CoverageClassUnknown)
			}
		})
	}
}
