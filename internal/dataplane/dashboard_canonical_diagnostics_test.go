package dataplane

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestCanonicalPublicationTransitionDiagnostics(t *testing.T) {
	for _, scenario := range []struct{ name, reason string }{
		{"missing-uid", "missing-uid"}, {"lost-uid", "missing-uid"}, {"stale", "source-stale"}, {"partial", "source-partial"}, {"error", "source-error"}, {"missing-source", "source-missing"}, {"stale-empty", "source-stale"}, {"policy", "policy-rebase"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			m := newExplanationTestManager(t)
			p := addExplanationTestPlane(m, "synthetic")
			now := time.Now().UTC()
			setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
			setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "node-uid"}}})
			pod := dto.PodListItemDTO{Name: "pod", UID: "pod-uid", Namespace: "apps", Node: "worker", Phase: "Running", Ready: "1/1", Restarts: 20, AgeSec: 864000}
			if scenario.name == "missing-uid" {
				pod.UID = ""
			}
			setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.PodListItemDTO{pod}})
			dir := t.TempDir()
			if err := os.Chmod(dir, 0700); err != nil {
				t.Fatal(err)
			}
			c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			q := localhistory.TrendQuery{Context: "synthetic", From: now.Truncate(time.Hour), To: now.Truncate(time.Hour).Add(time.Hour), TransitionDetails: true}
			wait := func(after time.Time) localhistory.TrendResponse {
				t.Helper()
				deadline := time.Now().Add(3 * time.Second)
				for time.Now().Before(deadline) {
					out, e := c.QueryTrends(q)
					if e != nil {
						t.Fatal(e)
					}
					if out.TransitionDiagnostics != nil && out.TransitionDiagnostics.AcceptedAt.After(after) && len(out.Severity) > 0 && len(out.Severity[0].Points) > 0 && out.Severity[0].Points[0].SampleAt.After(after) {
						return out
					}
					time.Sleep(time.Millisecond)
				}
				t.Fatal("publication not accepted", c.Status())
				return localhistory.TrendResponse{}
			}
			baseline := wait(now)
			if baseline.Severity[0].Points[0].ConfirmedChanges != 0 {
				t.Fatal("baseline events")
			}
			at := time.Now().UTC()
			meta := p.snapshotMetaHot(at)
			pod.Restarts = 5
			snapshot := PodsSnapshot{Meta: meta, Items: []dto.PodListItemDTO{pod}}
			switch scenario.name {
			case "lost-uid":
				snapshot.Items[0].UID = ""
			case "stale", "stale-empty":
				snapshot.Meta.ObservedAt = at.Add(-time.Hour)
			case "partial":
				snapshot.Meta.Completeness = CompletenessClassInexact
			case "error":
				snapshot.Err = &NormalizedError{UpstreamMessage: "sensitive-error-must-not-leak"}
			case "missing-source":
				snapshot.Meta.ObservedAt = time.Time{}
			}
			if scenario.name == "stale-empty" || scenario.name == "missing-source" {
				snapshot.Items = nil
			}
			if scenario.name == "policy" {
				// Use the real suppression operation: its invalidation publishes a new
				// canonical policy/population without an API or settings mutation.
				ns, _ := peekClusterSnapshot(&p.nsStore)
				nodes, _ := peekClusterSnapshot(&p.nodesStore)
				projection := m.canonicalDashboardSignals(p, ns, nil, nodes, at)
				key := ""
				for _, item := range projection.items {
					if item.SignalType == "pod_restarts" {
						key = item.HistoryKey
					}
				}
				if key == "" {
					t.Fatal("missing suppression target")
				}
				if _, err := m.SuppressSignal("synthetic", SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}); err != nil {
					t.Fatal(err)
				}
			} else {
				setNamespacedSnapshot(&p.podsStore, "apps", snapshot)
				if scenario.name == "partial" || scenario.name == "error" || scenario.name == "missing-source" {
					// Failed/incomplete snapshots intentionally do not notify. A healthy
					// inventory publication evaluates the cached failed Pod input.
					setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now().UTC()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
				}
			}
			out := wait(at)
			found := false
			for _, r := range out.TransitionDiagnostics.Recent {
				if r.Rule != "pod_restarts" || !r.At.After(at) {
					continue
				}
				found = true
				if r.Reason != scenario.reason || r.Decision != "not-confirmed" || r.Old.Active.High != 1 {
					t.Fatalf("wrong rejection: %+v", r)
				}
				if scenario.name == "policy" && (!r.PolicyChanged || r.Candidate != "disappearance-candidate" || r.New.Active != (localhistory.TrendCounts{})) {
					t.Fatal("suppression was not a policy-only removal", r)
				}
				if scenario.name == "stale" || scenario.name == "stale-empty" {
					if !r.New.SourceAt.Equal(snapshot.Meta.ObservedAt) {
						t.Fatal("lost own source clock", r)
					}
				}
			}
			if !found || out.Severity[0].Points[0].ConfirmedChanges != 0 {
				t.Fatalf("missing rejection or fake event: %+v", out)
			}
			if scenario.name == "missing-uid" || scenario.name == "lost-uid" {
				counts := out.Severity[0].Points[0].Counts
				if counts == nil || counts.High != 0 || counts.Medium != 1 {
					t.Fatal("unknown own identity erased current active population", counts)
				}
			}
			raw, _ := json.Marshal(out.TransitionDiagnostics)
			if strings.Contains(string(raw), "sensitive-error") || strings.Contains(string(raw), "fingerprint") {
				t.Fatal("sensitive diagnostic payload")
			}
		})
	}
}
