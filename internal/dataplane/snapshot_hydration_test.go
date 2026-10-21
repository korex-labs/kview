package dataplane

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	bolt "go.etcd.io/bbolt"
)

func TestStartupDemandIndependentCellsSameContext(t *testing.T) {
	m, gated := startupPlaneManager(t)
	gated.namespace = "blocked"
	seedDemandPods(t, gated, "slow", "blocked")
	seedDemandPods(t, gated, "slow", "ready")
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	blocked := demandRestore(p, ResourceKindPods, "blocked")
	startupAwait(t, gated.started)
	defer close(gated.release)
	if err := startupAwait(t, demandRestore(p, ResourceKindPods, "ready")); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.PodsCachedSnapshot("slow", "ready"); !ok {
		t.Fatal("independent cell blocked")
	}
	select {
	case <-blocked:
		t.Fatal("gate not held")
	default:
	}
}

func TestStartupDemandClusterClear(t *testing.T) {
	m, gated := startupPlaneManager(t)
	if err := gated.Save("slow", ResourceKindNamespaces, "", NamespaceSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Now()}}); err != nil {
		t.Fatal(err)
	}
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	done := demandRestore(p, ResourceKindNamespaces, "")
	startupAwait(t, gated.started)
	clearClusterSnapshot(&p.nsStore)
	close(gated.release)
	if err := startupAwait(t, done); err != nil {
		t.Fatal(err)
	}
	if snap, ok := peekClusterSnapshot(&p.nsStore); ok || snap.Meta.Revision != 0 {
		t.Fatalf("resurrected: %+v", snap)
	}
	if p.nsStore.rev != 1 {
		t.Fatal("clear revision lost")
	}
}

func TestStartupDemandExpiryCorruptAndMissing(t *testing.T) {
	m, gated := startupPlaneManager(t)
	sp := gated.snapshotPersistence.(*boltSnapshotPersistence)
	if err := sp.Save("ctx", ResourceKindPods, "expired", PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Now().Add(-365 * 24 * time.Hour)}}); err != nil {
		t.Fatal(err)
	}
	if err := sp.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(dataplaneSnapshotBucket).Put(snapshotKey("ctx", ResourceKindPods, "corrupt"), []byte("{"))
	}); err != nil {
		t.Fatal(err)
	}
	seedDemandPods(t, sp, "ctx", "ready")
	p := startupAwait(t, startupLookup(m, context.Background(), "ctx")).(*clusterPlane)
	for _, ns := range []string{"expired", "missing", "corrupt", "ready"} {
		err := startupAwait(t, demandRestore(p, ResourceKindPods, ns))
		if (err != nil) != (ns == "corrupt") {
			t.Fatalf("%s error: %v", ns, err)
		}
		if _, ok := m.PodsCachedSnapshot("ctx", ns); ok != (ns == "ready") {
			t.Fatalf("%s coverage=%v", ns, ok)
		}
	}
	seedDemandPods(t, sp, "ctx", "corrupt")
	if err := startupAwait(t, demandRestore(p, ResourceKindPods, "corrupt")); err != nil {
		t.Fatal(err)
	}
}

type backgroundTestPersistence struct {
	snapshotPersistence
	started  chan struct{}
	release  chan struct{}
	pageFail bool
	calls    atomic.Int32
}

