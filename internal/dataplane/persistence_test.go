package dataplane

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	bolt "go.etcd.io/bbolt"
)

type persistenceFailingClientsProvider struct{}

func (persistenceFailingClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return nil, "", errors.New("cluster unavailable")
}

func TestBoltSnapshotPersistenceRoundTripAndIndexesNames(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	observed := time.Now().UTC().Add(-time.Minute)
	snap := PodsSnapshot{
		Items: []dto.PodListItemDTO{{
			Name:               "api-7f",
			Namespace:          "app",
			ListHealthHint:     "problem",
			ListStatus:         "CrashLoopBackOff",
			ListSignalSeverity: "high",
			ListSignalCount:    2,
		}},
		Meta: SnapshotMetadata{
			ObservedAt:   observed,
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		},
	}
	if err := store.Save("ctx", ResourceKindPods, "app", snap); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}

	var got PodsSnapshot
	ok, err := store.Load("ctx", ResourceKindPods, "app", &got)
	if err != nil {
		t.Fatalf("load snapshot: %v", err)
	}
	if !ok || len(got.Items) != 1 || got.Items[0].Name != "api-7f" {
		t.Fatalf("loaded snapshot = ok %v snap %+v", ok, got)
	}

	rows := searchRowsFromSnapshot("ctx", ResourceKindPods, "app", got)
	if len(rows) != 1 || rows[0].Name != "api-7f" || rows[0].Namespace != "app" || rows[0].SignalSeverity != "high" || rows[0].SignalCount != 2 || !rows[0].NeedsAttention {
		t.Fatalf("search rows = %+v", rows)
	}

	indexRows, err := store.SearchNamePrefix("api", 10)
	if err != nil {
		t.Fatalf("search index: %v", err)
	}
	if len(indexRows) != 1 || indexRows[0].Kind != string(ResourceKindPods) || indexRows[0].Name != "api-7f" {
		t.Fatalf("index rows = %+v", indexRows)
	}
	containsRows, err := store.SearchName("ctx", "7F", 10, 0)
	if err != nil {
		t.Fatalf("search contains index: %v", err)
	}
	if len(containsRows) != 1 || containsRows[0].Name != "api-7f" {
		t.Fatalf("contains rows = %+v", containsRows)
	}
	namespaceRows, err := store.SearchName("ctx", "app high", 10, 0)
	if err != nil {
		t.Fatalf("search enriched fields: %v", err)
	}
	if len(namespaceRows) != 1 || namespaceRows[0].Name != "api-7f" || namespaceRows[0].MatchReason != "namespace" {
		t.Fatalf("enriched rows = %+v", namespaceRows)
	}
}

func TestBoltSnapshotPersistenceMigrationFreshDB(t *testing.T) {
	path := t.TempDir() + "/cache.bbolt"
	store, err := openBoltSnapshotPersistence(path)
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()
	ms := store.MigrationStatus()
	if ms.ToVersion != dataplaneSchemaVersionCurrent {
		t.Fatalf("fresh DB schema version = %d, want %d", ms.ToVersion, dataplaneSchemaVersionCurrent)
	}
	if !ms.Applied {
		t.Fatalf("fresh DB should apply initial schema migration: %+v", ms)
	}
}

