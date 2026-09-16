package dataplane

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// The source is deliberately held open: returning rows must not depend on its
// completion. No kubeconfig, credentials, or network clients are used.
func TestStartupHydratedSnapshotDoesNotWaitForSource(t *testing.T) {
	for _, namespaced := range []bool{false, true} {
		name := "cluster"
		if namespaced {
			name = "pods"
		}
		t.Run(name, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			scheduler := newWorkScheduler(1)
			observed := time.Now().UTC().Add(-time.Hour)
			original := Snapshot[int]{Items: []int{42}, Meta: p.snapshotMetaHot(observed)}
			persistence, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
			if err != nil {
				t.Fatal(err)
			}
			defer persistence.Close()
			kind, namespace := ResourceKindNodes, ""
			if namespaced {
				kind, namespace = ResourceKindPods, "app"
			}
			if err := persistence.Save("ctx", kind, namespace, original); err != nil {
				t.Fatal(err)
			}
			cells, err := persistence.ListSnapshots("ctx")
			if err != nil || len(cells) != 1 {
				t.Fatalf("cells=%v err=%v", cells, err)
			}
			var store snapshotStore[Snapshot[int]]
			nsStore := newNamespacedSnapshotStore[Snapshot[int]]()
			if namespaced {
				err = hydratePersistedNamespacedSnapshotInto(&nsStore, namespace, cells[0].Payload, 24*time.Hour)
			} else {
				err = hydratePersistedClusterSnapshotInto(&store, cells[0].Payload, 24*time.Hour)
			}
			if err != nil {
				t.Fatal(err)
			}
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			fetch := func(ctx context.Context) ([]int, error) {
				if calls.Add(1) == 1 {
					close(started)
				}
				select {
				case <-release:
					return []int{99}, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}
			released := false
			defer func() {
				if !released {
					close(release)
				}
			}()
			run := func() (Snapshot[int], error) {
				if namespaced {
					return executeNamespacedSnapshot(p, context.Background(), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, namespace, &nsStore, namespacedSnapshotDescriptor[int]{kind: kind, ttl: time.Second, fetch: func(ctx context.Context, _ *cluster.Clients, _ string) ([]int, error) { return fetch(ctx) }})
				}
				return executeClusterSnapshot(p, context.Background(), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, &store, clusterSnapshotDescriptor[int]{kind: kind, ttl: time.Second, fetch: func(ctx context.Context, _ *cluster.Clients) ([]int, error) { return fetch(ctx) }})
			}
			result := make(chan snapshotExecResult, 1)
			begin := time.Now()
			go func() { snap, err := run(); result <- snapshotExecResult{snap, err} }()
			select {
			case got := <-result:
				t.Logf("cached foreground response %s while source gated", time.Since(begin))
				if got.err != nil || len(got.snap.Items) != 1 || got.snap.Items[0] != 42 || got.snap.Meta.Freshness != FreshnessClassStale || !got.snap.Meta.ObservedAt.Equal(observed) || got.snap.Meta.Revision == 0 {
					t.Fatalf("unexpected cache result: %+v, %v", got.snap, got.err)
				}
			case <-time.After(250 * time.Millisecond):
				t.Fatal("hydrated foreground rows blocked behind live source")
			}
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("background refresh never started")
			}
			for i := 0; i < 10; i++ {
				snap, err := run()
				if err != nil || snap.Items[0] != 42 {
					t.Fatalf("repeat read: %+v %v", snap, err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("refresh calls=%d", calls.Load())
			}
			close(release)
			released = true
			deadline := time.Now().Add(time.Second)
			for {
				var snap Snapshot[int]
				if namespaced {
					snap, _ = peekNamespacedSnapshot(&nsStore, namespace)
				} else {
					snap, _ = peekClusterSnapshot(&store)
				}
				if len(snap.Items) == 1 && snap.Items[0] == 99 && snap.Meta.Freshness == FreshnessClassHot && snap.Meta.Revision > 1 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("live refresh did not publish: %+v", snap)
				}
				time.Sleep(time.Millisecond)
			}
		})
	}
}
