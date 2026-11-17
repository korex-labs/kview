package localhistory

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func trendFixture(at time.Time, signals ...TrendSignal) TrendBatch {
	for i := range signals {
		signals[i].IdentityKnown = true
	}
	return TrendBatch{Context: "synthetic-a", Epoch: "epoch", Policy: "policy", At: at, Domains: []TrendDomain{{Namespace: "apps", Rule: "pod_crash_loop_waiting", SourceAt: at, Complete: true, Signals: signals}}, Diagnostics: TrendDiagnostics{EligibleScopes: 1, EvaluatedScopes: 1, SupportedRules: []string{"pod_crash_loop_waiting"}, UnsupportedRules: []string{"detail-only"}, Reasons: map[string]int{}}}
}
func trendGroup(t *testing.T, h TrendHour, kind, key string) TrendGroup {
	t.Helper()
	for _, g := range h.Groups {
		if g.Kind == kind && g.Key == key {
			return g
		}
	}
	t.Fatalf("missing %s/%s", kind, key)
	return TrendGroup{}
}
func TestTrendsConfirmedTransitions(t *testing.T) {
	at := epoch
	sig := TrendSignal{ID: "a", Severity: "high", Node: TrendNodeKey("node-a", "uid-a")}
	first, h := reduceTrends(TrendBatch{}, trendFixture(at, sig))
	if g := trendGroup(t, h, "severity", "all"); g.Counts.High != 1 || g.Counts.Changes != 0 {
		t.Fatalf("appearance: %+v", g)
	}
	second, h := reduceTrends(first, trendFixture(at.Add(time.Minute), sig))
	if trendGroup(t, h, "severity", "all").Counts.Changes != 0 {
		t.Fatal("unchanged counted")
	}
	sig.Severity = "medium"
	third, h := reduceTrends(second, trendFixture(at.Add(2*time.Minute), sig))
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 1 || c.High != 0 || c.Medium != 1 {
		t.Fatalf("severity: %+v", c)
	}
	replacement := sig
	replacement.ID = "b"
	fourth, h := reduceTrends(third, trendFixture(at.Add(3*time.Minute), replacement))
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 2 || c.Medium != 1 {
		t.Fatalf("replacement != two: %+v", c)
	}
	_, h = reduceTrends(fourth, trendFixture(at.Add(4*time.Minute)))
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 1 || c.Medium != 0 {
		t.Fatalf("disappearance: %+v", c)
	}
}
func TestTrendsPolicyGapMembershipAndReplay(t *testing.T) {
	sig := TrendSignal{ID: "a", Severity: "high", Node: TrendNodeKey("node-a", "uid-a")}
	old, _ := reduceTrends(TrendBatch{}, trendFixture(epoch, sig))
	for _, kind := range []string{"policy", "gap", "selection", "replay", "membership"} {
		t.Run(kind, func(t *testing.T) {
			next := trendFixture(epoch.Add(time.Minute), sig)
			switch kind {
			case "policy":
				next.Policy = "new"
				next.Domains[0].Signals = nil
			case "gap":
				next.Domains[0].Complete = false
				next.Domains[0].Signals = nil
			case "selection":
				next.Domains = nil
			case "replay":
				next.Domains[0].SourceAt = epoch
				next.Domains[0].Signals = nil
			case "membership":
				next.Domains[0].Signals[0].Node = TrendNodeKey("node-b", "uid-b")
			}
			current, h := reduceTrends(old, next)
			c := trendGroup(t, h, "severity", "all").Counts
			if c != nil && c.Changes != 0 {
				t.Fatalf("fake %s transition %+v", kind, c)
			}
			if kind == "gap" {
				if c == nil || c.High != 1 || !trendGroup(t, h, "severity", "all").CarriedForward {
					t.Fatal("gap lost verified baseline")
				}
				after := trendFixture(epoch.Add(2 * time.Minute))
				_, h = reduceTrends(current, after)
				if g := trendGroup(t, h, "severity", "all"); g.Counts.Changes != 1 || g.ChangesCoverage != "partial" {
					t.Fatal("complete-empty must confirm lower-bound resolution across gap", g)
				}
			}
			if kind == "membership" {
				if c := trendGroup(t, h, "nodes", TrendNodeKey("node-b", "uid-b")).Counts; c.Changes != 0 || c.High != 1 {
					t.Fatal("membership fabricated event")
				}
			}
		})
	}
}
func TestTrendsStoreRankingRestartAnd600Namespaces(t *testing.T) {
	s, path := trendStore(t, 30)
	batch := trendFixture(epoch)
	batch.Domains = nil
	for i := 0; i < 600; i++ {
		batch.Domains = append(batch.Domains, TrendDomain{Namespace: fmt.Sprintf("ns-%03d", i), Rule: "pod_crash_loop_waiting", SourceAt: epoch, Complete: true, Signals: []TrendSignal{{ID: fmt.Sprintf("id-%d", i), Severity: "high", IdentityKnown: true}}})
	}
	batch.Diagnostics.EligibleScopes = 600
	batch.Diagnostics.EvaluatedScopes = 600
	if e := s.AppendTrends(batch); e != nil {
		t.Fatal(e)
	}
	q := TrendQuery{Context: "synthetic-a", From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(2 * time.Hour), NamespacesMode: "topChanges10"}
	out, e := s.QueryTrends(q)
	if e != nil {
		t.Fatal(e)
	}
	if c := out.Severity[0].Points[0].Counts; c == nil || c.High != 600 || c.Changes != 0 {
		t.Fatalf("instance cap leaked %+v", c)
	}
	if len(out.Namespaces) != 0 || out.Severity[0].Points[1].Counts == nil || !out.Severity[0].Points[1].CarriedForward {
		t.Fatal("ranking or missing gap")
	}
	if out.Diagnostics.EligibleScopes != 600 || out.Diagnostics.RetainedBytes == 0 {
		t.Fatal("missing diagnostics")
	}
	// Create real per-identity replacements without changing the total.
	batch.At = epoch.Add(time.Minute)
	for i := range batch.Domains {
		batch.Domains[i].SourceAt = batch.At
	}
	batch.Domains[599].Signals[0].ID = "replacement"
	if e = s.AppendTrends(batch); e != nil {
		t.Fatal(e)
	}
	out, e = s.QueryTrends(q)
	if e != nil {
		t.Fatal(e)
	}
	if len(out.Namespaces) != 1 || out.Namespaces[0].Key != "ns-599" || out.Namespaces[0].ChangesScore != 2 {
		t.Fatalf("not window-ranked %+v", out.Namespaces)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	reopened, e := OpenReal(path, 30)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	again, e := reopened.QueryTrends(q)
	if e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(out.Severity, again.Severity) || !reflect.DeepEqual(out.Namespaces, again.Namespaces) {
		t.Fatal("restart lost projections")
	}
}
func TestTrendsQueryBoundsAndAtomicRejection(t *testing.T) {
	s, _ := trendStore(t, 30)
	b := trendFixture(epoch, TrendSignal{ID: "a", Severity: "high"})
	if e := s.AppendTrends(b); e != nil {
		t.Fatal(e)
	}
	q := TrendQuery{Context: "synthetic-a", From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour), RulesMode: "custom", Rules: []string{"pod_crash_loop_waiting"}}
	before, e := s.QueryTrends(q)
	if e != nil {
		t.Fatal(e)
	}
	b.At = b.At.Add(time.Minute)
	b.Domains[0].Signals = append(b.Domains[0].Signals, b.Domains[0].Signals[0])
	if s.AppendTrends(b) == nil {
		t.Fatal("duplicate admitted")
	}
	after, _ := s.QueryTrends(q)
	if !reflect.DeepEqual(before.Rules, after.Rules) {
		t.Fatal("rejected write changed history")
	}
	q.Rules = make([]string, 21)
	if q.Validate() == nil {
		t.Fatal("unbounded filter")
	}
	q.Rules = nil
	q.NodesMode = "topHigh10"
	if err := q.Validate(); err != nil {
		t.Fatal("node Top High rejected", err)
	}
	q.Nodes = []string{TrendNodeKey("synthetic-node", "uid")}
	if q.Validate() == nil {
		t.Fatal("Top High accepted explicit node selections")
	}
	q.Nodes = nil
	q.NodesMode = "tag"
	if q.Validate() == nil {
		t.Fatal("namespace-only node mode accepted")
	}
}
