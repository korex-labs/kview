package localhistory

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTransitionDiagnosticsDecisions(t *testing.T) {
	sig := TrendSignal{ID: "private-fingerprint", IdentityKey: "private-key", ResourceUID: "synthetic-uid", Severity: "high", Node: TrendNodeKey("worker", "node-uid")}
	for _, tc := range []struct{ name, reason string }{
		{"baseline", "no-previous-baseline"}, {"missing", "missing-uid"}, {"stale", "source-stale"}, {"partial", "source-partial"}, {"policy", "policy-rebase"}, {"epoch", "epoch-rebase"}, {"replay", "source-replay"}, {"incremental-partial", "source-partial"}, {"known", ""}, {"coalesced", ""}, {"unchanged", ""}, {"membership", "membership-only"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old, _ := reduceTrends(TrendBatch{}, trendFixture(epoch, sig))
			next := trendFixture(epoch.Add(time.Minute), sig)
			next.Domains[0].Signals[0].Severity = "medium"
			next.Domains[0].CachedPopulation = true
			next.Domains[0].Generation = "new-generation"
			switch tc.name {
			case "baseline":
				old = TrendBatch{}
			case "missing":
				next.Domains[0].Signals[0].IdentityKnown = false
			case "stale", "partial":
				next.Domains[0].TransitionsUnknown = true
				next.Domains[0].SourceStatus = "source-" + tc.name
			case "policy":
				next.Policy = "changed-policy"
			case "epoch":
				next.Epoch = "new-epoch"
			case "replay":
				next.Domains[0].CachedPopulation = false
				next.Domains[0].SourceAt = epoch
			case "incremental-partial":
				next.Domains[0].Complete = false
			case "coalesced":
				next.Diagnostics.Coalesced = 5
			case "unchanged":
				next.Domains[0].Signals[0].Severity = "high"
			case "membership":
				next.Domains[0].Signals[0].Severity = "high"
				next.Domains[0].Signals[0].Node = TrendNodeKey("worker-b", "node-b")
			}
			expectedState, expected := reduceTrends(old, next)
			trace := cloneTransitionDiagnostics(nil, next.Context, next.Epoch)
			next.transitionTrace = trace
			actualState, actual := reduceTrends(old, next)
			actualState.transitionTrace = nil
			if !reflect.DeepEqual(actualState, expectedState) {
				t.Fatal("instrumentation changed reducer state")
			}
			if !reflect.DeepEqual(actual, expected) {
				t.Fatal("instrumentation changed aggregates")
			}
			if tc.reason == "" {
				if len(trace.Recent) != 0 {
					t.Fatal(trace)
				}
				return
			}
			if trace.Reasons[tc.reason] != 1 || len(trace.Recent) != 1 {
				t.Fatalf("want %s: %+v", tc.reason, trace)
			}
			r := trace.Recent[0]
			if r.Decision != "not-confirmed" || r.New.EvaluatedAt != next.At || r.New.Active.Medium != 1 && tc.name != "membership" {
				t.Fatal(r)
			}
			if (tc.name == "replay" || tc.name == "incremental-partial") && !r.New.SourceAt.Equal(next.Domains[0].SourceAt) {
				t.Fatal("lost attempted source clock", r)
			}
			raw, _ := json.Marshal(trace)
			for _, secret := range []string{"private-fingerprint", "private-key", "new-generation", "changed-policy"} {
				if strings.Contains(string(raw), secret) {
					t.Fatal("fingerprint leaked", secret)
				}
			}
		})
	}
}

