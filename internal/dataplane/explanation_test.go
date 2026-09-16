package dataplane

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type panicExplanationClientsProvider struct{}

func (panicExplanationClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	panic("dataplane explanation accessed the Kubernetes client provider")
}

func newExplanationTestManager(t *testing.T) *manager {
	t.Helper()
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	m, ok := NewManager(ManagerConfig{Policy: policy}).(*manager)
	if !ok {
		t.Fatal("NewManager did not return the concrete manager")
	}
	m.clients = panicExplanationClientsProvider{}
	return m
}

func addExplanationTestPlane(m *manager, contextName string) *clusterPlane {
	plane := newClusterPlane(contextName, ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy {
		return m.EffectivePolicy(contextName)
	}, m.currentPersistence, m.stats)
	m.mu.Lock()
	m.planes[contextName] = plane
	m.mu.Unlock()
	return plane
}

func TestDataplaneExplanationAbsentPlaneIsCacheOnly(t *testing.T) {
	m := newExplanationTestManager(t)

	got := m.DataplaneExplanation("missing-context")

	if got.Loaded {
		t.Fatalf("loaded = true, want false: %+v", got)
	}
	if got.Profile != m.EffectivePolicy("missing-context").Profile {
		t.Fatalf("profile = %q, want effective profile %q", got.Profile, m.EffectivePolicy("missing-context").Profile)
	}
	if got.Scheduler != nil || got.Pressure != nil || got.NamespaceSweep != nil {
		t.Fatalf("absent plane exposed runtime evidence: %+v", got)
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.planes) != 0 {
		t.Fatalf("explanation created plane state: %+v", m.planes)
	}
}

func TestDataplaneExplanationUsesExactContextProfileOverride(t *testing.T) {
	m := newExplanationTestManager(t)
	plane := addExplanationTestPlane(m, "overridden")
	profile := DataplaneProfileDiagnostic
	bundle := DefaultDataplanePolicyBundle()
	bundle.ContextOverrides = map[string]DataplanePolicyOverride{
		"overridden": {Profile: &profile},
	}
	m.SetPolicyBundle(bundle)

	got := m.DataplaneExplanation("overridden")

	if got.Profile != DataplaneProfileDiagnostic {
		t.Fatalf("profile = %q, want exact-context override %q", got.Profile, DataplaneProfileDiagnostic)
	}
	if plane.Profile() != ProfileFocused {
		t.Fatalf("construction-time plane profile = %q, want focused test precondition", plane.Profile())
	}
}

