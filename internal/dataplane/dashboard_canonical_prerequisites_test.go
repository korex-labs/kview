package dataplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestCanonicalHydratedSelectorPrerequisites(t *testing.T) {
	const ns = "apps"
	m, p, at := canonicalFixture(t, 0, 0, 0, 0)
	meta := p.snapshotMetaHot(at)
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: meta, Items: []dto.NamespaceListItemDTO{{Name: ns}}})
	services := ServicesSnapshot{Meta: meta, Items: []dto.ServiceListItemDTO{{Name: "web", Namespace: ns, Selector: map[string]string{"app": "web"}, EndpointCoverage: "complete"}}}
	pods := PodsSnapshot{Meta: meta, Items: []dto.PodListItemDTO{{Name: "worker", Namespace: ns, UID: "worker-uid", Phase: "Running", Ready: "1/1", LabelsObserved: true, Labels: map[string]string{"app": "other"}}}}
	hydrate := func(kind ResourceKind, snap any) {
		t.Helper()
		payload, err := json.Marshal(snap)
		if err != nil {
			t.Fatal(err)
		}
		if err := p.hydratePersistedNamespacedSnapshot(kind, ns, payload, 0); err != nil {
			t.Fatal(err)
		}
	}
	hydrate(ResourceKindServices, services)
	hydrate(ResourceKindPods, pods)
	hydrated, ok := p.podsStore.getCached(ns)
	if !ok || !hydrated.restoredComplete || hydrated.Items[0].LabelsObserved {
		t.Fatal("expected restored complete LIST without observed labels")
	}
	capture := func() canonicalDashboardProjection {
		return m.canonicalDashboardSignals(p, NamespaceSnapshot{}, nil, NodesSnapshot{}, at)
	}
	restored := capture()
	if e := restored.domainEvidence(ns, "pod_image_pull_failure"); !e.priorComplete || e.known {
		t.Errorf("lost restored image pull comparator: %+v", e)
	}
	for _, rule := range []string{"service_no_matching_cached_pods", "service_no_ready_endpoints"} {
		if e := restored.domainEvidence(ns, rule); e.priorComplete || e.known {
			t.Errorf("%s certified despite missing labels: %+v", rule, e)
		}
	}
	setNamespacedSnapshot(&p.svcsStore, ns, services)
	setNamespacedSnapshot(&p.podsStore, ns, pods)
	fresh := capture()
	if len(restored.items) != 0 || len(fresh.items) != 1 || fresh.items[0].SignalType != "service_no_matching_cached_pods" || !fresh.domainEvidence(ns, fresh.items[0].SignalType).known {
		t.Fatalf("unexpected restored/fresh population: %v / %v", restored.items, fresh.items)
	}
}

func TestCanonicalNodePressureVisibilityGap(t *testing.T) {
	m, p, at := canonicalFixture(t, 0, 0, 0, 1)
	at = at.Truncate(time.Hour).Add(time.Minute)
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "worker-uid", CPUAllocatable: "1"}}})
	store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	}()
	for i, ns := range []string{"space-000", "uncached", "space-000"} {
		now := at.Add(time.Duration(i) * time.Second)
		setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NamespaceListItemDTO{{Name: ns}}})
		setClusterSnapshot(&p.nodeMetricsStore, NodeMetricsSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NodeMetricsDTO{{Name: "worker", CPUMilli: 990}}})
		batch := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", now)
		if err := store.AppendTrends(batch); err != nil {
			t.Fatal(err)
		}
		pt := canonicalQuery(t, store, at)
		wantHigh := 1
		if i == 1 {
			wantHigh = 0
		}
		if pt.Counts == nil || pt.Counts.High != wantHigh || pt.ConfirmedChanges != 0 {
			t.Errorf("step %d: want high=%d and no changes, got %+v counts=%+v", i, wantHigh, pt, pt.Counts)
		}
	}
}
