package dataplane

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestCanonicalTransitionsUnrelatedMissingSources(t *testing.T) {
	m, p, at := canonicalFixture(t, 0, 0, 0, 1)
	at = at.Truncate(time.Hour).Add(10 * time.Minute)
	store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	pod := func(name string) dto.PodListItemDTO {
		return dto.PodListItemDTO{Name: name, UID: "uid-" + name, Namespace: "space-000", Phase: "Running", Ready: "1/1", ContainerWaitingReasons: []string{"ImagePullBackOff"}}
	}
	appendAt := func(now time.Time, pods ...dto.PodListItemDTO) localhistory.TrendBatch {
		setNamespacedSnapshot(&p.podsStore, "space-000", PodsSnapshot{Meta: p.snapshotMetaHot(now), Items: pods})
		b := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", now)
		if err := store.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
		return b
	}
	first := appendAt(at, pod("a"), pod("steady"))
	if got := canonicalQuery(t, store, at).ConfirmedChanges; got != 0 {
		t.Fatal("baseline events", got)
	}
	next := appendAt(at.Add(time.Second), pod("b"), pod("steady"))
	if next.Policy != first.Policy {
		t.Fatal("publication rebased policy")
	}
	if got := canonicalQuery(t, store, at).ConfirmedChanges; got != 2 {
		t.Fatalf("new+resolved with unrelated missing dependencies: got %d want 2", got)
	}
	appendAt(at.Add(2 * time.Second))
	if got := canonicalQuery(t, store, at).ConfirmedChanges; got != 4 {
		t.Fatalf("last signal disappearance: got %d want 4", got)
	}
	q := localhistory.TrendQuery{Context: "contextA", From: at.Truncate(time.Hour), To: at.Truncate(time.Hour).Add(time.Hour), AsOf: at.Add(10 * time.Second), RulesMode: "topChanges10", NamespacesMode: "topChanges10"}
	out, err := store.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Rules) == 0 || out.Rules[0].Key != "pod_image_pull_failure" || out.Rules[0].ChangesScore != 6 || len(out.Namespaces) == 0 || out.Namespaces[0].ChangesScore != 6 {
		t.Fatalf("persisted TopChanges lost confirmed changes: %+v", out)
	}
}

func TestCanonicalTransitionSeverityAlongsideUnknownIdentity(t *testing.T) {
	at := time.Now().UTC().Truncate(time.Hour).Add(time.Minute)
	p := canonicalDashboardProjection{at: at, policy: "fixed", revision: "a", sourceAt: at, coverage: "complete", namespaces: []string{"apps"}, identities: map[string]string{canonicalKey("apps", "Pod", "known"): "uid-known"}}
	p.items = []ClusterDashboardSignal{{Namespace: "apps", Scope: "namespace", ResourceKind: "Pod", ResourceName: "known", SignalType: "pod_restarts", HistoryKey: "known", Severity: "medium"}, {Namespace: "apps", Scope: "namespace", ResourceKind: "Pod", ResourceName: "unknown", SignalType: "pod_restarts", HistoryKey: "unknown", Severity: "low"}}
	store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	p.sources = map[string]canonicalSourceEvidence{canonicalKey("apps", "Pod"): {at: at, known: true, generation: "first"}}
	first := p.historyBatch("contextA", "epoch")
	if err = store.AppendTrends(first); err != nil {
		t.Fatal(err)
	}
	p.at = at.Add(time.Second)
	p.revision = "b"
	p.sources[canonicalKey("apps", "Pod")] = canonicalSourceEvidence{at: p.at, known: true, generation: "second"}
	p.items[0].Severity = "high"
	next := p.historyBatch("contextA", "epoch")
	if err = store.AppendTrends(next); err != nil {
		t.Fatal(err)
	}
	if got := canonicalQuery(t, store, at).ConfirmedChanges; got != 1 {
		t.Fatalf("known UID severity change erased by unrelated unknown identity: %d", got)
	}
	// Losing the known resource's own UID must not manufacture a resolution
	// and appearance, while its active contribution remains visible.
	delete(p.identities, canonicalKey("apps", "Pod", "known"))
	p.at = at.Add(2 * time.Second)
	if err = store.AppendTrends(p.historyBatch("contextA", "epoch")); err != nil {
		t.Fatal(err)
	}
	point := canonicalQuery(t, store, at)
	if point.ConfirmedChanges != 1 || point.Counts == nil || point.Counts.High != 1 || point.Counts.Low != 1 {
		t.Fatal("UID loss fabricated events or erased active counts", point)
	}
}