func TestBoltSnapshotPersistenceMigrationFromV1(t *testing.T) {
	path := t.TempDir() + "/cache.bbolt"
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		t.Fatalf("seed v1 open: %v", err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		for _, bucket := range [][]byte{dataplaneSnapshotBucket, dataplaneSearchBucket, dataplaneCellIndexBucket, dataplaneSignalBucket} {
			if _, err := tx.CreateBucketIfNotExists(bucket); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		_ = db.Close()
		t.Fatalf("seed v1 buckets: %v", err)
	}
	_ = db.Close()

	store, err := openBoltSnapshotPersistence(path)
	if err != nil {
		t.Fatalf("open migrated persistence: %v", err)
	}
	defer func() { _ = store.Close() }()
	ms := store.MigrationStatus()
	if ms.FromVersion != dataplaneSchemaVersionV1 || ms.ToVersion != dataplaneSchemaVersionCurrent {
		t.Fatalf("v1 migration versions = %+v", ms)
	}
	if !ms.Applied {
		t.Fatalf("v1 DB should be migrated: %+v", ms)
	}
}

func TestBoltSnapshotPersistenceMigrationFailsForCorruptMeta(t *testing.T) {
	path := t.TempDir() + "/cache.bbolt"
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		t.Fatalf("open corrupt seed db: %v", err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		mb, err := tx.CreateBucketIfNotExists(dataplaneMetaBucket)
		if err != nil {
			return err
		}
		return mb.Put(dataplaneSchemaKey, []byte("{invalid-json"))
	}); err != nil {
		_ = db.Close()
		t.Fatalf("seed corrupt meta: %v", err)
	}
	_ = db.Close()

	if _, err := openBoltSnapshotPersistence(path); err == nil {
		t.Fatalf("expected open failure for corrupt migration metadata")
	}
}

func TestBoltSnapshotPersistenceSearchPrioritizesKindsAndOffsets(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	meta := SnapshotMetadata{ObservedAt: time.Now().UTC()}
	mustSave := func(kind ResourceKind, snap any) {
		t.Helper()
		if err := store.Save("ctx", kind, "app", snap); err != nil {
			t.Fatalf("save %s: %v", kind, err)
		}
	}
	mustSave(ResourceKindPods, PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "search-target-pod", Namespace: "app"}}, Meta: meta})
	mustSave(ResourceKindStatefulSets, StatefulSetsSnapshot{Items: []dto.StatefulSetDTO{{Name: "search-target-sts", Namespace: "app"}}, Meta: meta})
	mustSave(ResourceKindDeployments, DeploymentsSnapshot{Items: []dto.DeploymentListItemDTO{{Name: "search-target-dep", Namespace: "app"}}, Meta: meta})
	mustSave(ResourceKindHelmReleases, HelmReleasesSnapshot{Items: []dto.HelmReleaseDTO{{Name: "search-target-helm", Namespace: "app"}}, Meta: meta})

	firstPage, err := store.SearchName("ctx", "search-target", 2, 0)
	if err != nil {
		t.Fatalf("first page search: %v", err)
	}
	if got := []string{firstPage[0].Kind, firstPage[1].Kind}; got[0] != string(ResourceKindHelmReleases) || got[1] != string(ResourceKindDeployments) {
		t.Fatalf("first page kind order = %+v", got)
	}
	secondPage, err := store.SearchName("ctx", "search-target", 2, 2)
	if err != nil {
		t.Fatalf("second page search: %v", err)
	}
	if got := []string{secondPage[0].Kind, secondPage[1].Kind}; got[0] != string(ResourceKindStatefulSets) || got[1] != string(ResourceKindPods) {
		t.Fatalf("second page kind order = %+v", got)
	}
}

