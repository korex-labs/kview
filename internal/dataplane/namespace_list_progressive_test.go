package dataplane

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type failingClientsProvider struct{}

func (failingClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return nil, "", errors.New("not configured")
}

func TestNamespaceListEnrichmentReusesStableRevisionForSameWorkset(t *testing.T) {
	m := &manager{
		scheduler: newWorkScheduler(1),
		clients:   failingClientsProvider{},
		nsEnrich:  newNsEnrichmentCoordinator(),
	}
	items := []dto.NamespaceListItemDTO{{Name: "default"}, {Name: "prod"}}
	hints := NamespaceEnrichHints{Focus: "default", Favorite: map[string]struct{}{}}

	rev1 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, hints)
	rev2 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, hints)
	if rev1 == 0 {
		t.Fatal("expected enrichment revision")
	}
	if rev2 != rev1 {
		t.Fatalf("expected stable revision reuse, got %d then %d", rev1, rev2)
	}

	m.nsEnrich.byCluster["ctx"].cancel()
}

func TestNamespaceListEnrichmentReusesCompletedRevisionForSameWorkset(t *testing.T) {
	m := &manager{
		scheduler: newWorkScheduler(1),
		clients:   failingClientsProvider{},
		nsEnrich:  newNsEnrichmentCoordinator(),
	}
	items := []dto.NamespaceListItemDTO{{Name: "default"}, {Name: "prod"}}
	hints := NamespaceEnrichHints{Focus: "default", Favorite: map[string]struct{}{}}

	rev1 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, hints)
	m.nsEnrich.byCluster["ctx"].complete = true
	rev2 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, hints)
	if rev1 == 0 {
		t.Fatal("expected enrichment revision")
	}
	if rev2 != rev1 {
		t.Fatalf("expected completed same workset to reuse revision, got %d then %d", rev1, rev2)
	}

	m.nsEnrich.byCluster["ctx"].cancel()
}

func TestNamespaceListEnrichmentStartsNewRevisionForChangedWorkset(t *testing.T) {
	m := &manager{
		scheduler: newWorkScheduler(1),
		clients:   failingClientsProvider{},
		nsEnrich:  newNsEnrichmentCoordinator(),
	}
	items := []dto.NamespaceListItemDTO{{Name: "default"}, {Name: "prod"}}

	rev1 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, NamespaceEnrichHints{Focus: "default", Favorite: map[string]struct{}{}})
	rev2 := m.BeginNamespaceListProgressiveEnrichment("ctx", items, NamespaceEnrichHints{Focus: "prod", Favorite: map[string]struct{}{}})
	if rev1 == 0 || rev2 == 0 {
		t.Fatalf("expected revisions, got %d and %d", rev1, rev2)
	}
	if rev2 == rev1 {
		t.Fatalf("expected changed workset to start a new revision, got %d", rev2)
	}

	m.nsEnrich.byCluster["ctx"].cancel()
}

func TestFilterFavouriteInsightWarmTargetsKeepsWorkOrderSubset(t *testing.T) {
	got := filterFavouriteInsightWarmTargets(
		[]string{"prod", "default", "staging"},
		NamespaceEnrichHints{Favorite: map[string]struct{}{"default": {}, "staging": {}, "missing": {}}},
	)
	if len(got) != 2 || got[0] != "default" || got[1] != "staging" {
		t.Fatalf("unexpected favourite insight targets: %#v", got)
	}
}

