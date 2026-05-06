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
