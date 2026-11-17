package dataplane

import (
	"fmt"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"testing"
	"time"
)

func TestHistoryInventoryPublishedCacheOnly(t *testing.T) {
	m := newExplanationTestManager(t)
	if got := m.HistoryInventory("synthetic"); len(got.Nodes) != 0 || len(m.planes) != 0 {
		t.Fatal("created missing plane", got)
	}
	p := addExplanationTestPlane(m, "synthetic")
	meta := SnapshotMetadata{ObservedAt: time.Now()}
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: meta, Items: []dto.NodeListItemDTO{{Name: "worker", UID: "uid-current"}, {Name: "legacy"}, {Name: "guessed", UID: "guessed", Derived: true}}})
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: meta, Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	got := m.HistoryInventory("synthetic")
	if len(got.Nodes) != 1 || got.Nodes[0].Key != localhistory.TrendNodeKey("worker", "uid-current") || len(got.Namespaces) != 1 {
		t.Fatal(got)
	}
	if len(m.HistoryInventory("synthetic-other").Nodes) != 0 || len(m.planes) != 1 {
		t.Fatal("context leak or plane creation")
	}
	p.persistHydrating.Store(true)
	if len(m.HistoryInventory("synthetic").Nodes) != 0 {
		t.Fatal("exposed partial hydration")
	}
	p.persistHydrating.Store(false)
	if !p.nodesStore.snap.Meta.ObservedAt.Equal(meta.ObservedAt) {
		t.Fatal("read mutated snapshot")
	}
}
func TestHistoryInventoryBounded(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	rows := make([]dto.NodeListItemDTO, localhistory.TrendCatalogLimit+1)
	for i := range rows {
		rows[i] = dto.NodeListItemDTO{Name: fmt.Sprintf("worker-%05d", i), UID: fmt.Sprint(i)}
	}
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Now()}, Items: rows})
	got := m.HistoryInventory("synthetic")
	if len(got.Nodes) != localhistory.TrendCatalogLimit || !got.Truncated {
		t.Fatal("unbounded catalog", len(got.Nodes), got.Truncated)
	}
}
