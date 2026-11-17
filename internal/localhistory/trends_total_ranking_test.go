package localhistory

import (
	"fmt"
	"testing"
	"time"
)

func TestTrendsTotalRankingAllGroupsAndDefaults(t *testing.T) {
	s, _ := trendStore(t, 30)
	at := epoch.Truncate(time.Hour)
	b := trendFixture(at)
	b.Domains = nil
	b.Diagnostics.UnsupportedRules = nil
	for _, spec := range []struct {
		name              string
		high, medium, low int
	}{
		{"many", 1, 50, 0}, {"high", 10, 0, 0}, {"medium", 0, 3, 0}, {"low", 0, 0, 2}, {"zero", 0, 0, 0},
	} {
		d := TrendDomain{Namespace: spec.name, Rule: spec.name, SourceAt: at, Complete: true}
		for severity, count := range map[string]int{"high": spec.high, "medium": spec.medium, "low": spec.low} {
			for i := 0; i < count; i++ {
				d.Signals = append(d.Signals, TrendSignal{ID: fmt.Sprintf("%s-%s-%d", spec.name, severity, i), Severity: severity, Node: TrendNodeKey(spec.name, "uid-"+spec.name), IdentityKnown: true})
			}
		}
		b.Domains = append(b.Domains, d)
	}
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: at, To: at.Add(time.Hour), AsOf: at.Add(time.Minute)}
	q.Normalize()
	if q.RulesMode != "topSignals10" || q.NodesMode != q.RulesMode || q.NamespacesMode != q.RulesMode {
		t.Fatal(q)
	}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	for group, rows := range map[string][]TrendSeries{"rules": out.Rules, "nodes": out.Nodes, "namespaces": out.Namespaces} {
		if len(rows) != 4 {
			t.Fatalf("%s: expected four positive totals, got %+v", group, rows)
		}
		for i, want := range []int{51, 10, 3, 2} {
			if rows[i].TotalScore != want || rows[i].ChangesScore != 0 {
				t.Fatalf("%s[%d]: %+v", group, i, rows[i])
			}
		}
	}
	if c := out.Severity[0].Points[0].Counts; c == nil || c.High != 11 || c.Medium != 53 || c.Low != 2 {
		t.Fatal("severity split changed", c)
	}
	q.NodesMode, q.Nodes = "custom", []string{TrendNodeKey("medium", "uid-medium")}
	out, err = s.QueryTrends(q)
	if err != nil || len(out.Nodes) != 1 || out.Nodes[0].TotalScore != 3 || out.Nodes[0].Points[0].Counts.High != 0 {
		t.Fatal("medium-only custom lost", out.Nodes, err)
	}
	q.NodesMode, q.Nodes = "topChanges10", nil
	out, err = s.QueryTrends(q)
	if err != nil || len(out.Nodes) != 0 {
		t.Fatal("baseline invented changes", out.Nodes, err)
	}
}

func TestTrendsTotalStepsAndSeverityChange(t *testing.T) {
	s, _ := trendStore(t, 30)
	at := epoch.Truncate(time.Hour)
	sig := TrendSignal{ID: "a", Severity: "high", Node: TrendNodeKey("worker", "uid")}
	for i, signals := range [][]TrendSignal{{sig}, {{ID: "a", Severity: "medium", Node: sig.Node}}, {{ID: "a", Severity: "medium", Node: sig.Node}, {ID: "b", Severity: "low", Node: sig.Node}}, {{ID: "b", Severity: "low", Node: sig.Node}}} {
		if err := s.AppendTrends(trendFixture(at.Add(time.Duration(i)*time.Hour), signals...)); err != nil {
			t.Fatal(err)
		}
	}
	out, err := s.QueryTrends(TrendQuery{Context: "synthetic-a", From: at, To: at.Add(4 * time.Hour), AsOf: at.Add(4 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	for _, rows := range [][]TrendSeries{out.Severity, out.Rules, out.Nodes, out.Namespaces} {
		if len(rows) != 1 || rows[0].TotalScore != 5 || rows[0].ChangesScore != 3 {
			t.Fatal(rows)
		}
		for i, want := range []int{1, 1, 2, 1} {
			p := rows[0].Points[i]
			changes := 1
			if i == 0 {
				changes = 0
			}
			if p.Counts == nil || p.Counts.High+p.Counts.Medium+p.Counts.Low != want || p.ConfirmedChanges != changes {
				t.Fatalf("step %d: %+v", i, p)
			}
		}
	}
}