func TestNamespaceEnrichSessionUpdateBaseRowsKeepsEnrichedFields(t *testing.T) {
	sess := &nsEnrichSession{
		order: []string{"default"},
		merged: map[string]dto.NamespaceListItemDTO{
			"default": {
				Name:               "default",
				Phase:              "Active",
				RowEnriched:        true,
				SummaryState:       "ok",
				PodCount:           3,
				DeploymentCount:    1,
				ListSignalSeverity: "ok",
			},
		},
	}

	sess.updateBaseRows([]string{"default"}, map[string]dto.NamespaceListItemDTO{
		"default": {Name: "default", Phase: "Terminating"},
	})

	got := sess.merged["default"]
	if got.Phase != "Terminating" {
		t.Fatalf("expected base row fields to refresh, got phase %q", got.Phase)
	}
	if !got.RowEnriched || got.PodCount != 3 || got.DeploymentCount != 1 || got.SummaryState != "ok" {
		t.Fatalf("expected enriched fields to be preserved, got %+v", got)
	}
}

func TestNamespaceEnrichSessionMergeExistingRowsIntoKeepsEnrichedFieldsAcrossRevision(t *testing.T) {
	sess := &nsEnrichSession{
		order: []string{"default"},
		merged: map[string]dto.NamespaceListItemDTO{
			"default": {
				Name:               "default",
				Phase:              "Active",
				RowEnriched:        true,
				SummaryState:       "warning",
				PodCount:           7,
				DeploymentCount:    2,
				ListSignalSeverity: "medium",
				ListSignalCount:    1,
			},
		},
	}

	nextRows := sess.mergeExistingRowsInto([]string{"default"}, map[string]dto.NamespaceListItemDTO{
		"default": {Name: "default", Phase: "Terminating"},
	})

	got := nextRows["default"]
	if got.Phase != "Terminating" {
		t.Fatalf("expected base row fields to refresh, got phase %q", got.Phase)
	}
	if !got.RowEnriched || got.PodCount != 7 || got.DeploymentCount != 2 || got.SummaryState != "warning" || got.ListSignalSeverity != "medium" || got.ListSignalCount != 1 {
		t.Fatalf("expected enriched fields to be preserved, got %+v", got)
	}
}

func TestNamespaceListEnrichmentPollUsesCachedRowProjection(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-cache-poll"
	planeAny, _ := mm.PlaneForCluster(t.Context(), cluster)
	plane := planeAny.(*clusterPlane)
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.PodListItemDTO{{Name: "pod", Namespace: "app"}},
	})
	mm.nsEnrich.byCluster[cluster] = &nsEnrichSession{
		rev:       1,
		order:     []string{"app"},
		workNames: []string{"app"},
		merged: map[string]dto.NamespaceListItemDTO{
			"app": {Name: "app"},
		},
		complete: true,
		total:    1,
	}

	got := mm.NamespaceListEnrichmentPoll(cluster, 1)
	if len(got.Updates) != 1 {
		t.Fatalf("updates: got %d", len(got.Updates))
	}
	if !got.Updates[0].RowEnriched || got.Updates[0].PodCount != 1 {
		t.Fatalf("expected cached row projection, got %+v", got.Updates[0])
	}
}

func TestNamespaceListEnrichmentPollSinceReturnsOnlyChangedRows(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-delta-poll"
	mm.nsEnrich.byCluster[cluster] = &nsEnrichSession{
		rev:       7,
		order:     []string{"app", "db"},
		workNames: []string{"app", "db"},
		merged: map[string]dto.NamespaceListItemDTO{
			"app": {Name: "app", RowEnriched: true, PodCount: 3},
			"db":  {Name: "db", RowEnriched: true, PodCount: 1},
		},
		seq: map[string]uint64{
			"app": 2,
			"db":  4,
		},
		nextSeq:  4,
		complete: true,
		total:    2,
	}

	got := mm.NamespaceListEnrichmentPollSince(cluster, 7, 2)
	if got.Sequence != 4 {
		t.Fatalf("sequence: got %d, want 4", got.Sequence)
	}
	if len(got.Updates) != 1 || got.Updates[0].Name != "db" {
		t.Fatalf("updates: got %+v, want only db", got.Updates)
	}
}

