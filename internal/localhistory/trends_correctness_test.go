package localhistory

import (
	"encoding/json"
	"errors"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"testing"
	"time"
)

func TestTrendsBaselineAppearanceUnknownIdentityAndPartialSubtotal(t *testing.T) {
	old, _ := reduceTrends(TrendBatch{}, trendFixture(epoch))
	sig := TrendSignal{ID: "one", Severity: "high", Node: TrendNodeKey("worker", "uid")}
	next := trendFixture(epoch.Add(time.Minute), sig)
	current, h := reduceTrends(old, next)
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 1 || c.High != 1 {
		t.Fatal("appearance after observed empty", c)
	}
	// Independent unknown domain must not erase known contributions.
	partial := trendFixture(epoch.Add(2*time.Minute), sig)
	partial.Domains = append(partial.Domains, TrendDomain{Namespace: "other", Rule: "unavailable", SourceAt: partial.At, Reason: "denied"})
	_, h = reduceTrends(current, partial)
	all := trendGroup(t, h, "severity", "all")
	if all.Counts == nil || all.Counts.High != 1 || all.Counts.Changes != 0 || all.Coverage != "partial" {
		t.Fatal("partial subtotal erased", all)
	}
	if g := trendGroup(t, h, "rules", "pod_crash_loop_waiting"); g.Coverage != "complete" {
		t.Fatal("unrelated rule degraded", g)
	}
	if g := trendGroup(t, h, "rules", "unavailable"); g.Counts != nil || g.Coverage != "unknown" {
		t.Fatal("unknown became zero", g)
	}
	if g := trendGroup(t, h, "nodes", sig.Node); g.Counts == nil || g.Counts.High != 1 || g.Coverage != "partial" {
		t.Fatal("node subtotal erased", g)
	}
	// Newly eligible domains are baselines, never incidents.
	partial.Domains[1] = TrendDomain{Namespace: "other", Rule: "new", SourceAt: partial.At, Complete: true, Signals: []TrendSignal{{ID: "new", Severity: "low", IdentityKnown: true}}}
	_, h = reduceTrends(current, partial)
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 0 || c.Low != 1 {
		t.Fatal("new domain fabricated event", c)
	}
	// A name-only record cannot establish incarnation continuity even if severity changes.
	unknown := trendFixture(epoch.Add(time.Minute), sig)
	unknown.Domains[0].Signals[0].IdentityKnown = false
	unknownOld, _ := reduceTrends(TrendBatch{}, unknown)
	unknownNext := trendFixture(epoch.Add(2*time.Minute), TrendSignal{ID: "replacement", Severity: "medium"})
	unknownNext.Domains[0].Signals[0].IdentityKnown = false
	_, h = reduceTrends(unknownOld, unknownNext)
	if c := trendGroup(t, h, "severity", "all").Counts; c.Changes != 0 || c.Medium != 1 {
		t.Fatal("name identity claimed", c)
	}
}

func TestTrendsHourlyPolicyGapReplayAndTransitionAccumulation(t *testing.T) {
	s, _ := trendStore(t, 30)
	appendBatch := func(b TrendBatch) {
		t.Helper()
		if err := s.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
	}
	appendBatch(trendFixture(epoch))
	sig := TrendSignal{ID: "one", Severity: "high"}
	appendBatch(trendFixture(epoch.Add(time.Minute), sig))
	replay := trendFixture(epoch.Add(2 * time.Minute))
	replay.Domains[0].SourceAt = epoch.Add(time.Minute)
	appendBatch(replay)
	q := TrendQuery{Context: "synthetic-a", From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour)}
	query := func() TrendPoint {
		t.Helper()
		out, err := s.QueryTrends(q)
		if err != nil {
			t.Fatal(err)
		}
		return out.Severity[0].Points[0]
	}
	if p := query(); p.Counts.High != 1 || p.Counts.Changes != 1 {
		t.Fatal("replay changed count", p)
	}
	gap := trendFixture(epoch.Add(3 * time.Minute))
	gap.Domains[0].Complete = false
	gap.Domains[0].Reason = "denied"
	appendBatch(gap)
	if p := query(); p.Counts == nil || p.Counts.High != 1 || !p.CarriedForward || p.Coverage == "complete" {
		t.Fatal("incomplete update lost last-observed active or claimed fresh", p)
	}
	appendBatch(trendFixture(epoch.Add(4*time.Minute), sig))
	if p := query(); p.Counts.High != 1 || p.Counts.Changes != 1 || p.Coverage != "partial" {
		t.Fatal("gap lost prior transition or added appearance", p)
	}
	changed := trendFixture(epoch.Add(5*time.Minute), sig)
	changed.Policy = "new-policy"
	appendBatch(changed)
	if p := query(); p.Reason != "policy-changed-within-hour" || p.Counts.Changes != 1 || p.Coverage != "partial" {
		t.Fatal("policy mix hidden", p)
	}
}

