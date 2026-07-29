package dataplane

import (
	"context"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestPreviewSignalExclusionsUsesCachedMetadata(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	manager := NewManager(ManagerConfig{}).(*manager)
	planeAny, err := manager.PlaneForCluster(context.Background(), "ctx")
	if err != nil {
		t.Fatal(err)
	}
	plane := planeAny.(*clusterPlane)
	meta := SnapshotMetadata{ObservedAt: time.Now().UTC()}
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: meta, Items: []dto.PodListItemDTO{{
		Name: "api-0", Namespace: "apps", Restarts: 8, Labels: map[string]string{"track": "canary"},
	}}})

	result, err := manager.PreviewSignalExclusions(context.Background(), "ctx", "pod_restarts", SignalExclusionSet{Rules: []SignalExclusionRule{{
		ID: "canary", Match: " all ", Conditions: []SignalExclusionCondition{{Source: " label ", Key: " track ", Pattern: "^canary$"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.CacheOnly || result.CandidateCount != 1 || result.MatchedCount != 1 || len(result.Items) != 1 {
		t.Fatalf("unexpected preview result: %+v", result)
	}
	if result.Items[0].ResourceKind != "Pod" || result.Items[0].Namespace != "apps" || result.Items[0].ResourceName != "api-0" {
		t.Fatalf("unexpected preview item: %+v", result.Items[0])
	}
}

func TestDedupeSignalExclusionPreviewCandidates(t *testing.T) {
	item := ClusterDashboardSignal{SignalType: "pv_node_bound_storage", ResourceKind: "PersistentVolume", ResourceName: "pv-0", Reason: "node bound"}
	got := dedupeSignalExclusionPreviewCandidates([]ClusterDashboardSignal{item, item})
	if len(got) != 1 {
		t.Fatalf("deduplicated candidates = %d, want 1", len(got))
	}
}

func TestPreviewSignalExclusionsHonorsCanceledContext(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	manager := NewManager(ManagerConfig{}).(*manager)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := manager.PreviewSignalExclusions(ctx, "ctx", "pod_restarts", SignalExclusionSet{})
	if err == nil {
		t.Fatal("expected canceled preview to fail")
	}
}

func TestPreviewSignalExclusionsRejectsInvalidDraft(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	manager := NewManager(ManagerConfig{}).(*manager)
	_, err := manager.PreviewSignalExclusions(context.Background(), "ctx", "pod_restarts", SignalExclusionSet{Rules: []SignalExclusionRule{{
		ID: "bad", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "["}},
	}}})
	if err == nil {
		t.Fatal("expected invalid preview draft to be rejected")
	}
}