func TestNamespaceEnrichActivityIDIsStableAndSafe(t *testing.T) {
	if got, want := namespaceEnrichActivityID("kind-dev/admin@cluster"), "ns-enrich-kind-dev-admin-cluster"; got != want {
		t.Fatalf("activity id: got %q want %q", got, want)
	}
	if got, want := namespaceEnrichActivityID("kind-dev/admin@cluster"), namespaceEnrichActivityID("kind-dev/admin@cluster"); got != want {
		t.Fatalf("activity id should be stable, got %q and %q", got, want)
	}
}

func TestNamespaceSweepCoverageSnapshotCountsFreshStaleAndNeverScanned(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-sweep-coverage"
	planeAny, _ := mm.PlaneForCluster(t.Context(), cluster)
	plane := planeAny.(*clusterPlane)
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.NamespaceListItemDTO{{Name: "app"}, {Name: "stale"}, {Name: "never"}, {Name: "kube-system"}},
	})
	policy := mm.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 2
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 8
	policy.NamespaceEnrichment.Sweep.MinReenrichIntervalMinutes = 30
	policy.NamespaceEnrichment.Sweep.IncludeSystemNamespaces = false
	mm.SetPolicy(policy)

	now := time.Now().UTC()
	mm.nsSweepMu.Lock()
	mm.nsSweepLast[cluster] = map[string]time.Time{
		"app":   now.Add(-5 * time.Minute),
		"stale": now.Add(-45 * time.Minute),
	}
	mm.nsSweepHourStart[cluster] = now
	mm.nsSweepHourCount[cluster] = 2
	mm.nsSweepMu.Unlock()

	rows := mm.NamespaceSweepCoverageSnapshot(now)
	if len(rows) != 1 {
		t.Fatalf("rows: got %d", len(rows))
	}
	got := rows[0]
	if !got.Enabled || got.TotalNamespaces != 4 || got.EnrichedNamespaces != 2 || got.StaleNamespaces != 1 || got.NeverScannedNamespaces != 1 || got.SystemNamespacesSkipped != 1 {
		t.Fatalf("unexpected coverage: %+v", got)
	}
	if got.EnrichedNamespaces+got.NeverScannedNamespaces+got.SystemNamespacesSkipped != got.TotalNamespaces {
		t.Fatalf("coverage buckets should add up to total: %+v", got)
	}
	if got.HourUsed != 2 || got.HourLimit != 8 {
		t.Fatalf("unexpected hourly budget: %+v", got)
	}
	if got.PausedReason != "eligible when idle" {
		t.Fatalf("paused reason: got %q", got.PausedReason)
	}
}

