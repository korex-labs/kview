package dataplane

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

func TestPodManualRefreshJoinsSchedulerAndPublishesBeforeFollowers(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	sched := newWorkScheduler(1)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	setNamespacedSnapshot(&store, "app", Snapshot[int]{Items: []int{1}, Meta: plane.snapshotMetaHot(time.Now())})
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Hour, capResource: "pods", capScope: CapabilityScopeNamespace,
		fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
			calls.Add(1)
			close(started)
			<-release
			return []int{2}, nil
		},
	}
	results := make(chan snapshotExecResult, 2)
	run := func() {
		snap, err := executeNamespacedSnapshot(plane, WithPodManualRefresh(context.Background()), sched, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
		results <- snapshotExecResult{snap: snap, err: err}
	}
	go run()
	<-started
	go run()
	time.Sleep(25 * time.Millisecond)
	close(release)
	for range 2 {
		result := <-results
		if result.err != nil || len(result.snap.Items) != 1 || result.snap.Items[0] != 2 {
			t.Fatalf("joined result not published: %+v", result)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("not deduplicated: %d", calls.Load())
	}
}

func TestPodRefreshIntentPolicyAndFailure(t *testing.T) {
	for _, bypass := range []bool{true, false} {
		t.Run(map[bool]string{true: "bypass", false: "respectTTL"}[bypass], func(t *testing.T) {
			policy := DefaultDataplanePolicy()
			policy.Snapshots.ManualRefreshBypassesTTL = bypass
			plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy { return policy }, nil, nil)
			sched := newWorkScheduler(1)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			setNamespacedSnapshot(&store, "app", Snapshot[int]{Items: []int{1}, Meta: plane.snapshotMetaHot(time.Now())})
			calls := 0
			fail := false
			desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Hour, capResource: "pods", capScope: CapabilityScopeNamespace,
				fetch: func(_ context.Context, _ *cluster.Clients, ns string) ([]int, error) {
					if ns != "app" {
						t.Errorf("unexpected scope %s", ns)
					}
					calls++
					if fail {
						return nil, errors.New("offline")
					}
					return []int{2}, nil
				},
			}
			run := func(ctx context.Context) (Snapshot[int], error) {
				return executeNamespacedSnapshot(plane, ctx, sched, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
			}
			if _, err := run(context.Background()); err != nil {
				t.Fatal(err)
			}
			if calls != 0 {
				t.Fatal("ordinary/auto read bypassed TTL")
			}
			snap, err := run(WithPodManualRefresh(context.Background()))
			if err != nil {
				t.Fatal(err)
			}
			if bypass {
				if calls != 1 || snap.Items[0] != 2 {
					t.Fatalf("manual failed to refresh: %v calls=%d", snap, calls)
				}
				fail = true
				snap, err = run(WithPodManualRefresh(context.Background()))
				if err == nil || len(snap.Items) != 1 || snap.Items[0] != 2 {
					t.Fatalf("lost usable cache on failure: %v %v", snap, err)
				}
			} else if calls != 0 || snap.Items[0] != 1 {
				t.Fatal("manual ignored policy")
			}
			// Expiring the cell advances the source without a manual bypass or metrics.
			fail = false
			setNamespacedSnapshot(&store, "app", Snapshot[int]{Items: []int{1}, Meta: plane.snapshotMetaHot(time.Now().Add(-2 * time.Hour))})
			snap, err = run(context.Background())
			if err != nil || snap.Items[0] != 2 {
				t.Fatalf("expired auto read did not advance: %v %v", snap, err)
			}
		})
	}
}
