package localhistory

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestTransitionHoursDurableRejectedRoundTrip(t *testing.T) {
	for _, sameHour := range []bool{false, true} {
		t.Run(fmt.Sprint(sameHour), func(t *testing.T) {
			s, path := trendStore(t, 30)
			node := TrendNodeKey("worker", "node-uid")
			signals := make([]TrendSignal, 12)
			for i := range signals {
				signals[i] = TrendSignal{ID: fmt.Sprint(i), IdentityKey: fmt.Sprint(i), ResourceUID: fmt.Sprint(i), Severity: "high", Node: node}
			}
			base := trendFixture(epoch, signals...)
			base.Domains[0].CachedPopulation = true
			if err := s.AppendTrends(base); err != nil {
				t.Fatal(err)
			}
			step := time.Hour
			if sameHour {
				step = time.Minute
			}
			for i := 1; i <= 2; i++ {
				b := trendFixture(epoch.Add(time.Duration(i)*step), append([]TrendSignal(nil), signals...)...)
				b.Domains[0].CachedPopulation = true
				if i == 1 {
					b.Domains[0].Signals = append(b.Domains[0].Signals, TrendSignal{ID: "unknown", IdentityKey: "unknown", Severity: "high", Node: node})
				}
				if err := s.AppendTrends(b); err != nil {
					t.Fatal(err)
				}
			}
			q := TrendQuery{TransitionDetails: true, Context: base.Context, From: epoch, To: epoch.Add(3 * time.Hour), AsOf: epoch.Add(3 * time.Hour), NodesMode: "custom", Nodes: []string{node}, RulesMode: "custom", Rules: []string{base.Domains[0].Rule}, NamespacesMode: "custom", Namespaces: []string{"apps"}}
			before, err := s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err = OpenReal(path, 30)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			after, err := s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before.TransitionHours, after.TransitionHours) {
				t.Fatal("restart lost rejection evidence")
			}
			total := uint64(0)
			for _, h := range after.TransitionHours {
				total += h.Reasons["missing-uid"]
				if h.Reasons["missing-uid"] > 0 {
					if len(h.Groups) != 1 || h.Groups[0].Node != node || h.Groups[0].Reasons["missing-uid"] != h.Reasons["missing-uid"] {
						t.Fatal("lost UID-scoped attribution", h)
					}
				}
			}
			if total != 2 {
				t.Fatalf("round trip must retain two rejected candidates, got %d: %+v", total, after.TransitionHours)
			}
			if sameHour && after.TransitionHours[0].Groups[0].DomainAfter.High != 12 {
				t.Fatal("last domain observation lost")
			}
			if len(after.Nodes) != 1 || after.Nodes[0].ChangesScore != 0 {
				t.Fatal("invented events", after.Nodes)
			}
			q.TransitionDetails = false
			plain, _ := s.QueryTrends(q)
			raw, _ := json.Marshal(plain)
			if strings.Contains(string(raw), "transitionHours") {
				t.Fatal("default payload leaked evidence")
			}
			q.TransitionDetails = true
			q.From = epoch.Add(time.Hour)
			rangeOut, _ := s.QueryTrends(q)
			for _, h := range rangeOut.TransitionHours {
				if h.At.Before(q.From) {
					t.Fatal("predecessor leaked")
				}
			}
			q.Context = "synthetic-ab"
			other, _ := s.QueryTrends(q)
			if len(other.TransitionHours) != 0 {
				t.Fatal("context leak")
			}
			q.Context = base.Context
			q.From = epoch
			q.Nodes = []string{TrendNodeKey("worker", "replacement-uid")}
			other, _ = s.QueryTrends(q)
			for _, h := range other.TransitionHours {
				if len(h.Groups) != 0 || len(h.Examples) != 0 {
					t.Fatal("UID selector leak")
				}
			}
			b := trendFixture(epoch.Add(2*time.Hour + time.Minute))
			b.Epoch = "replacement"
			if err = s.AppendTrends(b); err != nil {
				t.Fatal(err)
			}
			out, _ := s.QueryTrends(q)
			for _, h := range out.TransitionHours {
				if h.Epoch != "replacement" {
					t.Fatal("epoch leak")
				}
			}
		})
	}
}