func TestTrendsFixedWindowRankingFiltersAndDecodedMemoryCap(t *testing.T) {
	s, _ := trendStore(t, 30)
	from := epoch.Truncate(time.Hour)
	for hour := 0; hour < 2; hour++ {
		b := trendFixture(from.Add(time.Duration(hour) * time.Hour))
		b.Domains = nil
		for i := 0; i < 12; i++ {
			count := i + 1
			if hour == 1 {
				count = 12 - i
			}
			d := TrendDomain{Namespace: fmt.Sprintf("ns-%02d", i), Rule: fmt.Sprintf("rule-%02d", i), SourceAt: b.At, Complete: true}
			for j := 0; j < count; j++ {
				d.Signals = append(d.Signals, TrendSignal{ID: fmt.Sprintf("id-%d", j), Severity: "high", IdentityKnown: true})
			}
			b.Domains = append(b.Domains, d)
		}
		if err := s.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
	}
	q := TrendQuery{Context: "synthetic-a", From: from, To: from.Add(2 * time.Hour)}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Rules) != 10 || out.Rules[0].Key != "rule-00" || out.Rules[0].TotalScore != 13 || out.Rules[0].Points[0].Counts.High != 1 || out.Rules[0].Points[1].Counts.High != 12 {
		t.Fatal("ranking not fixed across entire window", out.Rules)
	}
	q.RulesMode = "custom"
	q.Rules = []string{"rule-11", "missing"}
	q.NamespacesMode = "tag"
	q.Namespaces = []string{"ns-04"}
	out, err = s.QueryTrends(q)
	if err != nil || len(out.Rules) != 2 || out.Rules[0].Key != "rule-11" || out.Rules[1].Points[0].Counts != nil || len(out.Namespaces) != 1 || out.Namespaces[0].Key != "ns-04" {
		t.Fatal("selection contract", out, err)
	}
	// Fill bounded hourly records directly to exercise the query-side decoded cap,
	// independently of ingestion admission; no host memory sampling or giant fixture.
	err = s.db.Update(func(tx *bolt.Tx) error {
		h := tx.Bucket(trendBucket).Bucket(signalContextKey("synthetic-a")).Bucket([]byte("hours"))
		for hour := 0; hour < 16; hour++ {
			at := from.Add(time.Duration(hour) * time.Hour)
			record := TrendHour{At: at, Epoch: trendFixture(from).Epoch}
			for i := 0; i < 4096; i++ {
				record.Groups = append(record.Groups, TrendGroup{Kind: "rules", Key: fmt.Sprintf("r-%d", i), TrendPoint: TrendPoint{At: at, Counts: &TrendCounts{High: 1}, Coverage: "complete"}})
			}
			data, e := json.Marshal(record)
			if e != nil {
				return e
			}
			if len(data) > trendHourMaxBytes {
				t.Fatal("fixture exceeds hourly cap")
			}
			if e = h.Put(stamp(at.Unix()), data); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	q.To = from.Add(16 * time.Hour)
	if _, err = s.QueryTrends(q); !errors.Is(err, ErrTrendQueryLimit) {
		t.Fatal("unbounded decoded query", err)
	}
}