func TestDataplaneExplanationFiltersExactContextRuntimeState(t *testing.T) {
	m := newExplanationTestManager(t)
	wanted := addExplanationTestPlane(m, "wanted")
	other := addExplanationTestPlane(m, "other")

	wanted.obsMu.Lock()
	wanted.observers = &clusterObservers{
		namespacesState: ObserverStateActive,
		nodesState:      ObserverStateBackoff,
	}
	wanted.obsMu.Unlock()
	other.obsMu.Lock()
	other.observers = &clusterObservers{
		namespacesState: ObserverStateBlockedByAccess,
		nodesState:      ObserverStateFailed,
	}
	other.obsMu.Unlock()

	m.scheduler.health.recordError("wanted", NormalizedErrorClassTimeout)
	m.scheduler.health.recordError("wanted", NormalizedErrorClassTimeout)
	m.scheduler.health.recordError("other", NormalizedErrorClassRateLimited)
	m.scheduler.health.recordError("other", NormalizedErrorClassRateLimited)
	m.scheduler.health.recordError("other", NormalizedErrorClassRateLimited)
	m.scheduler.mu.Lock()
	m.scheduler.lanes["wanted"] = &clusterLane{runners: []*laneRunner{{}}}
	m.scheduler.lanes["other"] = &clusterLane{runners: []*laneRunner{{}, {}}}
	m.scheduler.mu.Unlock()

	now := time.Now().UTC()
	setClusterSnapshot(&wanted.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now},
		Items: []dto.NamespaceListItemDTO{{Name: "apps"}, {Name: "team"}},
	})
	setClusterSnapshot(&other.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now},
		Items: []dto.NamespaceListItemDTO{{Name: "secret-other-context"}},
	})
	m.nsSweepMu.Lock()
	m.nsSweepLast["wanted"] = map[string]time.Time{"apps": now}
	m.nsSweepLast["other"] = map[string]time.Time{"secret-other-context": now}
	m.nsSweepHourStart["wanted"] = now
	m.nsSweepHourStart["other"] = now
	m.nsSweepHourCount["wanted"] = 1
	m.nsSweepHourCount["other"] = 99
	m.nsSweepMu.Unlock()

	got := m.DataplaneExplanation("wanted")

	if !got.Loaded {
		t.Fatalf("loaded = false: %+v", got)
	}
	if len(got.Observers) != 2 {
		t.Fatalf("observers = %+v, want fixed namespaces/nodes set", got.Observers)
	}
	if got.Observers[0].Kind != "namespaces" || got.Observers[0].State != ObserverStateActive {
		t.Fatalf("namespace observer leaked or mismatched: %+v", got.Observers)
	}
	if got.Observers[1].Kind != "nodes" || got.Observers[1].State != ObserverStateBackoff {
		t.Fatalf("node observer leaked or mismatched: %+v", got.Observers)
	}
	if got.Scheduler == nil || got.Scheduler.State != SchedulerHealthLimited || got.Scheduler.RecentFailures != 2 {
		t.Fatalf("scheduler = %+v, want wanted-context limited health", got.Scheduler)
	}
	if got.Pressure == nil || got.Pressure.Running != 1 {
		t.Fatalf("pressure = %+v, want wanted-context running=1", got.Pressure)
	}
	if got.NamespaceSweep == nil || got.NamespaceSweep.TotalNamespaces != 2 || got.NamespaceSweep.EnrichedNamespaces != 1 || got.NamespaceSweep.HourUsed != 1 {
		t.Fatalf("namespace sweep = %+v, want wanted-context coverage", got.NamespaceSweep)
	}
}

func TestDataplaneExplanationSweepReasonMatchesCachedBlockingAdmission(t *testing.T) {
	m := newExplanationTestManager(t)
	const contextName = "cached-pressure"
	plane := addExplanationTestPlane(m, contextName)
	blockingErr := &NormalizedError{Class: NormalizedErrorClassRateLimited}
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
		Err:   blockingErr,
	})
	policy := m.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 1
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 1
	policy.NamespaceEnrichment.Sweep.PauseOnRateLimitOrConnectivity = true
	m.SetPolicy(policy)

	if scheduler := m.dataplaneExplanationScheduler(contextName); scheduler != nil {
		t.Fatalf("scheduler health = %+v, want no current scheduler health", scheduler)
	}
	if admitted := m.selectNamespaceSweepNames(contextName, []string{"apps"}, nil, policy.NamespaceEnrichment); len(admitted) != 0 {
		t.Fatalf("sweep admission = %v, want cached rate-limit issue to pause admission", admitted)
	}
	coverage := m.NamespaceSweepCoverageSnapshot(time.Now().UTC())
	if len(coverage) != 1 {
		t.Fatalf("coverage rows = %d, want 1", len(coverage))
	}
	explanation := m.DataplaneExplanation(contextName)
	if explanation.NamespaceSweep == nil {
		t.Fatal("namespace sweep explanation is nil")
	}
	if got, want := explanation.NamespaceSweep.PausedReason, coverage[0].PausedReason; got != want {
		t.Fatalf("explanation paused reason = %q, want authoritative coverage reason %q", got, want)
	}
	if got, want := explanation.NamespaceSweep.PausedReason, "rate limit or connectivity pressure"; got != want {
		t.Fatalf("explanation paused reason = %q, want %q", got, want)
	}
}