func TestBoltSnapshotPersistencePrunesOlderSnapshotsAndSearchIndex(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	oldMeta := SnapshotMetadata{ObservedAt: time.Now().UTC().Add(-48 * time.Hour)}
	freshMeta := SnapshotMetadata{ObservedAt: time.Now().UTC().Add(-time.Hour)}
	if err := store.Save("ctx", ResourceKindPods, "old", PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "old-pod", Namespace: "old"}},
		Meta:  oldMeta,
	}); err != nil {
		t.Fatalf("save old snapshot: %v", err)
	}
	if err := store.Save("ctx", ResourceKindPods, "fresh", PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "fresh-pod", Namespace: "fresh"}},
		Meta:  freshMeta,
	}); err != nil {
		t.Fatalf("save fresh snapshot: %v", err)
	}

	if err := store.PruneOlderThan("ctx", 24*time.Hour); err != nil {
		t.Fatalf("prune old snapshots: %v", err)
	}

	var old PodsSnapshot
	ok, err := store.Load("ctx", ResourceKindPods, "old", &old)
	if err != nil {
		t.Fatalf("load old snapshot: %v", err)
	}
	if ok {
		t.Fatalf("old snapshot was not pruned")
	}
	var fresh PodsSnapshot
	ok, err = store.Load("ctx", ResourceKindPods, "fresh", &fresh)
	if err != nil {
		t.Fatalf("load fresh snapshot: %v", err)
	}
	if !ok || len(fresh.Items) != 1 || fresh.Items[0].Name != "fresh-pod" {
		t.Fatalf("fresh snapshot after prune ok=%v snap=%+v", ok, fresh)
	}

	rows, err := store.SearchName("ctx", "pod", 10, 0)
	if err != nil {
		t.Fatalf("search after prune: %v", err)
	}
	if len(rows) != 1 || rows[0].Name != "fresh-pod" {
		t.Fatalf("search rows after prune = %+v", rows)
	}
}

