package dataplane

import (
	"context"
	"errors"
	"testing"

	"kview/internal/cluster"
	"kview/internal/kube/dto"
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

func TestNamespaceEnrichSessionUpdateBaseRowsKeepsEnrichedFields(t *testing.T) {
	sess := &nsEnrichSession{
		order: []string{"default"},
		merged: map[string]dto.NamespaceListItemDTO{
			"default": {
				Name:             "default",
				Phase:            "Active",
				RowEnriched:      true,
				SummaryState:     "ok",
				PodCount:         3,
				DeploymentCount:  1,
				ProblematicCount: 0,
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

func TestNamespaceEnrichActivityIDIsStableAndSafe(t *testing.T) {
	if got, want := namespaceEnrichActivityID("kind-dev/admin@cluster"), "ns-enrich-kind-dev-admin-cluster"; got != want {
		t.Fatalf("activity id: got %q want %q", got, want)
	}
	if got, want := namespaceEnrichActivityID("kind-dev/admin@cluster"), namespaceEnrichActivityID("kind-dev/admin@cluster"); got != want {
		t.Fatalf("activity id should be stable, got %q and %q", got, want)
	}
}
