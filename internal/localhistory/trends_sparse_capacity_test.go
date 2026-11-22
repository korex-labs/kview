package localhistory

import (
	"fmt"
	"strings"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestSparseCanonicalComparatorCapacity(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		n, uidBytes              int
		mutate, retainedPressure bool
	}{
		{"identical-11000", 11000, 0, false, false},
		{"signal-limit", 11000, 0, true, false},
		{"state-byte-limit", 8000, 512, true, false},
		{"retained-byte-limit", 1000, 128, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := trendStore(t, 30)
			rows := make([]TrendSignal, tc.n)
			for i := range rows {
				rows[i] = TrendSignal{ID: fmt.Sprint(i), Severity: "low", ResourceUID: strings.Repeat("u", tc.uidBytes)}
			}
			b := trendFixture(epoch, rows...)
			b.FullProjection = true
			d := &b.Domains[0]
			d.CachedPopulation, d.SourceStatus = true, "available"
			appendBatch := func() {
				t.Helper()
				if err := s.AppendTrends(b); err != nil {
					t.Fatal(err)
				}
			}
			appendBatch()
			var syntheticBytes int64
			if tc.retainedPressure {
				// Simulate other contexts occupying all but 16 KiB of headroom.
				if err := s.db.Update(func(tx *bolt.Tx) error {
					root := tx.Bucket(trendBucket)
					syntheticBytes = trendRetainedMaxBytes - 16*1024 - number(root.Get([]byte("bytes")))
					return root.Put([]byte("bytes"), stamp(trendRetainedMaxBytes-16*1024))
				}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.mutate {
				d.Signals[0].Severity = "medium"
			}
			b.At = epoch.Add(time.Hour)
			// The stale canonical clock cannot extend or shorten comparator retention.
			d.SourceAt = epoch.Add(-31 * 24 * time.Hour)
			d.SourceStatus, d.TransitionsUnknown = "source-stale", true
			appendBatch()
			if err := s.db.View(func(tx *bolt.Tx) error {
				root := tx.Bucket(trendBucket)
				var state TrendBatch
				if err := decodeTrend(root.Bucket(signalContextKey(b.Context)).Get([]byte("current")), &state, trendStateMaxBytes); err != nil {
					return err
				}
				got := state.Domains[0]
				if len(got.Signals) != tc.n || got.Signals[0] != d.Signals[0] || !got.Complete || state.Diagnostics.CapLosses != 0 || got.retainedSignals() > TrendMaxSignals || number(root.Get([]byte("bytes"))) > trendRetainedMaxBytes {
					t.Fatal("canonical admission or budget violated")
				}
				if tc.mutate == got.ComparisonLostAt.IsZero() || (!tc.mutate && (got.LastComplete == nil || !got.LastComplete.UsesCurrent)) {
					t.Fatal("unexpected retained comparator")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if tc.retainedPressure {
				if err := s.db.Update(func(tx *bolt.Tx) error {
					root := tx.Bucket(trendBucket)
					return root.Put([]byte("bytes"), stamp(number(root.Get([]byte("bytes")))-syntheticBytes))
				}); err != nil {
					t.Fatal(err)
				}
			}
			// A second stale sample must not clear the loss marker. A new
			// complete sample may compare only against retained evidence.
			b.At = b.At.Add(time.Minute)
			appendBatch()
			b.At = epoch.Add(2 * time.Hour)
			d.SourceAt, d.SourceStatus, d.TransitionsUnknown = b.At, "available", false
			d.Signals[0].Severity = "high"
			appendBatch()
			out, err := s.QueryTrends(TrendQuery{Context: b.Context, From: b.At, To: b.At.Add(time.Hour), AsOf: b.At.Add(time.Minute)})
			if err != nil {
				t.Fatal(err)
			}
			p := out.Severity[0].Points[0]
			want := 1
			if tc.mutate {
				want = 0
			}
			if p.Counts == nil || p.Counts.High != 1 || p.Counts.Low != tc.n-1 || p.FirstSeen != 0 || p.ConfirmedChanges != want || (tc.mutate && p.ChangesCoverage == "complete") {
				t.Fatalf("recovery point = %+v, want %d changes and no discoveries", p, want)
			}
		})
	}
}
