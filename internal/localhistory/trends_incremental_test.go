package localhistory

import (
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"reflect"
	"testing"
	"time"
)

func incrementalBatch(at time.Time, ns string, signals ...TrendSignal) TrendBatch {
	b := trendFixture(at, signals...)
	b.Domains[0].Namespace = ns
	b.Diagnostics.UnsupportedRules = nil
	return b
}
func retainedTrend(t *testing.T, s *Store, context string) TrendBatch {
	t.Helper()
	var b TrendBatch
	if err := s.db.View(func(tx *bolt.Tx) error {
		return json.Unmarshal(tx.Bucket(trendBucket).Bucket(signalContextKey(context)).Get([]byte("current")), &b)
	}); err != nil {
		t.Fatal(err)
	}
	return b
}
func TestTrendsIncrementalDirtyPreservesReopenAndIncompleteBaseline(t *testing.T) {
	s, path := trendStore(t, 30)
	write := func(b TrendBatch) {
		t.Helper()
		if err := s.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
	}
	a := incrementalBatch(epoch, "alpha", TrendSignal{ID: "a", Severity: "high"})
	b := incrementalBatch(epoch, "beta", TrendSignal{ID: "b", Severity: "medium"})
	a.Domains = append(a.Domains, b.Domains...)
	write(a)
	dirty := incrementalBatch(epoch.Add(time.Minute), "alpha", TrendSignal{ID: "a", Severity: "low"})
	write(dirty)
	before := retainedTrend(t, s, a.Context)
	if len(before.Domains) != 2 || before.Domains[1].Signals[0].ID != "b" || !before.Domains[1].SourceAt.Equal(epoch) {
		t.Fatal(before)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	var err error
	s, err = OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if got := retainedTrend(t, s, a.Context); !reflect.DeepEqual(got, before) {
		t.Fatal("reopen lost baseline")
	}
	bad := incrementalBatch(epoch.Add(2*time.Minute), "alpha")
	bad.Domains[0].Complete = false
	bad.Domains[0].Reason = "denied"
	write(bad)
	state := retainedTrend(t, s, a.Context)
	d := state.Domains[0]
	if d.Complete || !d.BaselineKnown || d.Signals[0].Severity != "low" || !d.SourceAt.Equal(dirty.At) {
		t.Fatal(d)
	}
	// Across silence, a fresh complete observation compares the persisted baseline.
	complete := incrementalBatch(epoch.Add(24*time.Hour), "alpha")
	write(complete)
	out, err := s.QueryTrends(TrendQuery{Context: a.Context, From: complete.At.Truncate(time.Hour), To: complete.At.Truncate(time.Hour).Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	p := out.Severity[0].Points[0]
	if p.Counts == nil || p.Counts.Medium != 1 || p.ConfirmedChanges != 1 || p.ChangesCoverage != "partial" {
		t.Fatal(p)
	}
}
func TestTrendsIncrementalPolicyEpochOrderingAndLosses(t *testing.T) {
	a := incrementalBatch(epoch, "alpha", TrendSignal{ID: "a", Severity: "high"})
	a.Domains[0].Generation = "z"
	old, _ := reduceTrends(TrendBatch{}, a)
	next := incrementalBatch(epoch.Add(time.Minute), "alpha")
	next.Domains[0].Generation = "a"
	next.Domains[0].SourceAt = epoch.Add(-time.Minute)
	state, h := reduceTrends(old, next)
	if g := trendGroup(t, h, "severity", "all"); g.ConfirmedChanges != 1 {
		t.Fatal("hash/minsource ordered", g)
	}
	if state.AcceptedSequence != 2 {
		t.Fatal(state.AcceptedSequence)
	}
	next.Policy = "new"
	next.At = next.At.Add(time.Minute)
	next.Domains[0].Signals = a.Domains[0].Signals
	_, h = reduceTrends(state, next)
	if g := trendGroup(t, h, "severity", "all"); g.ConfirmedChanges != 0 || g.ChangesCoverage != "unknown" {
		t.Fatal("policy incident", g)
	}
	next.Epoch = "new-epoch"
	next.Domains = nil
	state, h = reduceTrends(old, next)
	if len(state.Domains) != 0 || trendGroup(t, h, "severity", "all").Counts != nil {
		t.Fatal("epoch mixed")
	}
	loss := incrementalBatch(epoch.Add(time.Minute), "alpha")
	loss.Diagnostics.Coalesced = 3
	loss.Diagnostics.Overflow = 1
	state, h = reduceTrends(old, loss)
	if g := trendGroup(t, h, "severity", "all"); g.ConfirmedChanges != 1 || g.ChangesCoverage != "partial" {
		t.Fatal(g)
	}
	loss.At = loss.At.Add(time.Minute)
	loss.Diagnostics.Coalesced = 0
	loss.Diagnostics.Overflow = 0
	state, _ = reduceTrends(state, loss)
	if state.Diagnostics.Coalesced != 3 || state.Diagnostics.Overflow != 1 {
		t.Fatal("loss counters erased")
	}
}
func TestTrendsIncrementalPredecessorNoFutureOrPrefirst(t *testing.T) {
	s, _ := trendStore(t, 30)
	start := epoch.Truncate(time.Hour)
	b := incrementalBatch(start.Add(10*time.Minute), "alpha", TrendSignal{ID: "a", Severity: "high"})
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: start.Add(12 * time.Hour), To: start.Add(16 * time.Hour), AsOf: start.Add(14*time.Hour + 30*time.Minute)}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range out.Severity[0].Points {
		if i == 3 {
			if p.Counts != nil {
				t.Fatal("future carry", p)
			}
			continue
		}
		if p.Counts == nil || p.Counts.High != 1 || !p.CarriedForward || p.Freshness != "stale" || p.ConfirmedChanges != 0 || p.ChangesCoverage != "unknown" || !p.SampleAt.Equal(b.At) || !p.SourceAt.Equal(b.At) {
			t.Fatal(p)
		}
	}
	if out.Namespaces[0].HighScore != 3 || out.Namespaces[0].ChangesScore != 0 {
		t.Fatal(out.Namespaces)
	}
	q.From = start.Add(-time.Hour)
	q.To = start.Add(time.Hour)
	q.AsOf = start.Add(5 * time.Minute)
	out, err = s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range out.Severity[0].Points {
		if p.Counts != nil {
			t.Fatal("future or prefirst evidence", p)
		}
	}
	// A later current-state replacement must not change the historical predecessor.
	future := incrementalBatch(start.Add(20*time.Hour), "alpha")
	if err = s.AppendTrends(future); err != nil {
		t.Fatal(err)
	}
	q.From = start.Add(12 * time.Hour)
	q.To = start.Add(13 * time.Hour)
	q.AsOf = q.To
	out, err = s.QueryTrends(q)
	if err != nil || out.Severity[0].Points[0].Counts.High != 1 {
		t.Fatal(out, err)
	}
}
func TestTrendsIncrementalPerDomainRetentionAndSameClock(t *testing.T) {
	s, _ := trendStore(t, 30)
	a := incrementalBatch(epoch, "alpha", TrendSignal{ID: "a", Severity: "high"})
	if err := s.AppendTrends(a); err != nil {
		t.Fatal(err)
	}
	b := incrementalBatch(epoch, "beta", TrendSignal{ID: "b", Severity: "low"})
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	if got := retainedTrend(t, s, a.Context); len(got.Domains) != 2 || got.AcceptedSequence != 2 {
		t.Fatal(got)
	}
	b.At = epoch.Add(31 * 24 * time.Hour)
	b.Domains[0].SourceAt = b.At
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	got := retainedTrend(t, s, a.Context)
	if len(got.Domains) != 1 || got.Domains[0].Namespace != "beta" {
		t.Fatal(got)
	}
	// Earlier accepted-clock input cannot revert state even with a different hash.
	a.At = epoch.Add(time.Hour)
	a.Domains[0].Generation = "late"
	if err := s.AppendTrends(a); err != nil {
		t.Fatal(err)
	}
	if after := retainedTrend(t, s, a.Context); !reflect.DeepEqual(got, after) {
		t.Fatal("out-of-order accepted")
	}
}
func TestTrendsIncrementalMergedCapsPrioritizeAdmitted(t *testing.T) {
	a := incrementalBatch(epoch, "z-admitted")
	for i := 0; i < TrendMaxSignals; i++ {
		a.Domains[0].Signals = append(a.Domains[0].Signals, TrendSignal{ID: fmt.Sprint(i), Severity: "high", IdentityKnown: true})
	}
	old, _ := reduceTrends(TrendBatch{}, a)
	next := incrementalBatch(epoch.Add(time.Minute), "a-new", TrendSignal{ID: "new", Severity: "high"})
	update := a.Domains[0]
	update.SourceAt = next.At
	update.Signals = append([]TrendSignal(nil), update.Signals...)
	update.Signals = update.Signals[:TrendMaxSignals-1]
	update.Signals[0].Severity = "low"
	next.Domains = append(next.Domains, update)
	got, _ := reduceTrends(old, next)
	if len(got.Domains) != 2 || got.Domains[0].Signals[0].Severity != "low" {
		t.Fatal("admitted update starved")
	}
	next.At = next.At.Add(time.Minute)
	next.Domains = next.Domains[:1]
	next.Domains[0].Namespace = "another"
	next.Domains[0].SourceAt = next.At
	got, _ = reduceTrends(got, next)
	n := 0
	for _, d := range got.Domains {
		n += len(d.Signals)
	}
	if n > TrendMaxSignals || len(got.Domains) != 2 || got.Diagnostics.CapLosses == 0 {
		t.Fatal("merged cap", n, len(got.Domains), got.Diagnostics)
	}
}
func TestTrendsIncrementalIndependentChangesWithNullActive(t *testing.T) {
	at := epoch.Truncate(time.Hour)
	p := projectTrendPoint(at, at.Add(time.Hour), TrendPoint{}, TrendPoint{At: at, ConfirmedChanges: 3, ChangesCoverage: "partial"}, true, 24*time.Hour)
	if p.Counts != nil || p.ConfirmedChanges != 3 {
		t.Fatal(p)
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err = json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["counts"] != nil || wire["confirmedChanges"] != float64(3) {
		t.Fatal(wire)
	}
}
