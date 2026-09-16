package dataplane

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type startupGatedPersistence struct {
	snapshotPersistence
	started    chan struct{}
	release    chan struct{}
	once       sync.Once
	calls      atomic.Int32
	history    bool
	fail       bool
	panicFirst bool
}

func (s *startupGatedPersistence) gate(name string, history bool) {
	if name != "slow" || history != s.history {
		return
	}
	n := s.calls.Add(1)
	s.once.Do(func() { close(s.started) })
	<-s.release
	if s.panicFirst && n == 1 {
		panic("startup persistence panic")
	}
}
func (s *startupGatedPersistence) PruneOlderThan(name string, age time.Duration) error {
	s.gate(name, false)
	if name == "slow" && s.fail {
		return errors.New("unreadable cache")
	}
	return s.snapshotPersistence.PruneOlderThan(name, age)
}
func (s *startupGatedPersistence) LoadSignalHistory(name string) (map[string]SignalHistoryRecord, error) {
	s.gate(name, true)
	return s.snapshotPersistence.LoadSignalHistory(name)
}
func startupPlaneManager(t *testing.T) (*manager, *startupGatedPersistence) {
	t.Helper()
	sp, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sp.Close() })
	gated := &startupGatedPersistence{snapshotPersistence: sp, started: make(chan struct{}), release: make(chan struct{})}
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	m := &manager{planes: map[string]*clusterPlane{}, persistence: gated, bundle: DataplanePolicyBundle{Global: policy}, policy: policy, signalHistory: map[string]map[string]SignalHistoryRecord{}}
	return m, gated
}
func startupAwait[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(3 * time.Second):
		t.Fatal("startup operation did not finish")
	}
	var zero T
	return zero
}
func startupLookup(m *manager, ctx context.Context, name string) <-chan ClusterPlane {
	done := make(chan ClusterPlane, 1)
	go func() { p, _ := m.PlaneForCluster(ctx, name); done <- p }()
	return done
}
func TestStartupPlaneHydrationDoesNotLockOtherContexts(t *testing.T) {
	m, gated := startupPlaneManager(t)
	ready, err := m.PlaneForCluster(context.Background(), "ready")
	if err != nil {
		t.Fatal(err)
	}
	slowDone := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	defer func() { close(gated.release); startupAwait(t, slowDone) }()
	begin := time.Now()
	select {
	case got := <-startupLookup(m, context.Background(), "ready"):
		if got != ready {
			t.Fatal("plane identity changed")
		}
		t.Logf("existing context lookup %s while unrelated hydration gated", time.Since(begin))
	case <-time.After(250 * time.Millisecond):
		t.Fatal("existing foreground plane blocked by unrelated disk hydration")
	}
	// Names are exact identities, not trimmed or case-folded aliases.
	for _, name := range []string{"Slow", " slow"} {
		p := startupAwait(t, startupLookup(m, context.Background(), name))
		if p.ClusterName() != name || p.Scope().ClusterName != name {
			t.Fatalf("context identity changed: %q", name)
		}
	}
}
func TestStartupPlaneCoalescesUntilSnapshotsAndHistoryReady(t *testing.T) {
	for _, history := range []bool{false, true} {
		name := "snapshots"
		if history {
			name = "history"
		}
		t.Run(name, func(t *testing.T) {
			m, gated := startupPlaneManager(t)
			gated.history = history
			snap := NamespaceSnapshot{Items: []dto.NamespaceListItemDTO{{Name: "persisted"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}}
			if err := gated.Save("slow", ResourceKindNamespaces, "", snap); err != nil {
				t.Fatal(err)
			}
			rec := SignalHistoryRecord{FirstSeenAt: time.Now().Unix(), LastSeenAt: time.Now().Unix(), SeenCount: 7}
			if err := gated.UpsertSignalHistory("slow", map[string]SignalHistoryRecord{"saved": rec}); err != nil {
				t.Fatal(err)
			}
			leader := startupLookup(m, context.Background(), "slow")
			startupAwait(t, gated.started)
			var release sync.Once
			defer release.Do(func() { close(gated.release) })
			const followers = 24
			results := make([]<-chan ClusterPlane, 0, followers)
			canceled, cancel := context.WithCancel(context.Background())
			cancel()
			for range followers {
				results = append(results, startupLookup(m, canceled, "slow"))
			}
			m.mu.RLock()
			unpublished := m.planes["slow"] == nil
			reservation := m.planeInit["slow"]
			m.mu.RUnlock()
			if !unpublished || reservation == nil {
				t.Fatal("partially initialized plane published")
			}
			if _, ok := m.PodsCachedSnapshot("slow", "default"); ok {
				t.Fatal("cache-only reader saw private plane")
			}
			for _, result := range results {
				select {
				case <-result:
					t.Fatal("caller returned before hydration/history completed")
				default:
				}
			}
			release.Do(func() { close(gated.release) })
			want := startupAwait(t, leader)
			for _, result := range results {
				if got := startupAwait(t, result); got != want {
					t.Fatal("duplicate plane initialized")
				}
			}
			startupAwait(t, reservation)
			if gated.calls.Load() != 1 {
				t.Fatalf("initializations = %d", gated.calls.Load())
			}
			p := want.(*clusterPlane)
			got, ok := peekClusterSnapshot(&p.nsStore)
			if !ok || len(got.Items) != 1 || got.Items[0].Name != "persisted" {
				t.Fatalf("snapshot not hydrated: %+v", got)
			}
			m.signalHistoryMu.RLock()
			loaded := m.signalHistory["slow"]["saved"]
			m.signalHistoryMu.RUnlock()
			if loaded.SeenCount != rec.SeenCount {
				t.Fatalf("history not ready: %+v", loaded)
			}
			m.mu.RLock()
			remaining := len(m.planeInit)
			m.mu.RUnlock()
			if remaining != 0 {
				t.Fatal("initialization reservation leaked")
			}
		})
	}
}
func TestStartupPlanePersistenceFailureReleasesWaiters(t *testing.T) {
	m, gated := startupPlaneManager(t)
	gated.fail = true
	leader := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	follower := startupLookup(m, context.Background(), "slow")
	close(gated.release)
	p := startupAwait(t, leader)
	if p == nil || startupAwait(t, follower) != p {
		t.Fatal("best-effort persistence failure lost plane")
	}
	if gated.calls.Load() != 1 {
		t.Fatal("persistence failure duplicated initialization")
	}
}
func TestStartupPlanePanicReleasesReservationWithoutPublication(t *testing.T) {
	m, gated := startupPlaneManager(t)
	gated.panicFirst = true
	recovered := make(chan any, 1)
	go func() {
		defer func() { recovered <- recover() }()
		_, _ = m.PlaneForCluster(context.Background(), "slow")
	}()
	startupAwait(t, gated.started)
	m.mu.RLock()
	reservation := m.planeInit["slow"]
	m.mu.RUnlock()
	close(gated.release)
	if startupAwait(t, recovered) != "startup persistence panic" {
		t.Fatal("panic was swallowed or changed")
	}
	startupAwait(t, reservation)
	m.mu.RLock()
	unpublished := m.planes["slow"] == nil && m.planeInit["slow"] == nil
	m.mu.RUnlock()
	if !unpublished {
		t.Fatal("panic published plane or leaked reservation")
	}
	if startupAwait(t, startupLookup(m, context.Background(), "slow")) == nil {
		t.Fatal("retry failed")
	}
	if gated.calls.Load() != 2 {
		t.Fatal("retry did not initialize exactly once")
	}
}
func TestStartupPlaneClosePodsLiveDoesNotWaitForHydration(t *testing.T) {
	m, gated := startupPlaneManager(t)
	leader := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	defer func() { close(gated.release); startupAwait(t, leader) }()
	closed := make(chan struct{})
	go func() { m.ClosePodsLive(); close(closed) }()
	startupAwait(t, closed)
	m.liveMu.Lock()
	stopped := m.liveClosed && m.liveCells == 0 && m.liveSubscribers == 0
	m.liveMu.Unlock()
	if !stopped {
		t.Fatal("Live shutdown failed during plane initialization")
	}
}
func TestStartupPlaneCloseRejectsLateLiveSubscription(t *testing.T) {
	m, gated := startupPlaneManager(t)
	// No Kubernetes client: reaching a worker would be a test failure, not a live call.
	m.clients = liveTestClients{c: &cluster.Clients{}}
	result := make(chan error, 1)
	go func() {
		sub, err := m.SubscribePods(context.Background(), "slow", "default")
		if sub != nil {
			sub.Close()
		}
		result <- err
	}()
	startupAwait(t, gated.started)
	var release sync.Once
	defer release.Do(func() { close(gated.release) })
	closed := make(chan struct{})
	go func() { m.ClosePodsLive(); close(closed) }()
	startupAwait(t, closed)
	release.Do(func() { close(gated.release) })
	if err := startupAwait(t, result); !errors.Is(err, ErrPodLiveUnavailable) {
		t.Fatalf("late subscription error = %v", err)
	}
	m.liveMu.Lock()
	cells, subscribers := m.liveCells, m.liveSubscribers
	m.liveMu.Unlock()
	if cells != 0 || subscribers != 0 {
		t.Fatal("Live worker admitted after shutdown")
	}
}

func TestStartupPlanePolicyHydrationIncludesPrivateInitializations(t *testing.T) {
	m, gated := startupPlaneManager(t)
	leader := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	var release sync.Once
	defer release.Do(func() { close(gated.release) })
	done := make(chan struct{})
	go func() { m.hydratePersistedPlanes(m.Policy()); close(done) }()
	select {
	case <-done:
		t.Fatal("policy hydration skipped initializing plane")
	case <-time.After(50 * time.Millisecond):
	}
	// The policy waiter must not prevent unrelated foreground publication.
	if startupAwait(t, startupLookup(m, context.Background(), "ready")) == nil {
		t.Fatal("policy hydration locked foreground lookup")
	}
	release.Do(func() { close(gated.release) })
	startupAwait(t, leader)
	startupAwait(t, done)
	if gated.calls.Load() != 2 {
		t.Fatalf("policy hydration missed newly published plane: passes = %d", gated.calls.Load())
	}
}

func TestStartupPlanePersistenceDisableDuringHydration(t *testing.T) {
	m, gated := startupPlaneManager(t)
	leader := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	defer func() { close(gated.release); startupAwait(t, leader) }()
	done := make(chan error, 1)
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	go func() { done <- m.configurePersistence(policy) }()
	if err := startupAwait(t, done); err != nil {
		t.Fatal(err)
	}
	if m.currentPersistence() != nil {
		t.Fatal("persistence not disabled")
	}
}
