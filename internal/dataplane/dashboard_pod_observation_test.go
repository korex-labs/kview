package dataplane

import (
	"context"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"path/filepath"
	"testing"
	"time"
)

func TestImagePullObservationLoss(t *testing.T) {
	for _, tc := range []struct {
		name, membership, catalog, pods string
		present                         bool
	}{
		{"catalog-omitted", "absent", "available", "available", true},
		{"catalog-failed", "unknown", "source-error", "available", true},
		{"pod-cleared", "listed", "available", "source-missing", false},
		{"bootstrap", "listed", "available", "source-missing", false},
		{"never-usable", "listed", "available", "source-missing", true},
		{"healthy-control", "listed", "available", "available", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const rule = "pod_image_pull_failure"
			m := newExplanationTestManager(t)
			p := addExplanationTestPlane(m, "synthetic")
			at := time.Now().UTC().Truncate(time.Hour)
			first := at
			path := filepath.Join(t.TempDir(), "history.db")
			open := func() *localhistory.Store {
				t.Helper()
				s, e := localhistory.OpenReal(path, 30)
				if e != nil {
					t.Fatal(e)
				}
				return s
			}
			s := open()
			catalog := func(listed, failed bool) {
				snap := NamespaceSnapshot{Meta: p.snapshotMetaHot(at)}
				if listed {
					snap.Items = []dto.NamespaceListItemDTO{{Name: "apps"}}
				}
				if failed {
					snap.Err = &NormalizedError{Class: NormalizedErrorClassAccessDenied}
				}
				setClusterSnapshot(&p.nsStore, snap)
			}
			pod := func(fail bool) {
				v := dto.PodListItemDTO{Namespace: "apps", Name: "stable", UID: "pod-id", Phase: "Running", Ready: "1/1", AgeSec: 864000}
				if fail {
					v.ContainerWaitingReasons = []string{"ImagePullBackOff"}
				}
				setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.PodListItemDTO{v}})
			}
			appendBatch := func() {
				t.Helper()
				b := m.canonicalHistoryBatch(context.Background(), "synthetic", "epoch", at)
				if e := s.AppendTrends(b); e != nil {
					t.Fatal(e)
				}
			}
			catalog(true, false)
			if tc.name != "bootstrap" && tc.name != "never-usable" {
				pod(false)
			} else if tc.present {
				setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{})
			}
			appendBatch()
			at = at.Add(time.Minute)
			loss := at
			switch tc.name {
			case "catalog-omitted", "catalog-failed":
				catalog(false, tc.name == "catalog-failed")
			case "pod-cleared":
				clearNamespacedSnapshot(&p.podsStore, "apps")
			case "bootstrap", "never-usable":
				loss = first
			}
			appendBatch()
			at = at.Add(time.Minute)
			appendBatch() // repeated projection must not move the gap onset
			if e := s.Close(); e != nil {
				t.Fatal(e)
			}
			s = open()
			at = at.Add(time.Minute)
			catalog(true, false)
			pod(true)
			appendBatch()
			if e := s.Close(); e != nil {
				t.Fatal(e)
			}
			s = open()
			defer func() {
				if err := s.Close(); err != nil {
					t.Errorf("close history store: %v", err)
				}
			}()
			q := localhistory.TrendQuery{Context: "synthetic", From: first, To: first.Add(time.Hour), AsOf: at, TransitionDetails: true, RulesMode: "custom", Rules: []string{rule}}
			out, e := s.QueryTrends(q)
			if e != nil {
				t.Fatal(e)
			}
			if len(out.Rules) != 1 || out.Rules[0].Points[0].Counts.High != 1 {
				t.Fatal("missing active failure")
			}
			changes := out.Rules[0].Points[0].ConfirmedChanges
			if tc.name != "bootstrap" && tc.name != "never-usable" {
				if changes != 1 || out.Rules[0].Points[0].Counts.FirstSeen != 0 {
					t.Fatal("lost confirmed appearance", changes)
				}
				return
			}
			if changes != 0 || out.Rules[0].Points[0].Counts.FirstSeen != 1 {
				t.Fatal("spurious event", changes)
			}
			for _, h := range out.TransitionHours {
				for _, r := range h.Examples {
					if r.Rule != rule {
						continue
					}
					o, n := r.Old.PodObservation, r.New.PodObservation
					if o == nil || n == nil || o.FirstRetainedGap == nil {
						t.Fatal("missing projection evidence", r)
					}
					if bootstrap := tc.name == "bootstrap" || tc.name == "never-usable"; bootstrap != (o.BeforeGap == nil) {
						t.Fatal("invented or lost preceding baseline", o)
					}
					if o.BeforeGap != nil && (o.BeforeGap.Domain != "available" || !o.BeforeGap.DomainAt.Equal(first)) {
						t.Fatal("wrong pre-loss domain", o.BeforeGap)
					}
					g := o.FirstRetainedGap
					if !g.At.Equal(loss) || !o.At.Equal(at.Add(-time.Minute)) || g.Membership != tc.membership || g.Catalog.Status != tc.catalog || g.Catalog.Revision == 0 || g.PodsPresent != tc.present || g.Pods.Status != tc.pods || g.Domain != "omitted" || !g.DomainAt.IsZero() || n.Domain != "available" || !n.DomainAt.Equal(at) || n.Membership != "listed" || n.FirstRetainedGap != nil {
						t.Fatalf("unexpected retained capture: gap=%+v previous=%+v new=%+v", g, o, n)
					}
					return
				}
			}
			t.Fatal("missing durable rejection")
		})
	}
}
