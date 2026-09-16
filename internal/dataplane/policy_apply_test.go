package dataplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type policyCountingPersistence struct {
	snapshotPersistence
	prunes atomic.Int32
	lists  atomic.Int32
}

func (s *policyCountingPersistence) PruneOlderThan(name string, age time.Duration) error {
	s.prunes.Add(1)
	return s.snapshotPersistence.PruneOlderThan(name, age)
}
func (s *policyCountingPersistence) ListSnapshots(name string) ([]persistedSnapshotCell, error) {
	s.lists.Add(1)
	return s.snapshotPersistence.ListSnapshots(name)
}

func TestPolicyNonPersistenceChangeSkipsHydration(t *testing.T) {
	m, gated := startupPlaneManager(t)
	counting := &policyCountingPersistence{snapshotPersistence: gated}
	m.persistence = counting
	m.scheduler = newWorkScheduler(1)
	bundle := m.PolicyBundle()
	bundle.Global.BackgroundBudget.MaxConcurrentPerCluster = 3
	got := m.SetPolicyBundle(bundle)
	if got.Global.BackgroundBudget.MaxConcurrentPerCluster != 3 || m.scheduler.maxPerCluster != 3 {
		t.Fatal("scheduler change not applied")
	}
	if counting.prunes.Load() != 0 || counting.lists.Load() != 0 {
		t.Fatal("scheduler-only change performed persistence IO")
	}
	enabled := !got.Global.Metrics.Enabled
	got.ContextOverrides = map[string]DataplanePolicyOverride{"ready": {Metrics: &MetricsPolicyOverride{Enabled: &enabled}}}
	got = m.SetPolicyBundle(got)
	if m.EffectivePolicy("ready").Metrics.Enabled != enabled {
		t.Fatal("context override not applied")
	}
	if counting.prunes.Load() != 0 {
		t.Fatal("context metrics change pruned persistence")
	}
	// Returned bundle must not alias the manager's mutable policy maps.
	got.Global.Snapshots.TTLSeconds["pods"] = 9999
	if m.Policy().Snapshots.TTLSeconds["pods"] == 9999 {
		t.Fatal("returned bundle aliases manager")
	}
}

func TestPolicyBundleOwnershipAndPersistenceTransition(t *testing.T) {
	for _, boundary := range []string{"input", "set-result", "get-result", "repeat-result"} {
		t.Run(boundary, func(t *testing.T) {
			m, base := startupPlaneManager(t)
			counting := &policyCountingPersistence{snapshotPersistence: base}
			m.persistence = counting
			ttl, age, enabled := 60, 24, true
			input := m.PolicyBundle()
			input.ContextOverrides = map[string]DataplanePolicyOverride{"ready": {
				Snapshots:   &SnapshotPolicyOverride{TTLSeconds: map[string]*int{"pods": &ttl}},
				Persistence: &PersistencePolicyOverride{Enabled: &enabled, MaxAgeHours: &age},
			}}
			returned := m.SetPolicyBundle(input)
			switch boundary {
			case "input":
				returned = input
			case "get-result":
				returned = m.PolicyBundle()
			case "repeat-result":
				returned = m.SetPolicyBundle(returned)
			}
			prunes := counting.prunes.Load()
			ov := returned.ContextOverrides["ready"]
			*ov.Snapshots.TTLSeconds["pods"] = 90
			nodeTTL := 180
			ov.Snapshots.TTLSeconds["nodes"] = &nodeTTL
			*ov.Persistence.MaxAgeHours = 48
			*ov.Persistence.Enabled = false
			before := m.EffectivePolicy("ready")
			if before.Snapshots.TTLSeconds["pods"] != 60 || before.Snapshots.TTLSeconds["nodes"] != 120 || before.Persistence.MaxAgeHours != 24 || !before.Persistence.Enabled {
				t.Error("external mutation changed manager policy without an apply")
			}
			if counting.prunes.Load() != prunes {
				t.Error("external mutation performed persistence IO")
			}
			m.SetPolicyBundle(returned)
			after := m.EffectivePolicy("ready")
			if after.Snapshots.TTLSeconds["pods"] != 90 || after.Snapshots.TTLSeconds["nodes"] != 180 || after.Persistence.MaxAgeHours != 48 || after.Persistence.Enabled {
				t.Error("explicit reapply did not publish edited policy")
			}
			if counting.prunes.Load() <= prunes {
				t.Error("explicit persistence transition was skipped as an equal policy")
			}
		})
	}
}

