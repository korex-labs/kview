package dataplane

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestHistoryPublicationsPrePlaneAndSubsequentPlaneBinding(t *testing.T) {
	m := newExplanationTestManager(t)
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if len(m.planes) != 0 || len(m.planeInit) != 0 {
		t.Fatal("subscription created or hydrated plane")
	}
	plane, err := m.PlaneForCluster(context.Background(), "synthetic")
	if err != nil {
		t.Fatal(err)
	}
	p := plane.(*clusterPlane)
	if p.historyPublications.Load() != q {
		t.Fatal("new plane missed binding")
	}
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC())})
	if q.Status().Pending != 1 {
		t.Fatal("new plane publication not captured", q.Status())
	}
	release()
	next, releaseNext, err := m.SubscribeHistoryPublications("synthetic", "epoch-next")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseNext()
	release()
	if p.historyPublications.Load() != next {
		t.Fatal("late release detached replacement")
	}
}
func TestHistoryPublicationsEvaluateActualSnapshotNotOldNotification(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	at := time.Now().UTC().Add(-time.Second)
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.ConfigMapDTO{{Name: "empty", Namespace: "apps"}}})
	old, _ := peekNamespacedSnapshot(&p.cmsStore, "apps")
	event := localhistory.Publication{Context: "synthetic", Epoch: "epoch", Namespace: "apps", Kind: string(ResourceKindConfigMaps), Revision: old.Meta.Revision, ObservedAt: at}
	now := time.Now().UTC()
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(now)})
	b := m.HistoryPublicationBatch(context.Background(), event, now)
	d := canonicalPublicationDomain(t, b, "apps", "empty_configmap")
	if !d.SourceAt.Equal(now) || !b.At.Equal(now) || len(d.Signals) != 0 || d.TransitionsUnknown {
		t.Fatalf("retroactive evidence: %+v / %+v", d, b.Diagnostics)
	}
	clearNamespacedSnapshot(&p.cmsStore, "apps")
	b = m.HistoryPublicationBatch(context.Background(), event, now)
	if d = canonicalPublicationDomain(t, b, "", "empty_configmap"); !d.TransitionsUnknown || b.Diagnostics.Reasons["dashboard-population-partial"] != 1 {
		t.Fatal("invalidated source fabricated healing", d)
	}
}
func TestHistoryPublicationsEvidenceDelayAndRestorationAreUnknown(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	at := time.Now().UTC().Add(-20 * time.Minute)
	for _, restored := range []bool{false, true} {
		setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(at), restored: restored, Items: []dto.ConfigMapDTO{{Name: "empty", Namespace: "apps"}}})
		snap, _ := peekNamespacedSnapshot(&p.cmsStore, "apps")
		e := localhistory.Publication{Context: "synthetic", Epoch: "epoch", Namespace: "apps", Kind: string(ResourceKindConfigMaps), Revision: snap.Meta.Revision, ObservedAt: at}
		b := m.HistoryPublicationBatch(context.Background(), e, time.Now().UTC())
		if d := canonicalPublicationDomain(t, b, "apps", "empty_configmap"); !d.CachedPopulation || !d.TransitionsUnknown || len(d.Signals) != 1 {
			t.Fatal("delayed/restored event proved healthy", d)
		}
	}
}
func TestHistoryPublicationsConcurrentReleaseAndLateSource(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC())})
			}
		}()
	}
	release()
	wg.Wait()
	if !q.Status().Closed || p.historyPublications.Load() != nil {
		t.Fatal("late source revived closed subscription")
	}
}
func TestHistoryPublicationsActualSourceCapturedBeforeMaintenance(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	done := make(chan error, 1)
	got := make(chan localhistory.TrendBatch, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		done <- q.Run(ctx, time.Millisecond, func(ctx context.Context, e localhistory.Publication) {
			got <- m.HistoryPublicationBatch(ctx, e, time.Now().UTC())
		})
	}()
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.ConfigMapDTO{{Name: "empty", Namespace: "apps"}}})
	select {
	case b := <-got:
		var d localhistory.TrendDomain
		for _, candidate := range b.Domains {
			if candidate.Rule == "empty_configmap" && candidate.Namespace == "apps" {
				d = candidate
			}
		}
		if !d.Complete || len(d.Signals) != 1 {
			t.Fatal(d)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("publication waited for fifteen-minute poll")
	}
	release()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("worker not joined")
	}
}
