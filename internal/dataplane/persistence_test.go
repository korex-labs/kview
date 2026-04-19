package dataplane

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
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
	defer store.Close()

	observed := time.Now().UTC().Add(-time.Minute)
	snap := PodsSnapshot{
		Items: []dto.PodListItemDTO{{Name: "api-7f", Namespace: "app"}},
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
	if len(rows) != 1 || rows[0].Name != "api-7f" || rows[0].Namespace != "app" {
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
}

func TestBoltSnapshotPersistenceSearchPrioritizesKindsAndOffsets(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer store.Close()

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

func TestExecuteNamespacedSnapshotUsesPersistedFallbackOnLiveFailure(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer store.Close()

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
		Items: []dto.PodListItemDTO{{Name: "api-7f", Namespace: "app-prod"}},
		Meta:  meta,
	})

	got, err := m.SearchCachedResources(context.Background(), "ctx", "app-prod", 10, 0)
	if err != nil {
		t.Fatalf("search namespace from memory: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Kind != string(ResourceKindNamespaces) || got.Items[0].Name != "app-prod" {
		t.Fatalf("namespace search from memory = %+v", got)
	}

	got, err = m.SearchCachedResources(context.Background(), "ctx", "API", 10, 0)
	if err != nil {
		t.Fatalf("search pod from memory: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Kind != string(ResourceKindPods) || got.Items[0].Namespace != "app-prod" || got.Items[0].Name != "api-7f" {
		t.Fatalf("pod search from memory = %+v", got)
	}
}
