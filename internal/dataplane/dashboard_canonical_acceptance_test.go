package dataplane

import (
	"context"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestDashboardCanonicalCapturedProjectionConsumersAndEmptyPopulation(t *testing.T) {
	m, p, at := canonicalFixture(t, 3, 2, 1, 2)
	// An expired record must not be pruned/loaded by a projection read.
	records := map[string]SignalSuppressionRecord{"expired": {Mode: SignalSuppressionModeSnooze, ExpiresAt: at.Add(-time.Hour).Unix(), FingerprintVersion: 1}}
	m.signalSuppressions["contextA"] = records
	before := canonicalHash(records)
	ns, _ := peekClusterSnapshot(&p.nsStore)
	nodes, _ := peekClusterSnapshot(&p.nodesStore)
	projection := m.canonicalDashboardSignals(p, ns, nil, nodes, at)
	captured := canonicalHash(projection.items)
	// Change caches AFTER capture. Both pure consumers must keep the old generation.
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(at.Add(time.Second))})
	panel := projection.dashboardSummary(1, ClusterDashboardListOptions{SignalsLimit: 1})
	path := filepath.Join(t.TempDir(), "history.db")
	store, err := localhistory.OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.AppendTrends(projection.historyBatch("contextA", "epoch")); err != nil {
		t.Fatal(err)
	}
	point := canonicalQuery(t, store, at)
	if point.Counts == nil || point.Counts.High != panel.High || point.Counts.Medium != panel.Medium || point.Counts.Low != panel.Low || panel.High != 3 {
		t.Fatalf("same captured generation mismatch: %+v %+v", panel, point)
	}
	if len(panel.Top) > 1 {
		t.Fatal("presentation limit ignored")
	}
	if before != canonicalHash(records) || captured != canonicalHash(projection.items) || len(m.signalHistory) != 0 {
		t.Fatal("read mutated source/recurrence")
	}
	empty := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at.Add(time.Second))
	if err = store.AppendTrends(empty); err != nil {
		t.Fatal(err)
	}
	point = canonicalQuery(t, store, at)
	if point.Counts == nil || point.Counts.High != 0 || point.Counts.Medium != 0 || point.Counts.Low != 0 || point.ConfirmedChanges != 0 {
		t.Fatal("empty population retained counts or invented deletion", point)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = localhistory.OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	restored := canonicalQuery(t, store, at)
	if !reflect.DeepEqual(point, restored) {
		t.Fatal("reopen changed canonical point", point, restored)
	}
	clearClusterSnapshot(&p.nsStore)
	missing := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at.Add(2*time.Second))
	if missing.Diagnostics.Reasons["dashboard-population-partial"] != 1 {
		t.Fatal("missing inventory claimed complete")
	}
	if err = store.AppendTrends(missing); err != nil {
		t.Fatal(err)
	}
	if p := canonicalQuery(t, store, at); p.Coverage == "complete" || p.ConfirmedChanges != 0 {
		t.Fatal("source gap became complete", p)
	}
}

func TestDashboardCanonicalConcurrentCapturedSnapshots(t *testing.T) {
	m, p, at := canonicalFixture(t, 1, 0, 0, 1)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			setNamespacedSnapshot(&p.podsStore, "space-000", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.PodListItemDTO{{Name: "worker", Namespace: "space-000", Phase: "Running", Ready: "1/1"}}})
		}
	}()
	for i := 0; i < 30; i++ {
		view := captureCanonicalPlane(p)
		snapshot, _ := peekNamespacedSnapshot(&view.podsStore, "space-000")
		_ = m.canonicalDashboardSignals(p, NamespaceSnapshot{}, nil, NodesSnapshot{}, at)
		after, _ := peekNamespacedSnapshot(&view.podsStore, "space-000")
		if snapshot.Meta.Revision != after.Meta.Revision {
			t.Fatal("captured generation changed")
		}
	}
	wg.Wait()
}