func TestTransitionDiagnosticsAbsentDomainAndReasonValidation(t *testing.T) {
	sig := TrendSignal{ID: "synthetic", IdentityKnown: true, Severity: "high"}
	old, _ := reduceTrends(TrendBatch{}, trendFixture(epoch, sig))
	next := trendFixture(epoch.Add(time.Minute))
	next.FullProjection = true
	next.Domains = nil
	next.transitionTrace = cloneTransitionDiagnostics(nil, next.Context, next.Epoch)
	_, hour := reduceTrends(old, next)
	if len(next.transitionTrace.Recent) != 1 {
		t.Fatal(next.transitionTrace)
	}
	record := next.transitionTrace.Recent[0]
	if record.Reason != "domain-not-observed" || record.New.SourceStatus != "domain-not-observed" || !record.New.SourceAt.IsZero() || record.Decision != "not-confirmed" {
		t.Fatal(record)
	}
	for _, group := range hour.Groups {
		if group.ConfirmedChanges != 0 || group.Counts != nil && group.Counts.Changes != 0 || group.ChangesCoverage == "complete" {
			t.Fatal("absent domain confirmed disappearance", group)
		}
	}
	invalid := trendFixture(epoch, sig)
	invalid.Domains[0].SourceStatus = "arbitrary-secret-reason"
	if invalid.Validate() == nil {
		t.Fatal("unbounded reason vocabulary accepted")
	}
}

func TestTransitionDiagnosticsBoundsIsolationClose(t *testing.T) {
	s, path := trendStore(t, 30)
	batch := trendFixture(epoch)
	for i := 0; i < 300; i++ {
		batch.Domains[0].Signals = append(batch.Domains[0].Signals, TrendSignal{ID: fmt.Sprint(i), IdentityKnown: true, Severity: "high", ResourceUID: strings.Repeat("u", 512), Node: TrendNodeKey(strings.Repeat("n", 240), strings.Repeat("i", 240))})
	}
	if err := s.AppendTrends(batch); err != nil {
		t.Fatal(err)
	}
	got := s.transitionDiagnostics(batch.Context, batch.Epoch)
	if len(got.Recent) > TransitionRecentLimit || got.Evicted == 0 || got.Reasons["no-previous-baseline"] != 300 || got.recentBytes > TransitionRecentMaxBytes {
		t.Fatal(got)
	}
	raw, _ := json.Marshal(got.Recent)
	if len(raw) > TransitionRecentMaxBytes {
		t.Fatal("encoded bytes unbounded", len(raw))
	}
	got.Reasons["no-previous-baseline"] = 0
	got.Recent[0].Reason = "modified"
	if s.transitionDiagnostics(batch.Context, batch.Epoch).Reasons["no-previous-baseline"] != 300 {
		t.Fatal("alias")
	}
	if len(s.transitionDiagnostics("synthetic-ab", batch.Epoch).Recent) != 0 || len(s.transitionDiagnostics(batch.Context, "other-epoch").Recent) != 0 {
		t.Fatal("cross identity")
	}
	batch.At = batch.At.Add(time.Minute)
	batch.Diagnostics.Coalesced = 7
	batch.Diagnostics.Overflow = 2
	if err := s.AppendTrends(batch); err != nil {
		t.Fatal(err)
	}
	got = s.transitionDiagnostics(batch.Context, batch.Epoch)
	if got.Reasons["no-previous-baseline"] != 300 || got.Coalesced != 7 || got.Overflow != 2 {
		t.Fatal("unchanged spam or loss counters", got)
	}
	batch.At = batch.At.Add(time.Minute)
	batch.Epoch = "replacement-epoch"
	batch.Domains[0].Signals = batch.Domains[0].Signals[:1]
	if err := s.AppendTrends(batch); err != nil {
		t.Fatal(err)
	}
	reset := s.transitionDiagnostics(batch.Context, batch.Epoch)
	if len(reset.Recent) != 1 || reset.Reasons["epoch-rebase"] != 1 || reset.Reasons["no-previous-baseline"] != 0 || reset.Evicted != 0 {
		t.Fatal("epoch did not reset diagnostics", reset)
	}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			s.transitionDiagnostics(batch.Context, batch.Epoch)
		}
	}()
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if len(s.transitionDiagnostics(batch.Context, batch.Epoch).Recent) != 0 {
		t.Fatal("close retained diagnostics")
	}
	reopened, err := OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopened.Close(); err != nil {
			t.Error(err)
		}
	})
	if len(reopened.transitionDiagnostics(batch.Context, batch.Epoch).Recent) != 0 {
		t.Fatal("unexpected backfill")
	}
}
