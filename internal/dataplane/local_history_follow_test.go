package dataplane

import (
	"reflect"
	"testing"
)

func TestNamespaceEnrichmentEffectiveEligibility(t *testing.T) {
	inventory := []string{"synthetic-focus", "synthetic-recent", "synthetic-favorite", "synthetic-idle", "default", "kube-system", "openshift-synthetic"}
	hints := NamespaceEnrichHints{Focus: "synthetic-focus", Recent: []string{"synthetic-recent", "absent"}, Favorite: map[string]struct{}{"synthetic-favorite": {}, "absent": {}}}
	p := DefaultDataplanePolicy().NamespaceEnrichment
	p.IncludeFocus = true
	p.IncludeRecent = true
	p.IncludeFavourites = true
	p.RecentLimit = 2
	p.FavouriteLimit = 10
	if got := effectiveNamespaceEnrichmentNames(inventory, hints, p); !reflect.DeepEqual(got, []string{"synthetic-focus", "synthetic-favorite", "synthetic-recent"}) {
		t.Fatal(got)
	}
	p.Sweep.Enabled = true
	p.Sweep.MaxNamespacesPerCycle = 1
	p.Sweep.MaxNamespacesPerHour = 1
	if got := effectiveNamespaceEnrichmentNames(inventory, hints, p); !reflect.DeepEqual(got, []string{"synthetic-focus", "synthetic-favorite", "synthetic-recent", "synthetic-idle"}) {
		t.Fatal("followed batch or included system", got)
	}
	hints.Focus = "kube-system"
	got := effectiveNamespaceEnrichmentNames(inventory, hints, p)
	if got[0] != "kube-system" {
		t.Fatal("system exclusion applied globally", got)
	}
	p.IncludeFocus = false
	p.IncludeRecent = false
	p.IncludeFavourites = false
	if got = effectiveNamespaceEnrichmentNames(inventory, hints, p); len(got) != 4 {
		t.Fatal(got)
	}
	p.Sweep.IncludeSystemNamespaces = true
	if got = effectiveNamespaceEnrichmentNames(inventory, hints, p); len(got) != len(inventory) {
		t.Fatal(got)
	}
	p.Enabled = false
	if got = effectiveNamespaceEnrichmentNames(inventory, hints, p); len(got) != 0 {
		t.Fatal(got)
	}
	// Favourite limit must be stable across independent scheduler reads.
	p = DefaultDataplanePolicy().NamespaceEnrichment
	p.IncludeFavourites = true
	p.FavouriteLimit = 1
	hints = NamespaceEnrichHints{Favorite: map[string]struct{}{"synthetic-b": {}, "synthetic-a": {}}}
	for i := 0; i < 100; i++ {
		if got = effectiveNamespaceEnrichmentNames([]string{"synthetic-b", "synthetic-a"}, hints, p); !reflect.DeepEqual(got, []string{"synthetic-a"}) {
			t.Fatal(got)
		}
	}
}
