package dataplane

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func canonicalPublicationDomain(t *testing.T, b localhistory.TrendBatch, namespace, rule string) localhistory.TrendDomain {
	t.Helper()
	for _, d := range b.Domains {
		if d.Namespace == namespace && d.Rule == rule {
			return d
		}
	}
	t.Fatalf("missing domain %s/%s", namespace, rule)
	return localhistory.TrendDomain{}
}

func TestHistoryPublicationsOutsideSnapshotLocks(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), "snapshot_store.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || (fn.Name.Name != "setClusterSnapshot" && fn.Name.Name != "setNamespacedSnapshot") {
			continue
		}
		found++
		statements := fn.Body.List
		if len(statements) < 2 {
			t.Fatal("missing publication boundary")
		}
		last, ok := statements[len(statements)-1].(*ast.ExprStmt)
		if !ok {
			t.Fatal("notify must be top-level after unlock")
		}
		call, ok := last.X.(*ast.CallExpr)
		if !ok {
			t.Fatal("missing notification")
		}
		name, ok := call.Fun.(*ast.Ident)
		if !ok || name.Name != "notifySnapshotPublication" {
			t.Fatal("missing notification")
		}
		prev, ok := statements[len(statements)-2].(*ast.ExprStmt)
		if !ok {
			t.Fatal("missing unlock")
		}
		unlock, ok := prev.X.(*ast.CallExpr)
		if !ok {
			t.Fatal("missing unlock call")
		}
		selector, ok := unlock.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Unlock" {
			t.Fatal("notification under lock")
		}
		mutex, ok := selector.X.(*ast.SelectorExpr)
		if !ok || mutex.Sel.Name != "mu" {
			t.Fatal("wrong mutex")
		}
	}
	if found != 2 {
		t.Fatal("snapshot setters not checked", found)
	}
}

func TestHistoryPublicationsExactLoadedPlaneAndExplicitSubscription(t *testing.T) {
	m := newExplanationTestManager(t) // panics on any client-provider access
	qMissing, releaseMissing, err := m.SubscribeHistoryPublications("missing", "epoch")
	if err != nil || qMissing == nil || len(m.planes) != 0 {
		t.Fatal("pre-plane subscription created a plane", err)
	}
	releaseMissing()
	p := addExplanationTestPlane(m, "synthetic")
	meta := p.snapshotMetaHot(time.Now().UTC())
	setNamespacedSnapshot(&p.podsStore, "ns", PodsSnapshot{Meta: meta})
	if p.historyPublications.Load() != nil {
		t.Fatal("publication implicitly subscribed")
	}
	if _, _, err := m.SubscribeHistoryPublications("synthetic", ""); err == nil {
		t.Fatal("missing epoch accepted")
	}
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch-a")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, _, err := m.SubscribeHistoryPublications("synthetic", "epoch-b"); err == nil {
		t.Fatal("competing subscriber accepted")
	}
	setNamespacedSnapshot(&p.podsStore, "ns", PodsSnapshot{Meta: meta})
	if q.Status().Pending != 1 {
		t.Fatal(q.Status())
	}
	release()
	next, releaseNext, err := m.SubscribeHistoryPublications("synthetic", "epoch-b")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseNext()
	release() // stale teardown must not detach replacement
	setNamespacedSnapshot(&p.podsStore, "ns", PodsSnapshot{Meta: meta})
	if !q.Status().Closed || next.Status().Pending != 1 {
		t.Fatal("old epoch affected successor")
	}
}

func TestHistoryPublicationsOnlySuccessfulObservations(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	meta := p.snapshotMetaHot(time.Now().UTC())
	for _, mutate := range []func(*PodsSnapshot){
		func(s *PodsSnapshot) { s.restored = true },
		func(s *PodsSnapshot) { s.Meta.ObservedAt = time.Time{} },
		func(s *PodsSnapshot) { s.Meta.Freshness = FreshnessClassCold },
		func(s *PodsSnapshot) { s.Meta.Coverage = CoverageClassUnknown },
		func(s *PodsSnapshot) { s.Meta.Completeness = CompletenessClassUnknown },
		func(s *PodsSnapshot) { n := NormalizeError(context.Canceled); s.Err = &n },
	} {
		s := PodsSnapshot{Meta: meta}
		mutate(&s)
		setNamespacedSnapshot(&p.podsStore, "ns", s)
	}
	clearNamespacedSnapshot(&p.podsStore, "ns")
	if q.Status().Pending != 0 {
		t.Fatal("error/restore/cold/clear became observation", q.Status())
	}
	// Dependency publications remain distinct even with identical observation clocks.
	setNamespacedSnapshot(&p.podsStore, "ns", PodsSnapshot{Meta: meta})
	setNamespacedSnapshot(&p.svcsStore, "ns", ServicesSnapshot{Meta: meta})
	setNamespacedSnapshot(&p.cmsStore, "ns", ConfigMapsSnapshot{Meta: meta})
	setNamespacedSnapshot(&p.secsStore, "ns", SecretsSnapshot{Meta: meta})
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: meta})
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: meta})
	setClusterSnapshot(&p.persistentVolumesStore, PersistentVolumesSnapshot{Meta: meta})
	if q.Status().Pending != 7 {
		t.Fatal("dependency update lost", q.Status())
	}
	// Cache-only history reads must not feed publication back into the queue.
	m.HistoryPublicationBatch(context.Background(), localhistory.Publication{Context: "synthetic", Epoch: "epoch"}, meta.ObservedAt)
	if q.Status().Pending != 7 || q.Status().Coalesced != 0 {
		t.Fatal("read publication feedback", q.Status())
	}
}

func TestHistoryPublicationsWorkerCanReadSourceAndEvaluateObservationClock(t *testing.T) {
	m := newExplanationTestManager(t)
	p := addExplanationTestPlane(m, "synthetic")
	q, release, err := m.SubscribeHistoryPublications("synthetic", "epoch")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	// Delayed notification captures the current canonical population at acceptance,
	// never backdates evaluation to the old source clock.
	accepted := time.Now().UTC()
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(accepted), Items: []dto.NamespaceListItemDTO{{Name: "ns"}}})
	at := time.Now().UTC().Add(-20 * time.Minute)
	setNamespacedSnapshot(&p.cmsStore, "ns", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.ConfigMapDTO{{Name: "empty", Namespace: "ns"}}})
	got := make(chan localhistory.TrendBatch, 1)
	done := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		done <- q.Run(ctx, time.Millisecond, func(ctx context.Context, event localhistory.Publication) {
			// Acquiring source locks and evaluating here must not deadlock publication.
			_, _ = peekNamespacedSnapshot(&p.cmsStore, event.Namespace)
			got <- m.HistoryPublicationBatch(ctx, event, accepted)
		})
	}()
	select {
	case b := <-got:
		d := canonicalPublicationDomain(t, b, "ns", "empty_configmap")
		if !d.Complete || !d.TransitionsUnknown || d.SourceStatus != "source-stale" || len(d.Signals) != 1 || !d.SourceAt.Equal(at) || !b.At.Equal(accepted) {
			t.Fatalf("lost historical evidence: %+v", d)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("publication worker deadlocked")
	}
	current := m.HistoryPublicationBatch(context.Background(), localhistory.Publication{Context: "synthetic", Epoch: "epoch"}, time.Now().UTC())
	if !canonicalPublicationDomain(t, current, "ns", "empty_configmap").TransitionsUnknown {
		t.Fatal("historical observation invented current freshness")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not join")
	}
}