func (s *backgroundTestPersistence) SnapshotKeysPage(c string, after []byte, n int) ([]persistedSnapshotCell, []byte, error) {
	if s.calls.Add(1) == 1 && s.started != nil {
		close(s.started)
		<-s.release
	}
	if s.pageFail {
		return nil, nil, errors.New("page failed")
	}
	return s.snapshotPersistence.(snapshotKeyPager).SnapshotKeysPage(c, after, n)
}
func (s *backgroundTestPersistence) LoadBounded(c string, k ResourceKind, ns string, into any, max int) (bool, error) {
	return s.snapshotPersistence.(boundedSnapshotLoader).LoadBounded(c, k, ns, into, max)
}
func awaitHydrationWorker(t *testing.T, m *manager) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m.snapshotHydration.mu.Lock()
		running := m.snapshotHydration.running
		m.snapshotHydration.mu.Unlock()
		if !running {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("hydration worker did not stop")
}
func TestSnapshotHydrationBackgroundShutdown(t *testing.T) {
	m, gated := startupPlaneManager(t)
	sp := &backgroundTestPersistence{snapshotPersistence: gated.snapshotPersistence, started: make(chan struct{}), release: make(chan struct{})}
	seedDemandPods(t, sp, "ctx", "app")
	m.persistence = sp
	p := startupAwait(t, startupLookup(m, context.Background(), "ctx")).(*clusterPlane)
	startupAwait(t, sp.started)
	m.ClosePodsLive()
	close(sp.release)
	awaitHydrationWorker(t, m)
	if _, ok := m.PodsCachedSnapshot("ctx", "app"); ok {
		t.Fatal("published after shutdown")
	}
	if p.persistHydrating.Load() {
		t.Fatal("pending worker after close")
	}
}
func TestSnapshotHydrationBackgroundFailuresAndBudget(t *testing.T) {
	for _, mode := range []string{"page", "corrupt", "budget"} {
		t.Run(mode, func(t *testing.T) {
			m, gated := startupPlaneManager(t)
			raw := gated.snapshotPersistence.(*boltSnapshotPersistence)
			sp := &backgroundTestPersistence{snapshotPersistence: raw, pageFail: mode == "page"}
			seedDemandPods(t, sp, "ctx", "z-ready")
			switch mode {
			case "corrupt":
				if err := raw.db.Update(func(tx *bolt.Tx) error {
					return tx.Bucket(dataplaneSnapshotBucket).Put(snapshotKey("ctx", ResourceKindPods, "a-bad"), []byte("{"))
				}); err != nil {
					t.Fatal(err)
				}
			case "budget":
				if err := sp.Save("ctx", ResourceKindPods, "a-bad", PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "oversized", Node: strings.Repeat("x", snapshotHydrationByteBudget)}}, Meta: SnapshotMetadata{ObservedAt: time.Now()}}); err != nil {
					t.Fatal(err)
				}
			}
			m.persistence = sp
			p := startupAwait(t, startupLookup(m, context.Background(), "ctx")).(*clusterPlane)
			awaitHydrationWorker(t, m)
			if !p.persistHydrationPartial.Load() || p.persistHydrating.Load() {
				t.Fatal("failure claimed complete or kept retrying")
			}
			if mode == "page" {
				if sp.calls.Load() != 3 {
					t.Fatalf("attempts=%d", sp.calls.Load())
				}
				return
			}
			if _, ok := m.PodsCachedSnapshot("ctx", "z-ready"); !ok {
				t.Fatal("bad cell blocked healthy cell")
			}
			if _, ok := m.PodsCachedSnapshot("ctx", "a-bad"); ok {
				t.Fatal("bad/oversized cell published")
			}
			if mode == "budget" {
				// This decodes an intentionally oversized payload under -race;
				// use the package test deadline, not the small gated-I/O helper.
				if err := p.restoreSnapshotCell(context.Background(), ResourceKindPods, "a-bad", true); err != nil {
					t.Fatal(err)
				}
				if _, ok := m.PodsCachedSnapshot("ctx", "a-bad"); !ok {
					t.Fatal("budget skip memoized as absence")
				}
			}
		})
	}
}

func TestStartupDemandDisableReenableEpoch(t *testing.T) {
	m, gated := startupPlaneManager(t)
	seedDemandPods(t, gated, "slow", "app")
	p := startupAwait(t, startupLookup(m, context.Background(), "slow")).(*clusterPlane)
	old := demandRestore(p, ResourceKindPods, "app")
	startupAwait(t, gated.started)
	disabled := false
	bundle := m.PolicyBundle()
	bundle.ContextOverrides = map[string]DataplanePolicyOverride{"slow": {Persistence: &PersistencePolicyOverride{Enabled: &disabled}}}
	m.SetPolicyBundle(bundle)
	bundle.ContextOverrides = nil
	m.SetPolicyBundle(bundle)
	close(gated.release)
	// The retired restore may complete or be canceled; only publication matters.
	_ = startupAwait(t, old)
	if _, ok := m.PodsCachedSnapshot("slow", "app"); ok {
		t.Fatal("old epoch published after re-enable")
	}
	if err := startupAwait(t, demandRestore(p, ResourceKindPods, "app")); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.PodsCachedSnapshot("slow", "app"); !ok {
		t.Fatal("new epoch could not restore")
	}
}
