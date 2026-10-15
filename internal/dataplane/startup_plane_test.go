package dataplane

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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
	namespace  string
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
func (s *startupGatedPersistence) Load(name string, kind ResourceKind, namespace string, into any) (bool, error) {
	// Capture disk bytes before the gate so tests exercise genuinely stale reads.
	ok, err := s.snapshotPersistence.Load(name, kind, namespace, into)
	if s.namespace == "" || namespace == s.namespace {
		s.gate(name, false)
	}
	if s.fail {
		return false, errors.New("unreadable cache")
	}
	return ok, err
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
	gated := &startupGatedPersistence{snapshotPersistence: sp, started: make(chan struct{}), release: make(chan struct{})}
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	m := &manager{planes: map[string]*clusterPlane{}, persistence: gated, bundle: DataplanePolicyBundle{Global: policy}, policy: policy, signalHistory: map[string]map[string]SignalHistoryRecord{}}
	t.Cleanup(func() { m.ClosePodsLive(); _ = sp.Close() })
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
func demandRestore(p *clusterPlane, kind ResourceKind, ns string) <-chan error {
	done := make(chan error, 1)
	go func() { done <- p.restoreSnapshotCell(context.Background(), kind, ns, true) }()
	return done
}
func seedDemandPods(t *testing.T, sp snapshotPersistence, cluster, ns string) {
	t.Helper()
	err := sp.Save(cluster, ResourceKindPods, ns, PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "disk", Namespace: ns}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC(), Coverage: CoverageClassFull, Completeness: CompletenessClassComplete}})
	if err != nil {
		t.Fatal(err)
	}
}
func TestStartupPlaneDemandIndependentAndCoalesced(t *testing.T) {
	m, gated := startupPlaneManager(t)
	seedDemandPods(t, gated, "slow", "app")
	seedDemandPods(t, gated, "ready", "app")
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	if gated.calls.Load() != 0 {
		t.Fatal("plane creation touched disk")
	}
	leader := demandRestore(p, ResourceKindPods, "app")
	startupAwait(t, gated.started)
	var release sync.Once
	defer release.Do(func() { close(gated.release) })
	followers := make([]<-chan error, 24)
	for i := range followers {
		followers[i] = demandRestore(p, ResourceKindPods, "app")
	}
	if startupAwait(t, startupLookup(m, context.Background(), "slow")) != p {
		t.Fatal("identity changed")
	}
	ready := startupAwait(t, startupLookup(m, context.Background(), "ready")).(*clusterPlane)
	if err := startupAwait(t, demandRestore(ready, ResourceKindPods, "app")); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.PodsCachedSnapshot("slow", "app"); ok {
		t.Fatal("unloaded cell claimed coverage")
	}
	if snap, ok := m.PodsCachedSnapshot("ready", "app"); !ok || snap.Items[0].Name != "disk" {
		t.Fatal("other context blocked")
	}
	release.Do(func() { close(gated.release) })
	if err := startupAwait(t, leader); err != nil {
		t.Fatal(err)
	}
	for _, f := range followers {
		if err := startupAwait(t, f); err != nil {
			t.Fatal(err)
		}
	}
	if gated.calls.Load() != 1 {
		t.Fatalf("loads=%d", gated.calls.Load())
	}
}
func TestStartupDemandCannotResurrectOrOverwrite(t *testing.T) {
	for _, action := range []string{"publish", "clear", "disable", "shutdown"} {
		t.Run(action, func(t *testing.T) {
			m, gated := startupPlaneManager(t)
			seedDemandPods(t, gated, "slow", "app")
			p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
			done := demandRestore(p, ResourceKindPods, "app")
			startupAwait(t, gated.started)
			switch action {
			case "publish":
				setNamespacedSnapshot(&p.podsStore, "app", PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "live"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}})
			case "clear":
				clearNamespacedSnapshot(&p.podsStore, "app")
			case "disable":
				policy := m.Policy()
				policy.Persistence.Enabled = false
				if err := m.configurePersistence(policy); err != nil {
					t.Fatal(err)
				}
			case "shutdown":
				m.ClosePodsLive()
			}
			close(gated.release)
			startupAwait(t, done)
			snap, ok := m.PodsCachedSnapshot("slow", "app")
			if action == "publish" {
				if !ok || snap.Items[0].Name != "live" || snap.Meta.Revision != 1 {
					t.Fatalf("overwritten: %+v", snap)
				}
			} else if ok {
				t.Fatal("late disk data published")
			}
		})
	}
}
func TestStartupDemandErrorsRetry(t *testing.T) {
	m, gated := startupPlaneManager(t)
	seedDemandPods(t, gated, "slow", "app")
	gated.fail = true
	close(gated.release)
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	if err := p.restoreSnapshotCell(context.Background(), ResourceKindPods, "app", true); err == nil {
		t.Fatal("expected error")
	}
	gated.fail = false
	if err := p.restoreSnapshotCell(context.Background(), ResourceKindPods, "app", true); err != nil {
		t.Fatal(err)
	}
	if gated.calls.Load() != 2 {
		t.Fatal("failed load memoized")
	}
}
func TestStartupDemandPanicReleasesWaiters(t *testing.T) {
	m, gated := startupPlaneManager(t)
	gated.panicFirst = true
	close(gated.release)
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected panic")
			}
		}()
		_ = p.restoreSnapshotCell(context.Background(), ResourceKindPods, "app", true)
	}()
	if err := p.restoreSnapshotCell(context.Background(), ResourceKindPods, "app", true); err != nil {
		t.Fatal(err)
	}
	if gated.calls.Load() != 2 {
		t.Fatal("panic retained in-flight reservation")
	}
}

func TestSnapshotKeyPagingAndBackground(t *testing.T) {
	m, gated := startupPlaneManager(t)
	sp := gated.snapshotPersistence
	for _, ns := range []string{"a", "b", "c"} {
		seedDemandPods(t, sp, "ctx", ns)
	}
	seedDemandPods(t, sp, "ctx-other", "outside")
	pager := sp.(snapshotKeyPager)
	var after []byte
	count := 0
	for {
		cells, next, err := pager.SnapshotKeysPage("ctx", after, 1)
		if err != nil {
			t.Fatal(err)
		}
		if len(cells) > 1 {
			t.Fatal("unbounded page")
		}
		for _, cell := range cells {
			if len(cell.Payload) != 0 {
				t.Fatal("page copied payload")
			}
			count++
		}
		if next == nil {
			break
		}
		after = next
	}
	if count != 3 {
		t.Fatalf("keys=%d", count)
	}
	m.persistenceMu.Lock()
	m.persistence = sp
	m.persistenceMu.Unlock()
	m.hydrationDemand.Add(1)
	p := startupAwait(t, startupLookup(m, context.Background(), "ctx")).(*clusterPlane)
	if !p.persistHydrating.Load() {
		t.Fatal("pending coverage missing")
	}
	time.Sleep(30 * time.Millisecond)
	if _, ok := m.PodsCachedSnapshot("ctx", "a"); ok {
		t.Fatal("background did not yield")
	}
	m.hydrationDemand.Add(-1)
	deadline := time.Now().Add(time.Second)
	for p.persistHydrating.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if p.persistHydrating.Load() {
		t.Fatal("background incomplete")
	}
	for _, ns := range []string{"a", "b", "c"} {
		if _, ok := m.PodsCachedSnapshot("ctx", ns); !ok {
			t.Fatalf("missing %s", ns)
		}
	}
}
