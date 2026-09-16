package dataplane

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

func waitPodInitialRefresh(t *testing.T, p *clusterPlane) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		p.startupRefreshMu.Lock()
		remaining := len(p.startupRefreshes)
		p.startupRefreshMu.Unlock()
		if remaining == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("refresh reservation leaked")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestPodInitialRuntimeSnapshotDoesNotWaitForSource(t *testing.T) {
	for _, staleWithinTTL := range []bool{false, true} {
		name := "expiredTTL"
		if staleWithinTTL {
			name = "staleWithinTTL"
		}
		t.Run(name, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			scheduler := newWorkScheduler(1)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			observed := time.Now().Add(-time.Minute)
			original := Snapshot[int]{Items: []int{42}, Meta: p.snapshotMetaHot(observed)}
			ttl := time.Second
			if staleWithinTTL {
				ttl = time.Hour
				original.Meta.Freshness = FreshnessClassStale
			}
			setNamespacedSnapshot(&store, "app", original)
			started, release := make(chan context.Context, 1), make(chan struct{})
			released := false
			defer func() {
				if !released {
					close(release)
				}
			}()
			var calls atomic.Int32
			desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: ttl, fetch: func(ctx context.Context, _ *cluster.Clients, _ string) ([]int, error) {
				calls.Add(1)
				started <- ctx
				select {
				case <-release:
					return []int{99}, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}}
			ctx, cancel := context.WithCancel(WithPodInitialRead(context.Background()))
			defer cancel()
			run := func() (Snapshot[int], error) {
				return executeNamespacedSnapshot(p, ctx, scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
			}
			result := make(chan snapshotExecResult, 1)
			go func() { snap, err := run(); result <- snapshotExecResult{snap, err} }()
			select {
			case got := <-result:
				if got.err != nil || len(got.snap.Items) != 1 || got.snap.Items[0] != 42 || got.snap.Meta.Freshness != FreshnessClassStale || !got.snap.Meta.ObservedAt.Equal(observed) || got.snap.Meta.Revision != 1 || got.snap.restored {
					t.Fatalf("cache result: %+v %v", got.snap, got.err)
				}
			case <-time.After(250 * time.Millisecond):
				t.Fatal("initial runtime rows blocked behind live source")
			}
			var refreshCtx context.Context
			select {
			case refreshCtx = <-started:
			case <-time.After(time.Second):
				t.Fatal("refresh not started")
			}
			deadline, ok := refreshCtx.Deadline()
			if !ok || time.Until(deadline) > 30*time.Second || time.Until(deadline) < 25*time.Second {
				t.Fatalf("unbounded refresh deadline: %v %v", deadline, ok)
			}
			for i := 0; i < 10; i++ {
				snap, err := run()
				if err != nil || snap.Meta.Revision != 1 {
					t.Fatalf("repeat: %+v %v", snap, err)
				}
			}
			cancel()
			if refreshCtx.Err() != nil {
				t.Fatal("request cancellation canceled detached refresh")
			}
			if calls.Load() != 1 {
				t.Fatalf("source calls=%d", calls.Load())
			}
			close(release)
			released = true
			waitPodInitialRefresh(t, p)
			if refreshCtx.Err() != context.Canceled {
				t.Fatalf("completed refresh context=%v", refreshCtx.Err())
			}
			snap, _ := store.getCached("app")
			if snap.Meta.Revision != 2 || snap.Items[0] != 99 || snap.Meta.Freshness != FreshnessClassHot || !snap.Meta.ObservedAt.After(observed) {
				t.Fatalf("refresh did not publish: %+v", snap)
			}
			// A future normal manual refresh still owns and advances this cell.
			desc.fetch = func(context.Context, *cluster.Clients, string) ([]int, error) { return []int{100}, nil }
			snap, err := executeNamespacedSnapshot(p, WithPodManualRefresh(context.Background()), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
			if err != nil || snap.Meta.Revision != 3 || snap.Items[0] != 100 {
				t.Fatalf("future refresh: %+v %v", snap, err)
			}
		})
	}
}

func TestPodInitialSnapshotEligibility(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	valid := Snapshot[int]{Items: []int{42}, Meta: p.snapshotMetaHot(time.Now().Add(-time.Minute))}
	initial := WithPodInitialRead(context.Background())
	canceled, cancel := context.WithCancel(initial)
	cancel()
	for _, tc := range []struct {
		name     string
		mutate   func(*Snapshot[int])
		ctx      context.Context
		priority WorkPriority
		want     bool
	}{
		{name: "retained", want: true},
		{name: "emptySuccessfulList", mutate: func(s *Snapshot[int]) { s.Items = nil }, want: true},
		{name: "error", mutate: func(s *Snapshot[int]) { s.Err = &NormalizedError{} }},
		{name: "denied", mutate: func(s *Snapshot[int]) { s.Err = &NormalizedError{Class: NormalizedErrorClassAccessDenied} }},
		{name: "expired", mutate: func(s *Snapshot[int]) { s.Meta.ObservedAt = time.Now().Add(-2 * time.Hour) }},
		{name: "missing", mutate: func(s *Snapshot[int]) { s.Meta.ObservedAt = time.Time{} }},
		{name: "unknown", mutate: func(s *Snapshot[int]) { s.Meta.Coverage = CoverageClassUnknown }},
		{name: "restored", mutate: func(s *Snapshot[int]) { s.restored = true }},
		{name: "auto", ctx: context.Background()},
		{name: "manual", ctx: WithPodManualRefresh(initial)},
		{name: "cancelled", ctx: canceled},
		{name: "projection", ctx: ContextWithWorkSource(initial, WorkSourceProjection)},
		{name: "background", priority: WorkPriorityLow},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snap := valid
			if tc.mutate != nil {
				tc.mutate(&snap)
			}
			ctx := tc.ctx
			if ctx == nil {
				ctx = initial
			}
			priority := WorkPriorityCritical
			if tc.name == "background" {
				priority = tc.priority
			}
			if got := servePodInitialSnapshot(ctx, priority, snap, time.Hour); got != tc.want {
				t.Fatalf("eligible=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestPodInitialRejectedCellsAndOtherIntentsWaitForSource(t *testing.T) {
	for _, name := range []string{"missing", "namespaceMismatch", "contextMismatch", "expired", "denied", "error", "auto", "manual"} {
		t.Run(name, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			snap := Snapshot[int]{Items: []int{42}, Meta: p.snapshotMetaHot(time.Now().Add(-time.Minute))}
			snap.Meta.Freshness = FreshnessClassStale
			ns := "app"
			switch name {
			case "expired":
				snap.Meta.ObservedAt = time.Now().Add(-p.currentPolicy().PersistenceMaxAge() - time.Hour)
			case "denied":
				snap.Err = &NormalizedError{Class: NormalizedErrorClassAccessDenied}
			case "error":
				snap.Err = &NormalizedError{}
			case "namespaceMismatch":
				ns = "other"
			}
			if name != "missing" && name != "contextMismatch" {
				setNamespacedSnapshot(&store, ns, snap)
			}
			if name == "contextMismatch" {
				other := newClusterPlane("other", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
				setNamespacedSnapshot(&other.podsStore, "app", PodsSnapshot{Meta: snap.Meta})
			}
			ctx := WithPodInitialRead(context.Background())
			if name == "auto" {
				ctx = context.Background()
			}
			if name == "manual" {
				ctx = WithPodManualRefresh(ctx)
			}
			started, release := make(chan struct{}), make(chan struct{})
			defer close(release)
			ctx, cancel := context.WithTimeout(ctx, time.Second)
			defer cancel()
			result := make(chan snapshotExecResult, 1)
			go func() {
				s, e := executeNamespacedSnapshot(p, ctx, newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Hour, fetch: func(ctx context.Context, _ *cluster.Clients, ns string) ([]int, error) {
					close(started)
					select {
					case <-release:
						return []int{99}, nil
					case <-ctx.Done():
						return nil, ctx.Err()
					}
				}})
				result <- snapshotExecResult{s, e}
			}()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("source not started")
			}
			select {
			case got := <-result:
				t.Fatalf("unusable/other intent returned before source: %+v", got)
			default:
			}
			cancel()
			select {
			case <-result:
			case <-time.After(time.Second):
				t.Fatal("request did not stop")
			}
		})
	}
}

func TestPodInitialRefreshErrorReleasesReservation(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	observed := time.Now().Add(-time.Minute)
	setNamespacedSnapshot(&store, "app", Snapshot[int]{Items: []int{42}, Meta: p.snapshotMetaHot(observed)})
	started := make(chan context.Context, 1)
	desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, ttl: time.Second, fetch: func(ctx context.Context, _ *cluster.Clients, _ string) ([]int, error) {
		started <- ctx
		return nil, errors.New("source unavailable")
	}}
	scheduler := newWorkScheduler(1)
	_, err := executeNamespacedSnapshot(p, WithPodInitialRead(context.Background()), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
	if err != nil {
		t.Fatal(err)
	}
	var refreshCtx context.Context
	select {
	case refreshCtx = <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh not started")
	}
	waitPodInitialRefresh(t, p)
	if refreshCtx.Err() != context.Canceled {
		t.Fatal("error refresh context not canceled")
	}
	snap, _ := store.getCached("app")
	if snap.Err == nil || snap.Items[0] != 42 || snap.Meta.Freshness != FreshnessClassStale || !snap.Meta.ObservedAt.Equal(observed) {
		t.Fatalf("error lost rows/metadata: %+v", snap)
	}
	desc.fetch = func(context.Context, *cluster.Clients, string) ([]int, error) { return []int{99}, nil }
	snap, err = executeNamespacedSnapshot(p, WithPodInitialRead(context.Background()), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
	if err != nil || snap.Err != nil || snap.Items[0] != 99 || snap.Meta.Revision != 3 {
		t.Fatalf("retry: %+v %v", snap, err)
	}
}