func TestBoltSnapshotPersistenceSignalHistoryRoundTripAndPrune(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	now := time.Now().UTC().Unix()
	if err := store.UpsertSignalHistory("ctx", map[string]SignalHistoryRecord{
		"pod_restarts|namespace|team-a|Pod|api-0": {
			FirstSeenAt:  now - 7200,
			LastSeenAt:   now - 60,
			SeenCount:    3,
			ObservedDays: []int64{signalObservedDay(now - 7200), signalObservedDay(now - 60)},
		},
		"empty_secret|namespace|team-a|Secret|token": {
			FirstSeenAt: now - int64((48 * time.Hour).Seconds()),
			LastSeenAt:  now - int64((48 * time.Hour).Seconds()),
			SeenCount:   1,
		},
	}); err != nil {
		t.Fatalf("upsert signal history: %v", err)
	}

	history, err := store.LoadSignalHistory("ctx")
	if err != nil {
		t.Fatalf("load signal history: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("history len = %d, want 2", len(history))
	}
	if got := history["pod_restarts|namespace|team-a|Pod|api-0"]; got.FirstSeenAt != now-7200 || got.LastSeenAt != now-60 || got.SeenCount != 3 || len(got.ObservedDays) == 0 {
		t.Fatalf("pod signal history = %+v", got)
	}

	if err := store.PruneSignalHistoryOlderThan("ctx", 24*time.Hour); err != nil {
		t.Fatalf("prune signal history: %v", err)
	}
	history, err = store.LoadSignalHistory("ctx")
	if err != nil {
		t.Fatalf("reload signal history: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history len after prune = %d, want 1", len(history))
	}
	if _, ok := history["empty_secret|namespace|team-a|Secret|token"]; ok {
		t.Fatalf("stale signal history was not pruned: %+v", history)
	}
	if err := store.DeleteSignalHistory("ctx", "pod_restarts|namespace|team-a|Pod|api-0"); err != nil {
		t.Fatalf("delete signal history: %v", err)
	}
	history, err = store.LoadSignalHistory("ctx")
	if err != nil || len(history) != 0 {
		t.Fatalf("history after delete = %+v, err %v", history, err)
	}
}

func TestBoltSnapshotPersistenceSignalAcknowledgementRoundTripAndPrune(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	now := time.Now().UTC().Unix()
	freshKey := "pod_restarts|namespace|team-a|Pod|api-0"
	staleKey := "empty_secret|namespace|team-a|Secret|token"
	if err := store.UpsertSignalAcknowledgement("ctx", freshKey, SignalAcknowledgementRecord{
		AcknowledgedAt: now - 60,
		Comment:        "rollout in progress",
		UpdatedAt:      now - 60,
	}); err != nil {
		t.Fatalf("upsert fresh acknowledgement: %v", err)
	}
	if err := store.UpsertSignalAcknowledgement("ctx", staleKey, SignalAcknowledgementRecord{
		AcknowledgedAt: now - int64((48 * time.Hour).Seconds()),
		Comment:        "old",
		UpdatedAt:      now - int64((48 * time.Hour).Seconds()),
	}); err != nil {
		t.Fatalf("upsert stale acknowledgement: %v", err)
	}

	acks, err := store.LoadSignalAcknowledgements("ctx")
	if err != nil {
		t.Fatalf("load acknowledgements: %v", err)
	}
	if len(acks) != 2 {
		t.Fatalf("acks len = %d, want 2", len(acks))
	}
	if got := acks[freshKey]; got.Comment != "rollout in progress" {
		t.Fatalf("fresh acknowledgement = %+v", got)
	}

	if err := store.DeleteSignalAcknowledgement("ctx", freshKey); err != nil {
		t.Fatalf("delete acknowledgement: %v", err)
	}
	acks, err = store.LoadSignalAcknowledgements("ctx")
	if err != nil {
		t.Fatalf("reload acknowledgements: %v", err)
	}
	if _, ok := acks[freshKey]; ok {
		t.Fatalf("fresh acknowledgement was not deleted: %+v", acks)
	}

	if err := store.PruneSignalAcknowledgementsOlderThan("ctx", 24*time.Hour); err != nil {
		t.Fatalf("prune acknowledgements: %v", err)
	}
	acks, err = store.LoadSignalAcknowledgements("ctx")
	if err != nil {
		t.Fatalf("reload acknowledgements after prune: %v", err)
	}
	if len(acks) != 0 {
		t.Fatalf("acks len after prune = %d, want 0: %+v", len(acks), acks)
	}
}

func TestExecuteNamespacedSnapshotUsesPersistedFallbackOnLiveFailure(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	observed := time.Now().UTC().Add(-time.Hour)
	persisted := PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "stale-pod", Namespace: "app"}},
		Meta: SnapshotMetadata{
			ObservedAt:   observed,
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		},
	}
	if err := store.Save("ctx", ResourceKindPods, "app", persisted); err != nil {
		t.Fatalf("save persisted snapshot: %v", err)
	}

	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy {
		return policy
	}, func() snapshotPersistence {
		return store
	}, nil)

	snap, err := plane.PodsSnapshot(context.Background(), newWorkScheduler(1), persistenceFailingClientsProvider{}, "app", WorkPriorityCritical)
	if err == nil {
		t.Fatalf("expected live refresh error")
	}
	if len(snap.Items) != 1 || snap.Items[0].Name != "stale-pod" {
		t.Fatalf("fallback items = %+v", snap.Items)
	}
	if snap.Meta.Freshness != FreshnessClassStale {
		t.Fatalf("fallback freshness = %q", snap.Meta.Freshness)
	}
	if snap.Err == nil || snap.Err.Class != NormalizedErrorClassUnknown {
		t.Fatalf("fallback normalized error = %+v", snap.Err)
	}
}

