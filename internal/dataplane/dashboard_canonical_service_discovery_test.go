package dataplane

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestCanonicalServiceSelectorDiscovery(t *testing.T) {
	const ns, rule = "apps", "service_no_matching_cached_pods"
	for _, initial := range []string{"unobserved-labels", "stale-positive"} {
		t.Run(initial, func(t *testing.T) {
			m, p, at := canonicalFixture(t, 0, 0, 0, 0)
			at = at.Truncate(time.Hour)
			store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := store.Close(); err != nil {
					t.Error(err)
				}
			}()
			publish := func(now time.Time, live bool) {
				meta := p.snapshotMetaHot(now)
				setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: meta, Items: []dto.NamespaceListItemDTO{{Name: ns}}})
				services := ServicesSnapshot{Meta: meta}
				names := []string{"existing"}
				if live {
					names = append(names, "new")
				}
				for _, name := range names {
					services.Items = append(services.Items, dto.ServiceListItemDTO{Name: name, Namespace: ns, Selector: map[string]string{"app": "web"}, EndpointCoverage: "complete"})
					services.Relationships = append(services.Relationships, testResourceMapRecord(resourceMapIdentity("", "v1", "services", "Service", ns, name, name+"-uid")))
				}
				services.RelationshipMetadata = completeResourceMapRelationshipMetadata(len(names), len(names))
				setNamespacedSnapshot(&p.svcsStore, ns, services)
				if !live && initial == "stale-positive" {
					meta = p.snapshotMetaHot(now.Add(-2 * time.Hour))
					meta.Freshness = FreshnessClassStale
				}
				setNamespacedSnapshot(&p.podsStore, ns, PodsSnapshot{Meta: meta, Items: []dto.PodListItemDTO{{Name: "worker", UID: "worker-uid", Namespace: ns, Phase: "Running", Ready: "1/1", LabelsObserved: live || initial == "stale-positive", Labels: map[string]string{"app": "other"}}}})
			}
			// The last capture replays the same source generations.
			for i, offset := range []time.Duration{0, time.Hour, time.Hour + time.Second} {
				now := at.Add(offset)
				if i < 2 {
					publish(now, i == 1)
				}
				b := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", now)
				rows := 0
				for _, d := range b.Domains {
					if d.Namespace == ns && d.Rule == rule {
						rows = len(d.Signals)
						if (i == 0) != d.TransitionsUnknown {
							t.Fatalf("step %d evidence %+v", i, d)
						}
						for _, s := range d.Signals {
							if !s.IdentityKnown {
								t.Fatal("missing fixture Service UID", s)
							}
						}
					}
				}
				wantRows := 2
				if i == 0 {
					wantRows = 0
					if initial == "stale-positive" {
						wantRows = 1
					}
				}
				if rows != wantRows {
					t.Fatalf("step %d: got %d Service identities, want %d", i, rows, wantRows)
				}
				if err := store.AppendTrends(b); err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					continue
				}
				out, err := store.QueryTrends(localhistory.TrendQuery{Context: "contextA", From: at.Add(time.Hour), To: at.Add(2 * time.Hour), AsOf: now.Add(time.Second), RulesMode: "custom", Rules: []string{rule}, TransitionDetails: true})
				if err != nil {
					t.Fatal(err)
				}
				if len(out.Rules) != 1 || len(out.Rules[0].Points) != 1 || len(out.TransitionHours) != 1 || out.TransitionHours[0].Incomplete {
					t.Fatal("missing complete rule/hour evidence", out)
				}
				pt := out.Rules[0].Points[0]
				want := 2
				if initial == "stale-positive" {
					want = 1
				}
				if pt.FirstSeen != want || pt.ConfirmedChanges != 0 {
					t.Errorf("step %d firstSeen=%d changes=%d; want %d/0", i, pt.FirstSeen, pt.ConfirmedChanges, want)
				}
				for _, g := range out.TransitionHours[0].Groups {
					if g.Namespace == ns && g.Rule == rule {
						t.Errorf("step %d rejected Service observation: %v", i, g.Reasons)
					}
				}
			}
		})
	}
}
