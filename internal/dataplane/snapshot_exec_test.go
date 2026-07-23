package dataplane

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

type snapshotExecClientsProvider struct{}

type snapshotExecResult struct {
	snap Snapshot[int]
	err  error
}

func (snapshotExecClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return &cluster.Clients{}, "ctx", nil
}

func TestExecuteNamespacedSnapshotJoinedCallerPreservesStaleResult(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	scheduler := newWorkScheduler(1)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	setNamespacedSnapshot(&store, "app", Snapshot[int]{
		Items: []int{1},
		Meta:  plane.snapshotMetaHot(time.Now().UTC().Add(-time.Hour)),
	})

	started := make(chan struct{})
	release := make(chan struct{})
	var fetches atomic.Int32
	desc := namespacedSnapshotDescriptor[int]{
		kind:            ResourceKindPodMetrics,
		ttl:             time.Second,
		capGroup:        "metrics.k8s.io",
		capResource:     "pods",
		capScope:        CapabilityScopeNamespace,
		skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
			if fetches.Add(1) == 1 {
				close(started)
				<-release
			}
			return []int{2}, nil
		},
	}
	results := make(chan snapshotExecResult, 2)
	run := func() {
		snap, err := executeNamespacedSnapshot(
			plane,
			context.Background(),
			scheduler,
			WorkPriorityCritical,
			snapshotExecClientsProvider{},
			"app",
			&store,
			desc,
		)
		results <- snapshotExecResult{snap: snap, err: err}
	}

	go run()
	<-started
	go run()
	// Give the second caller time to join the in-flight scheduler entry.
	time.Sleep(25 * time.Millisecond)
	close(release)

	assertJoinedSnapshotResults(t, results, &fetches)
	cached, ok := peekNamespacedSnapshot(&store, "app")
	if !ok || len(cached.Items) != 1 || cached.Items[0] != 2 {
		t.Fatalf("cached snapshot after joined calls = %+v, ok=%v", cached.Items, ok)
	}
}

func TestExecuteClusterSnapshotJoinedCallerPreservesStaleResult(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	scheduler := newWorkScheduler(1)
	store := snapshotStore[Snapshot[int]]{}
	setClusterSnapshot(&store, Snapshot[int]{
		Items: []int{1},
		Meta:  plane.snapshotMetaHot(time.Now().UTC().Add(-time.Hour)),
	})

	started := make(chan struct{})
	release := make(chan struct{})
	var fetches atomic.Int32
	desc := clusterSnapshotDescriptor[int]{
		kind:            ResourceKindNodeMetrics,
		ttl:             time.Second,
		capGroup:        "metrics.k8s.io",
		capResource:     "nodes",
		capScope:        CapabilityScopeCluster,
		skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients) ([]int, error) {
			if fetches.Add(1) == 1 {
				close(started)
				<-release
			}
			return []int{2}, nil
		},
	}
	results := make(chan snapshotExecResult, 2)
	run := func() {
		snap, err := executeClusterSnapshot(
			plane,
			context.Background(),
			scheduler,
			WorkPriorityCritical,
			snapshotExecClientsProvider{},
			&store,
			desc,
		)
		results <- snapshotExecResult{snap: snap, err: err}
	}

	go run()
	<-started
	go run()
	time.Sleep(25 * time.Millisecond)
	close(release)

	assertJoinedSnapshotResults(t, results, &fetches)
	cached, ok := peekClusterSnapshot(&store)
	if !ok || len(cached.Items) != 1 || cached.Items[0] != 2 {
		t.Fatalf("cached snapshot after joined calls = %+v, ok=%v", cached.Items, ok)
	}
}

func assertJoinedSnapshotResults(t *testing.T, results <-chan snapshotExecResult, fetches *atomic.Int32) {
	t.Helper()
	sawFresh := false
	for i := 0; i < 2; i++ {
		got := <-results
		if got.err != nil {
			t.Fatalf("snapshot call %d returned error: %v", i, got.err)
		}
		if len(got.snap.Items) != 1 || (got.snap.Items[0] != 1 && got.snap.Items[0] != 2) {
			t.Fatalf("snapshot call %d items = %v, want stale [1] or fresh [2], never empty", i, got.snap.Items)
		}
		if got.snap.Items[0] == 2 {
			sawFresh = true
		}
	}
	if !sawFresh {
		t.Fatal("scheduler owner did not return the fresh result")
	}
	if got := fetches.Load(); got != 1 {
		t.Fatalf("fetch count = %d, want one deduplicated fetch", got)
	}
}