func TestTransitionHoursOutliveRingWithNodeAttribution(t *testing.T) {
	s, path := trendStore(t, 30)
	b := trendFixture(epoch)
	for i := 0; i < 90; i++ {
		b.Domains[0].Signals = append(b.Domains[0].Signals, TrendSignal{ID: fmt.Sprint(i), IdentityKey: fmt.Sprint(i), IdentityKnown: true, Severity: "high", Node: TrendNodeKey(fmt.Sprintf("node-%d", i), fmt.Sprintf("uid-%d", i))})
	}
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	b.At = epoch.Add(time.Minute)
	b.Domains[0].SourceAt = b.At
	b.Domains[0].CachedPopulation = true
	b.Domains[0].TransitionsUnknown = true
	b.Domains[0].SourceStatus = "source-stale"
	b.Domains[0].Signals = nil
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	if s.transitionDiagnostics(b.Context, b.Epoch).Evicted == 0 {
		t.Fatal("fixture did not evict ring")
	}
	s.Close()
	var err error
	s, err = OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	q := TrendQuery{TransitionDetails: true, Context: b.Context, From: epoch, To: epoch.Add(time.Hour)}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	h := out.TransitionHours[0]
	if h.Reasons["source-stale"] != 90 || len(h.Groups) != 90 || h.TruncatedCandidates != 0 {
		t.Fatal("lost durable group attribution", h)
	}
	q.NodesMode = "custom"
	q.Nodes = []string{TrendNodeKey("node-63", "uid-63"), TrendNodeKey("node-89", "uid-89")}
	out, err = s.QueryTrends(q)
	if err != nil || len(out.TransitionHours[0].Groups) != 2 {
		t.Fatal("cannot inspect affected nodes", out, err)
	}
	for _, g := range out.TransitionHours[0].Groups {
		if g.Reasons["source-stale"] != 1 || g.DomainBefore.High != 90 || g.DomainAfter.High != 0 {
			t.Fatal(g)
		}
	}
}

func TestTransitionHoursCompactedCountsAndBounds(t *testing.T) {
	s, _ := trendStore(t, 30)
	for i, n := range []int{12, 13, 12} {
		b := trendFixture(epoch.Add(time.Duration(i) * time.Minute))
		b.Domains[0].CachedPopulation = true
		b.Domains[0].TransitionsUnknown = true
		b.Domains[0].SourceStatus = "identity-compacted"
		b.Domains[0].Signals = []TrendSignal{{ID: "compact", Severity: "high", Multiplicity: n, Node: TrendNodeKey("worker", "node-uid")}}
		if err := s.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
	}
	out, err := s.QueryTrends(TrendQuery{TransitionDetails: true, Context: "synthetic-a", From: epoch, To: epoch.Add(time.Hour)})
	if err != nil || len(out.TransitionHours) != 1 {
		t.Fatal(out, err)
	}
	h := out.TransitionHours[0]
	if h.Reasons["identity-compacted"] != 2 || h.Groups[0].DomainBefore.High != 13 || h.Groups[0].DomainAfter.High != 12 {
		t.Fatal("compacted deltas ignored", h)
	}
	if h.Examples[len(h.Examples)-1].Candidate != "population-count-candidate" {
		t.Fatal("count delta mislabeled")
	}
	bounded := newTransitionHour(epoch, "epoch")
	for i := 0; i < 1000; i++ {
		bounded.record(TransitionRejection{At: epoch, Namespace: "apps", Rule: "rule", Reason: "missing-uid", New: TransitionObservation{Node: TrendNodeKey(fmt.Sprintf("node-%03d", i)+strings.Repeat("x", 480), strings.Repeat("u", 480))}})
	}
	bounded = mergeTransitionHours(nil, bounded)
	raw, _ := json.Marshal(bounded)
	if len(raw) > TransitionHourMaxBytes || len(bounded.Groups) > TransitionHourGroupLimit || len(bounded.Examples) > TransitionHourExampleLimit || bounded.Reasons["missing-uid"] != 1000 || bounded.TruncatedCandidates == 0 || bounded.ExamplesOmitted == 0 {
		t.Fatal("unbounded or silently incomplete", len(raw), bounded)
	}
	retained := uint64(0)
	for _, g := range bounded.Groups {
		retained += g.Reasons["missing-uid"]
	}
	if retained+bounded.TruncatedCandidates != 1000 {
		t.Fatal("lost attribution accounting")
	}
}