func TestManagerHydratesPersistedSnapshotsWhenPlaneIsCreated(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())

	store, err := openBoltSnapshotPersistence("")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	observed := time.Now().UTC().Add(-time.Hour)
	meta := SnapshotMetadata{
		ObservedAt:   observed,
		Freshness:    FreshnessClassHot,
		Coverage:     CoverageClassFull,
		Degradation:  DegradationClassNone,
		Completeness: CompletenessClassComplete,
	}
	if err := store.Save("ctx", ResourceKindNamespaces, "", NamespaceSnapshot{
		Items: []dto.NamespaceListItemDTO{{Name: "app"}},
		Meta:  meta,
	}); err != nil {
		t.Fatalf("save namespace snapshot: %v", err)
	}
	if err := store.Save("ctx", ResourceKindPods, "app", PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "api-7f", Namespace: "app"}},
		Meta:  meta,
	}); err != nil {
		t.Fatalf("save pod snapshot: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close seed persistence: %v", err)
	}

	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	policy.Persistence.MaxAgeHours = 24
	m := NewManager(ManagerConfig{Policy: policy}).(*manager)
	defer func() {
		if sp := m.currentPersistence(); sp != nil {
			_ = sp.Close()
		}
	}()

	planeAny, err := m.PlaneForCluster(context.Background(), "ctx")
	if err != nil {
		t.Fatalf("plane for cluster: %v", err)
	}
	plane := planeAny.(*clusterPlane)

	nsSnap, ok := peekClusterSnapshot(&plane.nsStore)
	if !ok || len(nsSnap.Items) != 1 || nsSnap.Items[0].Name != "app" {
		t.Fatalf("hydrated namespaces ok=%v snap=%+v", ok, nsSnap)
	}
	if nsSnap.Meta.Freshness != FreshnessClassStale {
		t.Fatalf("hydrated namespace freshness = %q", nsSnap.Meta.Freshness)
	}

	podSnap, ok := peekNamespacedSnapshot(&plane.podsStore, "app")
	if !ok || len(podSnap.Items) != 1 || podSnap.Items[0].Name != "api-7f" {
		t.Fatalf("hydrated pods ok=%v snap=%+v", ok, podSnap)
	}
	if podSnap.Meta.Freshness != FreshnessClassStale {
		t.Fatalf("hydrated pod freshness = %q", podSnap.Meta.Freshness)
	}
}

func TestHydratePersistedSnapshotsContinuesAfterBadCell(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer func() { _ = store.Close() }()

	observed := time.Now().UTC().Add(-time.Hour)
	meta := SnapshotMetadata{
		ObservedAt:   observed,
		Freshness:    FreshnessClassHot,
		Coverage:     CoverageClassFull,
		Degradation:  DegradationClassNone,
		Completeness: CompletenessClassComplete,
	}
	if err := store.Save("ctx", ResourceKindPods, "app", PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "api-7f", Namespace: "app"}},
		Meta:  meta,
	}); err != nil {
		t.Fatalf("save pod snapshot: %v", err)
	}
	if err := store.db.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists(dataplaneSnapshotBucket)
		if err != nil {
			return err
		}
		return b.Put(snapshotKey("ctx", ResourceKindCustomResources, "bad"), []byte("{"))
	}); err != nil {
		t.Fatalf("seed bad snapshot cell: %v", err)
	}

	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy {
		return policy
	}, func() snapshotPersistence {
		return store
	}, nil)

	if err := plane.hydratePersistedSnapshots(policy.PersistenceMaxAge()); err == nil {
		t.Fatalf("expected bad cell hydration error")
	}
	podSnap, ok := peekNamespacedSnapshot(&plane.podsStore, "app")
	if !ok || len(podSnap.Items) != 1 || podSnap.Items[0].Name != "api-7f" {
		t.Fatalf("hydrated pods after bad cell ok=%v snap=%+v", ok, podSnap)
	}
}

func TestManagerPersistenceEnabledByDefaultOpensCache(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())

	m := NewManager(ManagerConfig{}).(*manager)
	if sp := m.currentPersistence(); sp == nil {
		t.Fatalf("default manager did not open persistence")
	} else {
		t.Cleanup(func() { _ = sp.Close() })
	}

	planeAny, err := m.PlaneForCluster(context.Background(), "ctx")
	if err != nil {
		t.Fatalf("plane for cluster: %v", err)
	}
	plane := planeAny.(*clusterPlane)
	if sp := plane.currentPersistence(); sp == nil {
		t.Fatalf("default plane has no persistence")
	}

	got, err := m.SearchCachedResources(context.Background(), "ctx", "api", 10, 0)
	if err != nil {
		t.Fatalf("search with default persistence: %v", err)
	}
	if got.HasMore || len(got.Items) != 0 {
		t.Fatalf("empty default cache search = %+v", got)
	}
}