func TestProjectedNamespaceSweepHourUsed(t *testing.T) {
	now := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		hourStart time.Time
		hourCount int
		want      int
	}{
		{name: "zero window", hourCount: 3, want: 0},
		{name: "expired window", hourStart: now.Add(-time.Hour), hourCount: 3, want: 0},
		{name: "active window", hourStart: now.Add(-time.Minute), hourCount: 3, want: 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectedNamespaceSweepHourUsed(now, tt.hourStart, tt.hourCount); got != tt.want {
				t.Fatalf("projected usage = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestDataplaneExplanationProjectsExpiredHourlySweepUsageWithoutMutation(t *testing.T) {
	m := newExplanationTestManager(t)
	const contextName = "expired-hour"
	plane := addExplanationTestPlane(m, contextName)
	now := time.Now().UTC()
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now},
		Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
	})
	policy := m.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 1
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 1
	m.SetPolicy(policy)

	storedStart := now.Add(-2 * time.Hour)
	m.nsSweepMu.Lock()
	m.nsSweepHourStart[contextName] = storedStart
	m.nsSweepHourCount[contextName] = 1
	m.nsSweepMu.Unlock()

	explanation := m.DataplaneExplanation(contextName)
	if explanation.NamespaceSweep == nil {
		t.Fatal("namespace sweep explanation is nil")
	}
	if got := explanation.NamespaceSweep.HourUsed; got != 0 {
		t.Fatalf("explanation hour used = %d, want projected 0 after expiry", got)
	}
	if got, want := explanation.NamespaceSweep.PausedReason, "eligible when idle"; got != want {
		t.Fatalf("explanation paused reason = %q, want %q", got, want)
	}
	coverage := m.NamespaceSweepCoverageSnapshot(now)
	if len(coverage) != 1 {
		t.Fatalf("coverage rows = %d, want 1", len(coverage))
	}
	if got := coverage[0].HourUsed; got != 0 {
		t.Fatalf("coverage hour used = %d, want projected 0 after expiry", got)
	}
	if got, want := coverage[0].PausedReason, "eligible when idle"; got != want {
		t.Fatalf("coverage paused reason = %q, want %q", got, want)
	}

	m.nsSweepMu.Lock()
	if got := m.nsSweepHourStart[contextName]; !got.Equal(storedStart) {
		m.nsSweepMu.Unlock()
		t.Fatalf("projecting explanation changed stored hour start from %v to %v", storedStart, got)
	}
	if got := m.nsSweepHourCount[contextName]; got != 1 {
		m.nsSweepMu.Unlock()
		t.Fatalf("projecting explanation changed stored hour count = %d, want 1", got)
	}
	m.nsSweepMu.Unlock()

	if admitted := m.selectNamespaceSweepNames(contextName, []string{"apps"}, nil, policy.NamespaceEnrichment); len(admitted) != 1 || admitted[0] != "apps" {
		t.Fatalf("selection admitted %v, want apps after expired window reset", admitted)
	}
	m.nsSweepMu.Lock()
	resetStart := m.nsSweepHourStart[contextName]
	resetCount := m.nsSweepHourCount[contextName]
	m.nsSweepMu.Unlock()
	if !resetStart.After(storedStart) || resetCount != 1 {
		t.Fatalf("selection reset state = start %v count %d, want newer start and admitted count 1", resetStart, resetCount)
	}
}

func TestDataplaneExplanationProjectsActiveHourlySweepExhaustion(t *testing.T) {
	m := newExplanationTestManager(t)
	const contextName = "active-hour"
	plane := addExplanationTestPlane(m, contextName)
	now := time.Now().UTC()
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now},
		Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
	})
	policy := m.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 1
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 1
	m.SetPolicy(policy)

	m.nsSweepMu.Lock()
	m.nsSweepHourStart[contextName] = now
	m.nsSweepHourCount[contextName] = 1
	m.nsSweepMu.Unlock()

	explanation := m.DataplaneExplanation(contextName)
	if explanation.NamespaceSweep == nil {
		t.Fatal("namespace sweep explanation is nil")
	}
	if got := explanation.NamespaceSweep.HourUsed; got != 1 {
		t.Fatalf("explanation hour used = %d, want active usage 1", got)
	}
	if got, want := explanation.NamespaceSweep.PausedReason, "hourly sweep budget exhausted"; got != want {
		t.Fatalf("explanation paused reason = %q, want %q", got, want)
	}
}

