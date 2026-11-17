package dataplane

import (
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"reflect"
	"testing"
	"time"
)

func TestHistoryNamespacesCacheOnlyExactContext(t *testing.T) {
	// This manager's client provider panics on any Kubernetes client resolution.
	m := newExplanationTestManager(t)
	if got := m.HistoryNamespaces("synthetic-a"); len(got) != 0 || len(m.planes) != 0 {
		t.Fatal("created unloaded plane", got)
	}
	p := addExplanationTestPlane(m, "synthetic-a")
	other := addExplanationTestPlane(m, "synthetic-b")
	meta := SnapshotMetadata{ObservedAt: time.Now(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Completeness: CompletenessClassComplete}
	p.nsStore.snap = NamespaceSnapshot{Meta: meta, Items: []dto.NamespaceListItemDTO{{Name: "synthetic-apps"}}}
	other.nsStore.snap = NamespaceSnapshot{Meta: meta, Items: []dto.NamespaceListItemDTO{{Name: "other-apps"}}}
	original := p.nsStore.snap
	if got := m.HistoryNamespaces("synthetic-a"); !reflect.DeepEqual(got, []string{"synthetic-apps"}) {
		t.Fatal(got)
	}
	if !reflect.DeepEqual(original, p.nsStore.snap) || len(m.planes) != 2 || len(m.signalHistory) != 0 || len(m.signalSuppressions) != 0 {
		t.Fatal("read mutated state")
	}
	for _, state := range []string{"hydrating", "restored", "stale", "denied", "partial", "oversize"} {
		p.nsStore.snap = original
		p.persistHydrating.Store(false)
		switch state {
		case "hydrating":
			p.persistHydrating.Store(true)
		case "restored":
			p.nsStore.snap.restored = true
		case "stale":
			p.nsStore.snap.Meta.ObservedAt = time.Now().Add(-time.Hour)
		case "denied":
			p.nsStore.snap.Err = &NormalizedError{Class: NormalizedErrorClassAccessDenied}
		case "partial":
			p.nsStore.snap.Meta.Coverage = CoverageClassPartial
		case "oversize":
			p.nsStore.snap.Items = make([]dto.NamespaceListItemDTO, historyMaxMetricWork+1)
		}
		if got := m.HistoryNamespaces("synthetic-a"); len(got) != 0 {
			t.Fatal(state, got)
		}
	}
}
