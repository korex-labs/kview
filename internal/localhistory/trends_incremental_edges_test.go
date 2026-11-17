package localhistory

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestTrendsIncrementalLatestByteFallbackPreservesPeers(t *testing.T) {
	a := incrementalBatch(epoch, "alpha", TrendSignal{ID: "a", Severity: "high", IdentityKnown: true})
	peer := incrementalBatch(epoch, "beta", TrendSignal{ID: "b", Severity: "low", IdentityKnown: true})
	a.Domains = append(a.Domains, peer.Domains...)
	old, _ := reduceTrends(TrendBatch{}, a)
	next := incrementalBatch(epoch.Add(time.Minute), "alpha")
	for i := 0; i < TrendMaxSignals; i++ {
		next.Domains[0].Signals = append(next.Domains[0].Signals, TrendSignal{ID: fmt.Sprint(i), Severity: "high", Node: strings.Repeat("x", 1024), IdentityKnown: true})
	}
	state, hour := reduceTrends(old, next)
	if len(state.Domains) != 2 || state.Diagnostics.CapLosses != 1 {
		t.Fatal("fallback lost domain", len(state.Domains), state.Diagnostics)
	}
	for i, d := range state.Domains {
		if len(d.Signals) != 1 || !d.SourceAt.Equal(epoch) || !d.CarriedForward || d.Complete || d.Signals[0].ID != old.Domains[i].Signals[0].ID {
			t.Fatal("baseline erased", d)
		}
	}
	if g := trendGroup(t, hour, "severity", "all"); g.Counts == nil || g.Counts.High != 1 || g.Counts.Low != 1 || g.ConfirmedChanges != 0 || g.ChangesCoverage == "complete" {
		t.Fatal(g)
	}
}

func TestTrendsIncrementalEpochBoundaryNeverCarriesOldIdentity(t *testing.T) {
	s, _ := trendStore(t, 30)
	start := epoch.Truncate(time.Hour)
	old := incrementalBatch(start, "alpha", TrendSignal{ID: "old", Severity: "high", IdentityKnown: true})
	if err := s.AppendTrends(old); err != nil {
		t.Fatal(err)
	}
	next := incrementalBatch(start.Add(time.Hour), "beta")
	next.Epoch = "new-epoch"
	if err := s.AppendTrends(next); err != nil {
		t.Fatal(err)
	}
	out, err := s.QueryTrends(TrendQuery{Context: old.Context, From: start, To: start.Add(4 * time.Hour), AsOf: start.Add(3 * time.Hour), NamespacesMode: "custom", Namespaces: []string{"alpha"}})
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range out.Namespaces[0].Points {
		if p.Counts != nil {
			t.Fatal("old epoch exposed by current-epoch query", i, p)
		}
	}
}

func TestTrendsSourceAgeRecomputedAndUnknownCleared(t *testing.T) {
	oldAge := int64(999)
	for _, tc := range []struct {
		name      string
		source    time.Time
		carried   bool
		age       int64
		freshness string
	}{
		{"fresh", epoch.Add(-time.Minute), false, 60, "fresh"},
		{"threshold", epoch.Add(-15 * time.Minute), false, 900, "fresh"},
		{"stale", epoch.Add(-15*time.Minute - time.Second), false, 901, "stale"},
		{"carried", epoch.Add(-time.Minute), true, 60, "stale"},
		{"missing", time.Time{}, false, -1, "unknown"},
		{"future", epoch.Add(time.Second), false, -1, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := TrendPoint{SourceAt: tc.source, CarriedForward: tc.carried, SourceAgeSeconds: &oldAge}
			decorateTrendPoint(&p, epoch)
			if p.Freshness != tc.freshness || (tc.age < 0 && p.SourceAgeSeconds != nil) || (tc.age >= 0 && (p.SourceAgeSeconds == nil || *p.SourceAgeSeconds != tc.age)) {
				t.Fatal(p)
			}
		})
	}
}
