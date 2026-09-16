package dataplane

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// A cold read must obtain real source rows; it must neither manufacture an
// empty successful cell nor wait for a separate inventory warmup stage.
func TestStartupColdSnapshotRequiresSourceRows(t *testing.T) {
	for _, namespaced := range []bool{false, true} {
		name := "cluster"
		if namespaced {
			name = "pods"
		}
		t.Run(name, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			scheduler := newWorkScheduler(2)
			var store snapshotStore[Snapshot[int]]
			nsStore := newNamespacedSnapshotStore[Snapshot[int]]()
			started, release := make(chan struct{}), make(chan struct{})
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			// Hold unrelated background work open for the entire foreground
			// request. Only this request's LIST may gate its first real rows.
			backgroundStarted, backgroundDone := make(chan struct{}), make(chan struct{})
			go func() {
				defer close(backgroundDone)
				_ = scheduler.Run(ctx, WorkPriorityLow, workKey{Cluster: "other-context", Class: WorkClassSnapshot, Kind: ResourceKindNamespaces}, func(ctx context.Context) error {
					close(backgroundStarted)
					<-ctx.Done()
					return ctx.Err()
				})
			}()
			defer func() { cancel(); <-backgroundDone }()
			select {
			case <-backgroundStarted:
			case <-ctx.Done():
				t.Fatal("background fixture did not start")
			}
			fetch := func(ctx context.Context) ([]int, error) {
				close(started)
				select {
				case <-release:
					return []int{99}, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}
			result := make(chan snapshotExecResult, 1)
			go func() {
				var snap Snapshot[int]
				var err error
				if namespaced {
					snap, err = executeNamespacedSnapshot(p, ctx, scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &nsStore, namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Hour, fetch: func(ctx context.Context, _ *cluster.Clients, ns string) ([]int, error) {
						if ns != "app" {
							t.Errorf("source namespace=%q", ns)
						}
						return fetch(ctx)
					}})
				} else {
					snap, err = executeClusterSnapshot(p, ctx, scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, &store, clusterSnapshotDescriptor[int]{kind: ResourceKindNodes, ttl: time.Hour, fetch: func(ctx context.Context, _ *cluster.Clients) ([]int, error) { return fetch(ctx) }})
				}
				result <- snapshotExecResult{snap, err}
			}()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("cold source did not start")
			}
			select {
			case got := <-result:
				t.Fatalf("cold request returned before source: %+v", got)
			default:
			}
			if namespaced {
				if _, ok := peekNamespacedSnapshot(&nsStore, "app"); ok {
					t.Fatal("fabricated cold cache cell")
				}
			} else if _, ok := peekClusterSnapshot(&store); ok {
				t.Fatal("fabricated cold cache cell")
			}
			close(release)
			select {
			case got := <-result:
				if got.err != nil || len(got.snap.Items) != 1 || got.snap.Items[0] != 99 || got.snap.Meta.Freshness != FreshnessClassHot || got.snap.restored {
					t.Fatalf("source result not returned: %+v", got)
				}
			case <-ctx.Done():
				t.Fatal("cold rows blocked after source completed")
			}
		})
	}
}