func TestDataplaneExplanationWithSweepEvidenceDoesNotCreateSchedulerHealth(t *testing.T) {
	m := newExplanationTestManager(t)
	const contextName = "untracked-health"
	plane := addExplanationTestPlane(m, contextName)
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
	})

	for i := 0; i < 3; i++ {
		got := m.DataplaneExplanation(contextName)
		if got.NamespaceSweep == nil {
			t.Fatal("namespace sweep evidence was omitted")
		}
		if got.Scheduler != nil {
			t.Fatalf("scheduler = %+v, want omitted for untracked health", got.Scheduler)
		}
		if len(m.scheduler.health.clusters) != 0 {
			t.Fatalf("explanation call %d inserted scheduler health: %+v", i+1, m.scheduler.health.clusters)
		}
	}
}

func TestNamespaceSweepSelectionAndExplanationRuntimeReasonParity(t *testing.T) {
	tests := []struct {
		name       string
		wantReason string
		setup      func(*manager, *clusterPlane, string)
	}{
		{
			name:       "scheduler busy wins over hourly exhaustion and health pressure",
			wantReason: "scheduler busy",
			setup: func(m *manager, _ *clusterPlane, cluster string) {
				m.scheduler.mu.Lock()
				m.scheduler.lanes[cluster] = &clusterLane{runners: []*laneRunner{{key: workKey{Cluster: cluster}}}}
				m.scheduler.mu.Unlock()
				m.scheduler.health.recordError(cluster, NormalizedErrorClassTimeout)
				m.scheduler.health.recordError(cluster, NormalizedErrorClassTimeout)
				m.nsSweepMu.Lock()
				m.nsSweepHourStart[cluster] = time.Now().UTC()
				m.nsSweepHourCount[cluster] = 1
				m.nsSweepMu.Unlock()
			},
		},
		{
			name:       "tracked limited admission wins over cached pressure and hourly exhaustion",
			wantReason: "background admission limited",
			setup: func(m *manager, plane *clusterPlane, cluster string) {
				m.scheduler.health.recordError(cluster, NormalizedErrorClassTimeout)
				m.scheduler.health.recordError(cluster, NormalizedErrorClassTimeout)
				setClusterSnapshot(&plane.nodesStore, NodesSnapshot{Err: &NormalizedError{Class: NormalizedErrorClassConnectivity}})
				m.nsSweepMu.Lock()
				m.nsSweepHourStart[cluster] = time.Now().UTC()
				m.nsSweepHourCount[cluster] = 1
				m.nsSweepMu.Unlock()
			},
		},
		{
			name:       "tracked paused admission",
			wantReason: "background admission paused",
			setup: func(m *manager, _ *clusterPlane, cluster string) {
				for i := 0; i < 3; i++ {
					m.scheduler.health.recordError(cluster, NormalizedErrorClassRateLimited)
				}
			},
		},
		{
			name:       "cached blocking issue wins over hourly exhaustion",
			wantReason: "rate limit or connectivity pressure",
			setup: func(m *manager, plane *clusterPlane, cluster string) {
				setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
					Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
					Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
					Err:   &NormalizedError{Class: NormalizedErrorClassConnectivity},
				})
				m.nsSweepMu.Lock()
				m.nsSweepHourStart[cluster] = time.Now().UTC()
				m.nsSweepHourCount[cluster] = 1
				m.nsSweepMu.Unlock()
			},
		},
		{
			name:       "hourly exhaustion after runtime gates",
			wantReason: "hourly sweep budget exhausted",
			setup: func(m *manager, _ *clusterPlane, cluster string) {
				m.nsSweepMu.Lock()
				m.nsSweepHourStart[cluster] = time.Now().UTC()
				m.nsSweepHourCount[cluster] = 1
				m.nsSweepMu.Unlock()
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newExplanationTestManager(t)
			clusterName := "parity"
			plane := addExplanationTestPlane(m, clusterName)
			setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
				Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
				Items: []dto.NamespaceListItemDTO{{Name: "apps"}},
			})
			policy := m.Policy()
			policy.NamespaceEnrichment.Enabled = true
			policy.NamespaceEnrichment.Sweep.Enabled = true
			policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 1
			policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 1
			policy.NamespaceEnrichment.Sweep.PauseWhenSchedulerBusy = true
			policy.NamespaceEnrichment.Sweep.PauseOnRateLimitOrConnectivity = true
			m.SetPolicy(policy)
			tt.setup(m, plane, clusterName)

			if admitted := m.selectNamespaceSweepNames(clusterName, []string{"apps"}, nil, policy.NamespaceEnrichment); len(admitted) != 0 {
				t.Fatalf("selection admitted %v, want rejection %q", admitted, tt.wantReason)
			}
			got := m.DataplaneExplanation(clusterName)
			if got.NamespaceSweep == nil {
				t.Fatal("namespace sweep explanation is nil")
			}
			if got.NamespaceSweep.PausedReason != tt.wantReason {
				t.Fatalf("explanation reason = %q, want selection's first rejecting gate %q", got.NamespaceSweep.PausedReason, tt.wantReason)
			}
		})
	}
}