func TestNamespaceSweepCoverageSeparatesCachedEnrichmentFromRuntimeSweepHistory(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	mm.clients = panicExplanationClientsProvider{}
	cluster := "ctx-cache-coverage"
	planeAny, _ := mm.PlaneForCluster(t.Context(), cluster)
	plane := planeAny.(*clusterPlane)
	now := time.Now().UTC()
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now},
		Items: []dto.NamespaceListItemDTO{
			{Name: "app-hot"},
			{Name: "app-none"},
			{Name: "kube-system"},
			{}, // Malformed cached rows do not represent a usable namespace.
		},
	})
	setNamespacedSnapshot(&plane.rqStore, "app-hot", ResourceQuotasSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot},
	})
	setNamespacedSnapshot(&plane.podsStore, "kube-system", PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot},
	})
	setNamespacedSnapshot(&plane.depsStore, "kube-system", DeploymentsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassStale},
	})
	policy := mm.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = 2
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 8
	policy.NamespaceEnrichment.Sweep.IncludeSystemNamespaces = false
	mm.SetPolicy(policy)

	coverage := mm.NamespaceSweepCoverageSnapshot(now)
	if len(coverage) != 1 {
		t.Fatalf("coverage rows: got %d, want 1", len(coverage))
	}
	got := coverage[0]
	if got.TotalNamespaces != 3 {
		t.Fatalf("total namespaces = %d, want 3 named rows", got.TotalNamespaces)
	}
	if got.CachedEnrichmentNamespaces != 2 || got.NoCachedEnrichmentNamespaces != 1 {
		t.Fatalf("cached coverage = %+v, want cached=2 noCached=1", got)
	}
	if got.CachedHotNamespaces != 1 || got.CachedWarmNamespaces != 0 || got.CachedColdNamespaces != 0 || got.CachedStaleNamespaces != 1 || got.CachedUnknownNamespaces != 0 {
		t.Fatalf("cached freshness buckets = %+v, want hot=1 stale=1", got)
	}
	if got.CachedEnrichmentNamespaces+got.NoCachedEnrichmentNamespaces != got.TotalNamespaces {
		t.Fatalf("cached coverage buckets should equal named total: %+v", got)
	}
	if got.CachedHotNamespaces+got.CachedWarmNamespaces+got.CachedColdNamespaces+got.CachedStaleNamespaces+got.CachedUnknownNamespaces != got.CachedEnrichmentNamespaces {
		t.Fatalf("cached freshness buckets should equal cached total: %+v", got)
	}
	if got.EnrichedNamespaces != 0 || got.StaleNamespaces != 0 || got.NeverScannedNamespaces != 2 || got.SystemNamespacesSkipped != 1 {
		t.Fatalf("runtime sweep history should remain independent: %+v", got)
	}

	explanation := mm.DataplaneExplanation(cluster)
	if explanation.NamespaceSweep == nil {
		t.Fatal("namespace sweep explanation is nil")
	}
	explained := explanation.NamespaceSweep
	if explained.CachedEnrichmentNamespaces != got.CachedEnrichmentNamespaces ||
		explained.NoCachedEnrichmentNamespaces != got.NoCachedEnrichmentNamespaces ||
		explained.CachedHotNamespaces != got.CachedHotNamespaces ||
		explained.CachedStaleNamespaces != got.CachedStaleNamespaces ||
		explained.EnrichedNamespaces != 0 || explained.NeverScannedNamespaces != 2 {
		t.Fatalf("explanation cache/runtime evidence drifted: coverage=%+v explanation=%+v", got, explained)
	}

	mm.nsSweepMu.Lock()
	defer mm.nsSweepMu.Unlock()
	if _, ok := mm.nsSweepLast[cluster]; ok {
		t.Fatalf("coverage/explanation created runtime sweep history: %+v", mm.nsSweepLast[cluster])
	}
	if _, ok := mm.nsSweepHourStart[cluster]; ok {
		t.Fatalf("coverage/explanation created sweep hour start: %+v", mm.nsSweepHourStart[cluster])
	}
	if _, ok := mm.nsSweepHourCount[cluster]; ok {
		t.Fatalf("coverage/explanation created sweep hour count: %+v", mm.nsSweepHourCount[cluster])
	}
}

func TestSchedulerLiveWorkIncludesNamespaceSweepCoverage(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	cluster := "ctx-live-sweep"
	planeAny, _ := mm.PlaneForCluster(t.Context(), cluster)
	plane := planeAny.(*clusterPlane)
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: time.Now().UTC()},
		Items: []dto.NamespaceListItemDTO{{Name: "app"}},
	})
	policy := mm.Policy()
	policy.NamespaceEnrichment.Enabled = true
	policy.NamespaceEnrichment.Sweep.Enabled = true
	policy.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = 4
	mm.SetPolicy(policy)

	got := mm.SchedulerLiveWork()
	if len(got.NamespaceSweep) != 1 {
		t.Fatalf("namespaceSweep rows: got %d", len(got.NamespaceSweep))
	}
	if got.NamespaceSweep[0].Cluster != cluster || got.NamespaceSweep[0].TotalNamespaces != 1 {
		t.Fatalf("unexpected namespaceSweep row: %+v", got.NamespaceSweep[0])
	}
}