type policyPruneGate struct {
	snapshotPersistence
	started, release chan struct{}
	once             sync.Once
}

func (s *policyPruneGate) PruneOlderThan(name string, age time.Duration) error {
	if name == "" {
		s.once.Do(func() { close(s.started) })
		<-s.release
	}
	return s.snapshotPersistence.PruneOlderThan(name, age)
}
func TestPolicyMeaningfulTransitionsAreSerialized(t *testing.T) {
	m, base := startupPlaneManager(t)
	gate := &policyPruneGate{snapshotPersistence: base, started: make(chan struct{}), release: make(chan struct{})}
	m.persistence = gate
	m.scheduler = newWorkScheduler(1)
	var release sync.Once
	defer release.Do(func() { close(gate.release) })
	retention := m.PolicyBundle()
	retention.Global.Persistence.MaxAgeHours++
	retention.Global.BackgroundBudget.MaxConcurrentPerCluster = 2
	first := make(chan DataplanePolicyBundle, 1)
	go func() { first <- m.SetPolicyBundle(retention) }()
	startupAwait(t, gate.started)
	disable := CloneDataplanePolicyBundle(retention)
	disable.Global.Persistence.Enabled = false
	disable.Global.BackgroundBudget.MaxConcurrentPerCluster = 3
	second := make(chan DataplanePolicyBundle, 1)
	go func() { second <- m.SetPolicyBundle(disable) }()
	select {
	case <-second:
		t.Fatal("disable overtook pending retention apply")
	case <-time.After(50 * time.Millisecond):
	}
	if !m.Policy().Persistence.Enabled {
		t.Fatal("later policy published before prior apply finished")
	}
	if startupAwait(t, startupLookup(m, context.Background(), "ready")) == nil {
		t.Fatal("apply blocked manager lookups")
	}
	release.Do(func() { close(gate.release) })
	startupAwait(t, first)
	final := startupAwait(t, second)
	if final.Global.Persistence.Enabled || m.currentPersistence() != nil || m.scheduler.maxPerCluster != 3 {
		t.Fatal("final transition not completely applied")
	}
	if !reflect.DeepEqual(m.PolicyBundle(), final) {
		t.Fatal("runtime and returned policy diverged")
	}
}
func TestPolicyPersistenceEnableFailureCanRetry(t *testing.T) {
	dir := t.TempDir()
	blocked := filepath.Join(dir, "not-directory")
	if err := os.WriteFile(blocked, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_CACHE_HOME", blocked)
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	m := NewManager(ManagerConfig{Policy: policy}).(*manager)
	bundle := m.PolicyBundle()
	bundle.Global.Persistence.Enabled = true
	if m.SetPolicyBundle(bundle).Global.Persistence.Enabled {
		t.Fatal("failed open reported enabled")
	}
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if !m.SetPolicyBundle(bundle).Global.Persistence.Enabled || m.currentPersistence() == nil {
		t.Fatal("failed enable could not retry at valid path")
	}
	policy = m.Policy()
	policy.Persistence.Enabled = false
	m.SetPolicy(policy)
	if m.currentPersistence() != nil {
		t.Fatal("disable did not close persistence")
	}
}

// Decode gate deterministically places a live write between hydration's initial
// empty-cell check and publication (the old check-then-set lost that live write).
var policyDecodeStarted, policyDecodeRelease chan struct{}

type policyDecodeItem struct{ Name string }

func (v *policyDecodeItem) UnmarshalJSON(_ []byte) error {
	close(policyDecodeStarted)
	<-policyDecodeRelease
	v.Name = "disk"
	return nil
}
func TestPolicyHydrationDoesNotOverwriteConcurrentLivePublication(t *testing.T) {
	for _, namespaced := range []bool{false, true} {
		t.Run(map[bool]string{false: "cluster", true: "namespaced"}[namespaced], func(t *testing.T) {
			policyDecodeStarted, policyDecodeRelease = make(chan struct{}), make(chan struct{})
			payload, err := json.Marshal(Snapshot[policyDecodeItem]{Items: []policyDecodeItem{{Name: "disk"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}})
			if err != nil {
				t.Fatal(err)
			}
			var cs snapshotStore[Snapshot[policyDecodeItem]]
			ns := newNamespacedSnapshotStore[Snapshot[policyDecodeItem]]()
			done := make(chan error, 1)
			go func() {
				if namespaced {
					done <- hydratePersistedNamespacedSnapshotInto(&ns, "default", payload, time.Hour)
				} else {
					done <- hydratePersistedClusterSnapshotInto(&cs, payload, time.Hour)
				}
			}()
			startupAwait(t, policyDecodeStarted)
			live := Snapshot[policyDecodeItem]{Items: []policyDecodeItem{{Name: "live"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}}
			if namespaced {
				setNamespacedSnapshot(&ns, "default", live)
			} else {
				setClusterSnapshot(&cs, live)
			}
			close(policyDecodeRelease)
			if err := startupAwait(t, done); err != nil {
				t.Fatal(err)
			}
			var got Snapshot[policyDecodeItem]
			if namespaced {
				got, _ = peekNamespacedSnapshot(&ns, "default")
			} else {
				got, _ = peekClusterSnapshot(&cs)
			}
			if len(got.Items) != 1 || got.Items[0].Name != "live" || got.Meta.Revision != 1 || got.restored {
				t.Fatalf("hydration overwrote live publication: %+v", got)
			}
		})
	}
}

func TestPolicyRepeatDoesNotWaitForPrivateInitialization(t *testing.T) {
	m, gated := startupPlaneManager(t)
	counting := &policyCountingPersistence{snapshotPersistence: gated}
	m.persistence = counting
	ready, _ := m.PlaneForCluster(context.Background(), "ready")
	p := ready.(*clusterPlane)
	setNamespacedSnapshot(&p.podsStore, "default", PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "cached"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}})
	slow := startupLookup(m, context.Background(), "slow")
	startupAwait(t, gated.started)
	bundle := m.PolicyBundle()
	// Same normalized input, not just the same Go value.
	bundle.Version = ""
	bundle.ContextOverrides = map[string]DataplanePolicyOverride{}
	prunes, lists := counting.prunes.Load(), counting.lists.Load()
	done := make(chan struct{})
	defer func() { close(gated.release); startupAwait(t, slow); startupAwait(t, done) }()
	begin := time.Now()
	go func() { m.SetPolicyBundle(bundle); close(done) }()
	cached := make(chan bool, 1)
	go func() {
		snap, ok := m.PodsCachedSnapshot("ready", "default")
		cached <- ok && len(snap.Items) == 1 && snap.Items[0].Name == "cached"
	}()
	if !startupAwait(t, cached) {
		t.Fatal("ready cached Pods unavailable")
	}
	select {
	case <-done:
		t.Logf("normalized repeat applied in %s with private initialization gated", time.Since(begin))
	case <-time.After(250 * time.Millisecond):
		t.Errorf("repeat policy blocked on unrelated private initialization for %s", time.Since(begin))
	}
	if counting.prunes.Load() != prunes || counting.lists.Load() != lists {
		t.Errorf("repeat performed persistence IO: prunes %d -> %d, lists %d -> %d", prunes, counting.prunes.Load(), lists, counting.lists.Load())
	}
}