func TestTransitionHoursLegacyOpenPruneAndAccounting(t *testing.T) {
	for _, days := range []int{30, 90} {
		t.Run(fmt.Sprint(days), func(t *testing.T) {
			s, path := trendStore(t, days)
			b := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
			if err := s.AppendTrends(b); err != nil {
				t.Fatal(err)
			}
			// An actual pre-extension hourly JSON document remains readable and is not
			// upgraded or rewritten merely by opening/querying the current database.
			var legacy []byte
			if err := s.db.Update(func(tx *bolt.Tx) error {
				root := tx.Bucket(trendBucket)
				hours := root.Bucket(signalContextKey(b.Context)).Bucket([]byte("hours"))
				key := stamp(epoch.Unix())
				old := hours.Get(key)
				var h TrendHour
				if err := json.Unmarshal(old, &h); err != nil {
					return err
				}
				h.TransitionEvidence = nil
				legacy, _ = json.Marshal(h)
				if err := root.Put([]byte("bytes"), stamp(number(root.Get([]byte("bytes")))+int64(len(legacy)-len(old)))); err != nil {
					return err
				}
				return hours.Put(key, legacy)
			}); err != nil {
				t.Fatal(err)
			}
			s.Close()
			var err error
			s, err = OpenReal(path, days)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			q := TrendQuery{TransitionDetails: true, Context: b.Context, From: epoch, To: epoch.Add(time.Hour)}
			out, err := s.QueryTrends(q)
			if err != nil || len(out.TransitionHours) != 0 {
				t.Fatal("legacy backfill", out, err)
			}
			if err = s.db.View(func(tx *bolt.Tx) error {
				if !bytes.Equal(legacy, tx.Bucket(trendBucket).Bucket(signalContextKey(b.Context)).Bucket([]byte("hours")).Get(stamp(epoch.Unix()))) {
					t.Fatal("legacy rewritten")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			b.At = epoch.Add(time.Hour)
			b.Domains[0].SourceAt = b.At
			b.Domains[0].Signals = nil
			b.Domains[0].CachedPopulation = true
			b.Domains[0].TransitionsUnknown = true
			b.Domains[0].SourceStatus = "source-stale"
			if err = s.AppendTrends(b); err != nil {
				t.Fatal(err)
			}
			q.To = epoch.Add(2 * time.Hour)
			out, err = s.QueryTrends(q)
			if err != nil || len(out.TransitionHours) != 1 || out.TransitionHours[0].Reasons["source-stale"] != 1 {
				t.Fatal(out, err)
			}
			cutoff := b.At.Add(time.Duration(days)*24*time.Hour + time.Hour)
			if err = s.pruneTrends(cutoff); err != nil {
				t.Fatal(err)
			}
			out, err = s.QueryTrends(q)
			if err != nil || len(out.TransitionHours) != 0 {
				t.Fatal("evidence survived retention", out, err)
			}
			if err = s.db.View(func(tx *bolt.Tx) error {
				root := tx.Bucket(trendBucket)
				sum := int64(0)
				err := root.ForEach(func(k, v []byte) error {
					if v != nil {
						return nil
					}
					c := root.Bucket(k)
					sum += int64(len(c.Get([]byte("current"))))
					return c.Bucket([]byte("hours")).ForEach(func(_, v []byte) error { sum += int64(len(v)); return nil })
				})
				if sum != number(root.Get([]byte("bytes"))) {
					t.Fatal("accounting excludes evidence", sum, number(root.Get([]byte("bytes"))))
				}
				return err
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