func TestCanonicalAbsentDomainSnooze(t *testing.T) {
	for _, reason := range []string{"source-missing", "policy-rebase"} {
		t.Run(reason, func(t *testing.T) {
			const ns, rule = "space-000", "pod_image_pull_failure"
			m, p, at := canonicalFixture(t, 0, 0, 0, 1)
			path := filepath.Join(t.TempDir(), "history.db")
			open := func() *localhistory.Store {
				s, err := localhistory.OpenReal(path, 30)
				if err != nil {
					t.Fatal(err)
				}
				return s
			}
			s := open()
			defer func() {
				if err := s.Close(); err != nil {
					t.Error(err)
				}
			}()
			snooze := func(name string) {
				if _, err := m.suppressSignalAt("contextA", SignalSuppressionRequest{HistoryKey: rule + "|namespace|" + ns + "|Pod|" + name, Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600}, at); err != nil {
					t.Fatal(err)
				}
			}
			snooze("snoozed")
			setNamespacedSnapshot(&p.podsStore, ns, PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.PodListItemDTO{{Name: "visible", UID: "uid", Namespace: ns, Phase: "Running", Ready: "1/1", ContainerWaitingReasons: []string{"ImagePullBackOff"}}}})
			appendAt := func(now time.Time) {
				if err := s.AppendTrends(m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", now)); err != nil {
					t.Fatal(err)
				}
			}
			appendAt(at)
			if reason == "policy-rebase" {
				snooze("visible")
			}
			setNamespacedSnapshot(&p.podsStore, ns, PodsSnapshot{})
			appendAt(at.Add(time.Second))
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s = open()
			if point := canonicalQuery(t, s, at); point.ConfirmedChanges != 0 {
				t.Fatal("fabricated change", point)
			}
			out, err := s.QueryTrends(localhistory.TrendQuery{Context: "contextA", From: at.Truncate(time.Hour), To: at.Truncate(time.Hour).Add(time.Hour), AsOf: at.Add(time.Minute), TransitionDetails: true})
			if err != nil {
				t.Fatal(err)
			}
			for _, hour := range out.TransitionHours {
				for _, ex := range hour.Examples {
					if ex.Namespace == ns && ex.Rule == rule && ex.Candidate == "disappearance-candidate" {
						if ex.Reason != reason || ex.PolicyChanged != (reason == "policy-rebase") {
							t.Fatal("wrong persisted rejection", ex)
						}
						return
					}
				}
			}
			t.Fatal("missing persisted disappearance rejection", out.TransitionHours)
		})
	}
}

func TestCanonicalTransitionsMissingOwnSourceCannotResolve(t *testing.T) {
	for _, sourceState := range []string{"missing", "stale"} {
		t.Run(sourceState, func(t *testing.T) {
			m, p, at := canonicalFixture(t, 0, 0, 0, 1)
			at = at.Truncate(time.Hour).Add(10 * time.Minute)
			store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := store.Close(); err != nil {
					t.Error(err)
				}
			})
			setNamespacedSnapshot(&p.podsStore, "space-000", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.PodListItemDTO{{Name: "known", UID: "uid-known", Namespace: "space-000", Phase: "Running", Ready: "1/1", ContainerWaitingReasons: []string{"ImagePullBackOff"}}}})
			if err = store.AppendTrends(m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at)); err != nil {
				t.Fatal(err)
			}
			meta := p.snapshotMetaHot(at.Add(-time.Hour))
			if sourceState == "missing" {
				meta.ObservedAt = time.Time{}
			}
			setNamespacedSnapshot(&p.podsStore, "space-000", PodsSnapshot{Meta: meta})
			if err = store.AppendTrends(m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at.Add(time.Second))); err != nil {
				t.Fatal(err)
			}
			point := canonicalQuery(t, store, at)
			if point.ConfirmedChanges != 0 || point.ChangesCoverage == "complete" {
				t.Fatal("unknown own source fabricated confirmed resolution", point)
			}
		})
	}
}
