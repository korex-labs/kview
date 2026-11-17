package localhistory

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// JSON exercises additive persisted evidence without depending on the new Go field.
func reviewGeneration(d *TrendDomain, generation string) {
	raw, _ := json.Marshal(map[string]any{"generation": generation})
	_ = json.Unmarshal(raw, d)
}
func reviewChangesCoverage(p TrendPoint) string {
	raw, _ := json.Marshal(p)
	var wire map[string]any
	_ = json.Unmarshal(raw, &wire)
	s, _ := wire["changesCoverage"].(string)
	return s
}
func TestTrendsReviewDependencyGeneration(t *testing.T) {
	a := trendFixture(epoch)
	a.Diagnostics.UnsupportedRules = nil
	reviewGeneration(&a.Domains[0], "a")
	old, _ := reduceTrends(TrendBatch{}, a)
	b := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "service", Severity: "high"})
	b.Diagnostics.UnsupportedRules = nil
	b.Domains[0].SourceAt = epoch
	reviewGeneration(&b.Domains[0], "b")
	current, h := reduceTrends(old, b)
	if c := trendGroup(t, h, "severity", "all").Counts; c.High != 1 || c.Changes != 1 {
		t.Fatalf("fresh dependency lost: %+v", c)
	}
	replay := trendFixture(epoch.Add(2 * time.Minute))
	replay.Diagnostics.UnsupportedRules = nil
	replay.Domains[0].SourceAt = epoch
	reviewGeneration(&replay.Domains[0], "b")
	_, h = reduceTrends(current, replay)
	if c := trendGroup(t, h, "severity", "all").Counts; c.High != 1 || c.Changes != 0 {
		t.Fatalf("replay: %+v", c)
	}
}
func TestTrendsReviewGenerationIsNotSourceClockOrdering(t *testing.T) {
	a := trendFixture(epoch)
	a.Diagnostics.UnsupportedRules = nil
	a.Domains[0].Generation = "first"
	old, _ := reduceTrends(TrendBatch{}, a)
	b := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "service", Severity: "high"})
	b.Diagnostics.UnsupportedRules = nil
	// A different dependency publication can move the minimum freshness clock
	// backwards. It is still a new observation, not an ordered generation number.
	b.Domains[0].SourceAt = epoch.Add(-time.Minute)
	b.Domains[0].Generation = "second"
	current, h := reduceTrends(old, b)
	if g := trendGroup(t, h, "severity", "all"); g.Counts.High != 1 || g.Counts.Changes != 1 || g.ChangesCoverage != "complete" {
		t.Fatalf("changed generation lost behind minimum source clock: %+v", g)
	}
	b.At = b.At.Add(time.Minute)
	_, h = reduceTrends(current, b)
	if g := trendGroup(t, h, "severity", "all"); g.Counts.High != 1 || g.Counts.Changes != 0 {
		t.Fatalf("same generation fabricated an event: %+v", g)
	}
}

func TestTrendsReviewCoverage(t *testing.T) {
	a := trendFixture(epoch, TrendSignal{ID: "pod", Severity: "high", Node: TrendNodeKey("worker", "uid")})
	_, h := reduceTrends(TrendBatch{}, a)
	if g := trendGroup(t, h, "severity", "all"); g.Coverage != "partial" {
		t.Fatal("unsupported omitted", g)
	}
	a.Diagnostics.UnsupportedRules = nil
	a.Domains[0].TransitionsUnknown = true
	_, h = reduceTrends(TrendBatch{}, a)
	if g := trendGroup(t, h, "severity", "all"); g.Coverage != "complete" || reviewChangesCoverage(g.TrendPoint) != "unknown" {
		t.Fatal("active/changes conflated", g)
	}
	a.Diagnostics.Reasons["node-membership-unknown"] = 1
	_, h = reduceTrends(TrendBatch{}, a)
	if g := trendGroup(t, h, "nodes", a.Domains[0].Signals[0].Node); g.Coverage != "partial" {
		t.Fatal("node attribution omitted", g)
	}
}
func TestTrendsReviewMovedNodeZero(t *testing.T) {
	a := trendFixture(epoch, TrendSignal{ID: "pod", Severity: "high", Node: TrendNodeKey("old", "uid")})
	a.Diagnostics.UnsupportedRules = nil
	old, _ := reduceTrends(TrendBatch{}, a)
	b := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "pod", Severity: "high", Node: TrendNodeKey("new", "uid")})
	b.Diagnostics.UnsupportedRules = nil
	_, h := reduceTrends(old, b)
	g := trendGroup(t, h, "nodes", a.Domains[0].Signals[0].Node)
	if g.Counts == nil || *g.Counts != (TrendCounts{}) || g.Coverage != "complete" {
		t.Fatal("old membership not observed zero", g)
	}
	if c := trendGroup(t, h, "nodes", b.Domains[0].Signals[0].Node).Counts; c.High != 1 || c.Changes != 0 {
		t.Fatal(c)
	}
}
func TestTrendsReviewGroupAdmission(t *testing.T) {
	s, _ := trendStore(t, 30)
	for tick := 0; tick < 2; tick++ {
		b := trendFixture(epoch.Add(time.Duration(tick) * time.Minute))
		b.Diagnostics.UnsupportedRules = nil
		b.Domains = nil
		for i := 0; i < 2200; i++ {
			name := fmt.Sprintf("rule-%04d", i+tick*2200)
			b.Domains = append(b.Domains, TrendDomain{Namespace: fmt.Sprintf("ns-%04d", i), Rule: name, SourceAt: b.At, Complete: true, Signals: []TrendSignal{{ID: name, IdentityKnown: true, Severity: "high"}}})
		}
		if e := s.AppendTrends(b); e != nil {
			t.Fatalf("bounded useful batch rejected: %v", e)
		}
	}
	out, e := s.QueryTrends(TrendQuery{Context: "synthetic-a", From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour)})
	if e != nil {
		t.Fatal(e)
	}
	if out.Diagnostics.CapLosses == 0 || out.Severity[0].Points[0].Counts.High != 4400 {
		t.Fatal("overflow lost severity or diagnostics", out.Diagnostics)
	}
}