func TestDataplaneExplanationObserverAbsenceAndPolicyDisablement(t *testing.T) {
	m := newExplanationTestManager(t)
	addExplanationTestPlane(m, "ctx")
	policy := m.Policy()
	policy.Observers.NodesEnabled = false
	m.SetPolicy(policy)

	got := m.DataplaneExplanation("ctx")

	if got.Observers[0].State != "" || !got.Observers[0].Enabled {
		t.Fatalf("enabled unloaded observer = %+v", got.Observers[0])
	}
	if got.Observers[1].State != ObserverStateDisabled || got.Observers[1].Enabled {
		t.Fatalf("disabled observer = %+v", got.Observers[1])
	}
	if got.Scheduler != nil {
		t.Fatalf("scheduler absence synthesized health: %+v", got.Scheduler)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal explanation: %v", err)
	}
	var wire struct {
		Observers []map[string]any `json:"observers"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("decode explanation: %v", err)
	}
	if _, exists := wire.Observers[0]["state"]; exists {
		t.Fatalf("enabled observer without runtime state serialized state: %s", encoded)
	}
	if wire.Observers[1]["state"] != string(ObserverStateDisabled) {
		t.Fatalf("disabled observer state = %v, want %q: %s", wire.Observers[1]["state"], ObserverStateDisabled, encoded)
	}
}

func TestDataplaneExplanationObserverStateConcurrentAccess(t *testing.T) {
	m := newExplanationTestManager(t)
	plane := addExplanationTestPlane(m, "ctx")
	const iterations = 10000
	start := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-start
		for i := 0; i < iterations; i++ {
			state := ObserverStateActive
			if i%2 == 0 {
				state = ObserverStateBackoff
			}
			plane.setObserverState(observerKindNamespaces, state, nil)
		}
	}()
	close(start)
	for i := 0; i < iterations; i++ {
		got := m.DataplaneExplanation("ctx")
		if state := got.Observers[0].State; state != "" && state != ObserverStateActive && state != ObserverStateBackoff {
			t.Fatalf("unexpected observer state during concurrent access: %q", state)
		}
	}
	<-done
}

func TestDataplaneExplanationSourceAvoidsLifecycleAndUpstreamCalls(t *testing.T) {
	const path = "explanation.go"
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if strings.Contains(string(source), "m.clients") || strings.Contains(string(source), "m.persistence") {
		t.Fatalf("%s must not access client-provider or persistence fields", path)
	}

	file, err := parser.ParseFile(token.NewFileSet(), path, source, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	forbidden := map[string]bool{
		"PlaneForCluster": true, "EnsureObservers": true,
		"NamespacesSnapshot": true, "NodesSnapshot": true,
		"DashboardSummary": true, "DashboardSignalsSummary": true, "DashboardDataplaneSummary": true,
		"MetricsCapability": true, "SchedulerLiveWork": true, "SchedulerRunStats": true,
		"LiveWorkSnapshot": true, "HealthSnapshot": true, "BackgroundAdmission": true,
		"ClusterPressureSnapshot": true, "NamespaceSweepCoverageSnapshot": true,
		"hydratePersistedPlanes": true, "hydratePersistedSnapshots": true,
	}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if ok && forbidden[selector.Sel.Name] {
			t.Errorf("forbidden cache-opening/lifecycle call %s in %s", selector.Sel.Name, path)
		}
		return true
	})
}
