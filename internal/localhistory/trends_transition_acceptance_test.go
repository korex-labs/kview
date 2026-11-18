package localhistory

import (
	"encoding/json"
	bolt "go.etcd.io/bbolt"
	"reflect"
	"strconv"
	"testing"
	"time"
)

func TestTransitionHoursDecisionBranches(t *testing.T) {
	for _, tc := range []struct{ name, reason string }{
		{"baseline", "no-previous-baseline"}, {"missing-uid", "missing-uid"}, {"stale", "source-stale"}, {"missing", "source-missing"}, {"partial", "source-partial"}, {"error", "source-error"}, {"restored", "source-restored"}, {"identity-lost", "missing-uid"}, {"policy", "policy-rebase"}, {"epoch", "epoch-rebase"}, {"replay", "source-replay"}, {"previous-unavailable", "previous-source-unavailable"}, {"absent-domain", "domain-not-observed"}, {"known", ""}, {"coalesced", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, path := trendStore(t, 30)
			sig := TrendSignal{ID: "signal", IdentityKey: "resource", ResourceUID: "uid", Severity: "high", Node: TrendNodeKey("worker", "node-uid")}
			first := trendFixture(epoch, sig)
			if tc.name == "previous-unavailable" {
				first.Domains[0].TransitionsUnknown = true
				first.Domains[0].CachedPopulation = true
				first.Domains[0].SourceStatus = "source-error"
			}
			if tc.name != "baseline" {
				if err := s.AppendTrends(first); err != nil {
					t.Fatal(err)
				}
			}
			next := trendFixture(epoch.Add(time.Hour), sig)
			next.Domains[0].Signals[0].Severity = "medium"
			next.Domains[0].CachedPopulation = true
			switch tc.name {
			case "missing-uid", "identity-lost":
				next.Domains[0].Signals[0].IdentityKnown = false
			case "stale", "missing", "partial", "error", "restored":
				next.Domains[0].TransitionsUnknown = true
				next.Domains[0].SourceStatus = "source-" + tc.name
			case "policy":
				next.Policy = "changed"
			case "epoch":
				next.Epoch = "changed"
			case "replay":
				next.Domains[0].CachedPopulation = false
				next.Domains[0].SourceAt = epoch
			case "absent-domain":
				next.FullProjection = true
				next.Domains = nil
			case "coalesced":
				next.Diagnostics.Coalesced = 5
				next.Diagnostics.Overflow = 2
			}
			if err := s.AppendTrends(next); err != nil {
				t.Fatal(err)
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err := OpenReal(path, 30)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Close(); err != nil {
					t.Error(err)
				}
			})
			q := TrendQuery{Context: next.Context, From: next.At, To: next.At.Add(time.Hour), AsOf: next.At.Add(time.Minute), TransitionDetails: true}
			out, err := s.QueryTrends(q)
			if err != nil || len(out.TransitionHours) != 1 {
				t.Fatal(out, err)
			}
			h := out.TransitionHours[0]
			if tc.reason != "" {
				if h.Reasons[tc.reason] != 1 || len(h.Reasons) != 1 || len(h.Groups) != 1 || h.Groups[0].Reasons[tc.reason] != 1 {
					t.Fatalf("reason %s: %+v", tc.reason, h)
				}
			} else if len(h.Reasons) != 0 {
				t.Fatal(h)
			}
			want := 0
			if tc.reason == "" {
				want = 1
			}
			if len(out.Severity) != 1 || out.Severity[0].Points[0].ConfirmedChanges != want {
				t.Fatalf("changes want %d: %+v", want, out)
			}
			if tc.name == "coalesced" && (h.Coalesced != 5 || h.Overflow != 2) {
				t.Fatal(h)
			}
			if len(h.Groups) > 0 && tc.name != "absent-domain" && h.Groups[0].DomainAfter.Medium != 1 {
				t.Fatal("lost attempted current population", h)
			}
			q.TransitionDetails = false
			plain, err := s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			out.TransitionHours = nil
			if !reflect.DeepEqual(plain, out) {
				t.Fatal("optional evidence changed trend response")
			}
		})
	}
}

func TestTransitionHoursIncompleteLegacyAppendReopen(t *testing.T) {
	s, path := trendStore(t, 30)
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	first := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
	if err := s.AppendTrends(first); err != nil {
		t.Fatal(err)
	}
	// Simulate a pre-instrumentation writer, maintaining exact retained bytes.
	if err := s.db.Update(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		hours := root.Bucket(signalContextKey(first.Context)).Bucket([]byte("hours"))
		key := stamp(epoch.Unix())
		old := hours.Get(key)
		var h TrendHour
		if err := json.Unmarshal(old, &h); err != nil {
			return err
		}
		h.TransitionEvidence = nil
		raw, err := json.Marshal(h)
		if err != nil {
			return err
		}
		if err := root.Put([]byte("bytes"), stamp(number(root.Get([]byte("bytes")))+int64(len(raw)-len(old)))); err != nil {
			return err
		}
		return hours.Put(key, raw)
	}); err != nil {
		t.Fatal(err)
	}
	reopen := func() {
		t.Helper()
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		var err error
		s, err = OpenReal(path, 30)
		if err != nil {
			t.Fatal(err)
		}
	}
	reopen()
	for i, at := range []time.Time{epoch.Add(time.Minute), epoch.Add(2 * time.Minute), epoch.Add(time.Hour)} {
		severity := "medium"
		if i == 1 {
			severity = "high"
		}
		next := trendFixture(at, TrendSignal{ID: "one", Severity: severity})
		next.Domains[0].Signals[0].IdentityKnown = false
		if err := s.AppendTrends(next); err != nil {
			t.Fatal(err)
		}
		reopen()
	}
	out, err := s.QueryTrends(TrendQuery{Context: first.Context, From: epoch, To: epoch.Add(2 * time.Hour), TransitionDetails: true})
	if err != nil || len(out.TransitionHours) != 2 {
		t.Fatal(out, err)
	}
	for i, h := range out.TransitionHours {
		want := uint64(2)
		if i == 1 {
			want = 1
		}
		if h.Incomplete != (i == 0) || h.Reasons["missing-uid"] != want || len(h.Reasons) != 1 || len(h.Groups) != 1 || h.Groups[0].Reasons["missing-uid"] != want {
			t.Fatal("legacy evidence fabricated, counters erased, or new hour marked incomplete", h)
		}
	}
	if out.Severity[0].ChangesScore != 0 {
		t.Fatal("diagnostic candidates became events", out)
	}
}