func TestStartupSnapshotEligibility(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	valid := Snapshot[int]{restored: true, Items: []int{42}, Meta: p.snapshotMetaHot(time.Now().Add(-time.Minute))}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	cases := []struct {
		name       string
		mutate     func(*Snapshot[int])
		ctx        context.Context
		background bool
		want       bool
	}{
		{name: "restored", want: true},
		{name: "emptyObservedSuccess", mutate: func(s *Snapshot[int]) { s.Items = nil }, want: true},
		{name: "ordinaryRuntimeStale", mutate: func(s *Snapshot[int]) { s.restored = false }},
		{name: "missingObservation", mutate: func(s *Snapshot[int]) { s.Meta.ObservedAt = time.Time{} }},
		{name: "expired", mutate: func(s *Snapshot[int]) { s.Meta.ObservedAt = time.Now().Add(-2 * time.Hour) }},
		{name: "error", mutate: func(s *Snapshot[int]) { s.Err = &NormalizedError{} }},
		{name: "background", background: true},
		{name: "projection", ctx: ContextWithWorkSource(context.Background(), WorkSourceProjection)},
		{name: "cancelled", ctx: cancelled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			snap := valid
			if tc.mutate != nil {
				tc.mutate(&snap)
			}
			ctx := tc.ctx
			if ctx == nil {
				ctx = context.Background()
			}
			priority := WorkPriorityCritical
			if tc.background {
				priority = WorkPriorityLow
			}
			if got := serveStartupSnapshot(ctx, priority, snap, time.Hour); got != tc.want {
				t.Fatalf("eligible=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestStartupManualRefreshDoesNotServeRestoredCell(t *testing.T) {
	for _, bypass := range []bool{true, false} {
		t.Run(map[bool]string{true: "bypassTTL", false: "respectTTL"}[bypass], func(t *testing.T) {
			policy := DefaultDataplanePolicy()
			policy.Snapshots.ManualRefreshBypassesTTL = bypass
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy { return policy }, nil, nil)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			// Even a recently persisted cell remains stale after hydration. Manual
			// refresh must not take the startup-only response path in either policy.
			cached := Snapshot[int]{restored: true, Items: []int{42}, Meta: p.snapshotMetaHot(time.Now())}
			cached.Meta.Freshness = FreshnessClassStale
			setNamespacedSnapshot(&store, "app", cached)
			calls := 0
			snap, err := executeNamespacedSnapshot(p, WithPodManualRefresh(context.Background()), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Hour, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) { calls++; return []int{99}, nil }})
			if err != nil || calls != 1 || len(snap.Items) != 1 || snap.Items[0] != 99 || snap.restored || snap.Meta.Revision != 2 {
				t.Fatalf("manual used restored cell: %+v err=%v calls=%d", snap, err, calls)
			}
		})
	}
}

func TestStartupRefreshDenialRetainsRowsAndErrorMetadata(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	observed := time.Now().Add(-time.Hour)
	cached := Snapshot[int]{restored: true, Items: []int{42}, Meta: p.snapshotMetaHot(observed)}
	cached.Meta.Freshness = FreshnessClassStale
	setNamespacedSnapshot(&store, "app", cached)
	snap, err := executeNamespacedSnapshot(p, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Second, capResource: "pods", capScope: CapabilityScopeNamespace, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
		return nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "", nil)
	}})
	if err != nil || len(snap.Items) != 1 || snap.Items[0] != 42 || snap.Err != nil {
		t.Fatalf("initial restored response=%+v err=%v", snap, err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		snap, _ = peekNamespacedSnapshot(&store, "app")
		if snap.Err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("denial was not published")
		}
		time.Sleep(time.Millisecond)
	}
	if snap.Err.Class != NormalizedErrorClassAccessDenied || len(snap.Items) != 1 || snap.Items[0] != 42 || snap.Meta.Freshness != FreshnessClassStale || !snap.Meta.ObservedAt.Equal(observed) || snap.Meta.Revision != 2 {
		t.Fatalf("denied refresh lost truthful metadata: %+v", snap)
	}
	if serveStartupSnapshot(context.Background(), WorkPriorityCritical, snap, 24*time.Hour) {
		t.Fatal("startup shortcut suppressed access denial")
	}
}

func TestStartupRefreshLifecycle(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	key := workKey{Cluster: "ctx", Class: WorkClassSnapshot, Kind: ResourceKindPods, Namespace: "app"}
	ctx, cancel := context.WithCancel(ContextWithWorkSource(context.Background(), WorkSourceAPI))
	defer cancel()
	started, release := make(chan context.Context, 1), make(chan struct{})
	var calls atomic.Int32
	refresh := func(ctx context.Context) { calls.Add(1); started <- ctx; <-release }
	p.refreshStartupSnapshot(ctx, nil, key, refresh)
	var refreshCtx context.Context
	select {
	case refreshCtx = <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh did not start")
	}
	cancel()
	if refreshCtx.Err() != nil {
		t.Fatal("request cancellation aborted shared refresh")
	}
	if deadline, ok := refreshCtx.Deadline(); !ok || time.Until(deadline) > 30*time.Second {
		t.Fatal("refresh lacks bounded lifetime")
	}
	if workSourceOrAPI(refreshCtx) != WorkSourceAPI {
		t.Fatal("lost source attribution")
	}
	for range 10 {
		p.refreshStartupSnapshot(ctx, nil, key, refresh)
	}
	if calls.Load() != 1 {
		t.Fatal("duplicate refresh")
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		p.startupRefreshMu.Lock()
		remaining := len(p.startupRefreshes)
		p.startupRefreshMu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("refresh reservation leaked")
		}
		time.Sleep(time.Millisecond)
	}
	if refreshCtx.Err() != context.Canceled {
		t.Fatal("completed refresh context not released")
	}
	done := make(chan struct{})
	p.refreshStartupSnapshot(context.Background(), nil, key, func(context.Context) { close(done) })
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("completed refresh prevented retry")
	}
}