func TestManagerDisablesPersistenceWhenMigrationFails(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	cachePath := defaultDataplanePersistencePath()
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o700); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}
	db, err := bolt.Open(cachePath, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		t.Fatalf("open corrupt db: %v", err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		mb, err := tx.CreateBucketIfNotExists(dataplaneMetaBucket)
		if err != nil {
			return err
		}
		return mb.Put(dataplaneSchemaKey, []byte("{broken"))
	}); err != nil {
		_ = db.Close()
		t.Fatalf("seed corrupt schema: %v", err)
	}
	_ = db.Close()

	m := NewManager(ManagerConfig{}).(*manager)
	if sp := m.currentPersistence(); sp != nil {
		t.Fatalf("persistence should be disabled on migration failure")
	}
	if m.Policy().Persistence.Enabled {
		t.Fatalf("policy should disable persistence after migration failure")
	}
	if _, err := m.PlaneForCluster(context.Background(), "ctx"); err != nil {
		t.Fatalf("plane creation should still work without persistence: %v", err)
	}
}

func TestManagerSearchCachedResourcesUsesInMemorySnapshotsWithoutPersistence(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())

	m := NewManager(ManagerConfig{}).(*manager)
	planeAny, err := m.PlaneForCluster(context.Background(), "ctx")
	if err != nil {
		t.Fatalf("plane for cluster: %v", err)
	}
	plane := planeAny.(*clusterPlane)
	now := time.Now().UTC()
	meta := SnapshotMetadata{ObservedAt: now}
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{
		Items: []dto.NamespaceListItemDTO{{Name: "app-prod"}},
		Meta:  meta,
	})
	setNamespacedSnapshot(&plane.podsStore, "app-prod", PodsSnapshot{
		Items: []dto.PodListItemDTO{{
			Name:               "api-7f",
			Namespace:          "app-prod",
			ListHealthHint:     "problem",
			ListStatus:         "CrashLoopBackOff",
			ListSignalSeverity: "high",
			ListSignalCount:    2,
		}},
		Meta: meta,
	})

	got, err := m.SearchCachedResources(context.Background(), "ctx", "app-prod", 10, 0)
	if err != nil {
		t.Fatalf("search namespace from memory: %v", err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("namespace search from memory = %+v", got)
	}
	foundNamespace := false
	foundPodByNamespace := false
	for _, item := range got.Items {
		if item.Kind == string(ResourceKindNamespaces) && item.Name == "app-prod" {
			foundNamespace = true
		}
		if item.Kind == string(ResourceKindPods) && item.Namespace == "app-prod" && item.Name == "api-7f" && item.MatchReason == "namespace" {
			foundPodByNamespace = true
		}
	}
	if !foundNamespace || !foundPodByNamespace {
		t.Fatalf("namespace search from memory = %+v", got)
	}

	got, err = m.SearchCachedResources(context.Background(), "ctx", "API", 10, 0)
	if err != nil {
		t.Fatalf("search pod from memory: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Kind != string(ResourceKindPods) || got.Items[0].Namespace != "app-prod" || got.Items[0].Name != "api-7f" {
		t.Fatalf("pod search from memory = %+v", got)
	}
	if got.Items[0].HealthBucket != "problem" || got.Items[0].SignalSeverity != "high" || got.Items[0].SignalCount != 2 || !got.Items[0].NeedsAttention {
		t.Fatalf("pod search enrichment = %+v", got.Items[0])
	}

	got, err = m.SearchCachedResources(context.Background(), "ctx", "app-prod high", 10, 0)
	if err != nil {
		t.Fatalf("search pod by namespace/signal from memory: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Name != "api-7f" || got.Items[0].MatchReason != "namespace" {
		t.Fatalf("pod search by enriched fields = %+v", got)
	}
}