func TestTransitionHoursCapacityDoesNotRejectMainAppend(t *testing.T) {
	for _, headroom := range []int64{0, 512, 4096} {
		t.Run(strconv.FormatInt(headroom, 10), func(t *testing.T) {
			s, path := trendStore(t, 30)
			first := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
			if err := s.AppendTrends(first); err != nil {
				t.Fatal(err)
			}
			next := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "one", Severity: "medium"})
			// Measure the exact canonical replacement delta without diagnostic bytes.
			var canonicalDelta int64
			if err := s.db.View(func(tx *bolt.Tx) error {
				b := tx.Bucket(trendBucket).Bucket(signalContextKey(first.Context))
				var old TrendBatch
				if err := json.Unmarshal(b.Get([]byte("current")), &old); err != nil {
					return err
				}
				state, hour := reduceTrends(old, next)
				state.Diagnostics.LastSample = next.At
				state.Diagnostics.SourceAt = next.At
				// Same-hour baseline makes transition coverage partial.
				for i := range hour.Groups {
					hour.Groups[i].ChangesCoverage = "partial"
				}
				current, _ := json.Marshal(state)
				payload, _ := json.Marshal(hour)
				canonicalDelta = int64(len(current) - len(b.Get([]byte("current"))) + len(payload) - len(b.Bucket([]byte("hours")).Get(stamp(epoch.Unix()))))
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.db.Update(func(tx *bolt.Tx) error {
				return tx.Bucket(trendBucket).Put([]byte("bytes"), stamp(trendRetainedMaxBytes-canonicalDelta-headroom))
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.AppendTrends(next); err != nil {
				t.Fatal("diagnostics rejected canonical append", err)
			}
			out, err := s.QueryTrends(TrendQuery{Context: first.Context, From: epoch, To: epoch.Add(time.Hour), TransitionDetails: true})
			if err != nil {
				t.Fatal(err)
			}
			if out.Severity[0].Points[0].ConfirmedChanges != 1 {
				t.Fatal(out)
			}
			if out.Diagnostics.RetainedBytes > trendRetainedMaxBytes {
				t.Fatal("cap exceeded")
			}
			if headroom == 0 && len(out.TransitionHours) != 0 {
				t.Fatal("summary exceeded zero headroom")
			}
			if headroom != 0 {
				return
			}
			// Release the synthetic retained-cap pressure, as pruning would, and
			// prove later evidence cannot claim the omitted part of this hour.
			if err := s.db.Update(func(tx *bolt.Tx) error {
				root := tx.Bucket(trendBucket)
				b := root.Bucket(signalContextKey(first.Context))
				total := int64(len(b.Get([]byte("current"))))
				if err := b.Bucket([]byte("hours")).ForEach(func(_, v []byte) error { total += int64(len(v)); return nil }); err != nil {
					return err
				}
				return root.Put([]byte("bytes"), stamp(total))
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = OpenReal(path, 30)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Close(); err != nil {
					t.Error(err)
				}
			})
			for i, severity := range []string{"high", "medium"} {
				next = trendFixture(epoch.Add(time.Duration(i+2)*time.Minute), TrendSignal{ID: "one", Severity: severity})
				next.Domains[0].Signals[0].IdentityKnown = false
				if err := s.AppendTrends(next); err != nil {
					t.Fatal(err)
				}
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				s, err = OpenReal(path, 30)
				if err != nil {
					t.Fatal(err)
				}
				out, err = s.QueryTrends(TrendQuery{Context: first.Context, From: epoch, To: epoch.Add(time.Hour), TransitionDetails: true})
				if err != nil || len(out.TransitionHours) != 1 {
					t.Fatal(out, err)
				}
				h := out.TransitionHours[0]
				if !h.Incomplete || h.Reasons["missing-uid"] != uint64(i+1) || len(h.Reasons) != 1 || h.Groups[0].Reasons["missing-uid"] != uint64(i+1) {
					t.Fatal("omitted history claimed complete or later counters erased", h)
				}
				if out.Severity[0].Points[0].ConfirmedChanges != 1 {
					t.Fatal("diagnostic growth erased canonical changes", out)
				}
			}
		})
	}
}
