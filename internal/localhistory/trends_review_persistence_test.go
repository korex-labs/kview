package localhistory

import (
	"encoding/json"
	bolt "go.etcd.io/bbolt"
	"reflect"
	"testing"
	"time"
)

func TestTrendsReviewGenerationRestartAndLegacy(t *testing.T) {
	s, path := trendStore(t, 30)
	a := trendFixture(epoch)
	a.Diagnostics.UnsupportedRules = nil
	a.Domains[0].Generation = "first"
	if err := s.AppendTrends(a); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	b := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "service", Severity: "high"})
	b.Diagnostics.UnsupportedRules = nil
	b.Domains[0].SourceAt = epoch
	b.Domains[0].Generation = "second"
	if err = s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	b.At = b.At.Add(time.Minute)
	b.Domains[0].Signals = nil
	if err = s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: a.Context, From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour)}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	p := out.Severity[0].Points[0]
	if p.Counts.High != 1 || p.Counts.Changes != 1 || p.ChangesCoverage != "partial" {
		t.Fatal("restart/replay/hourly evidence lost", p)
	}
	// Real legacy JSON hour: absence of additive coverage must not claim completeness.
	err = s.db.Update(func(tx *bolt.Tx) error {
		h := tx.Bucket(trendBucket).Bucket(signalContextKey(a.Context)).Bucket([]byte("hours"))
		var record map[string]any
		if err := json.Unmarshal(h.Get(stamp(q.From.Unix())), &record); err != nil {
			return err
		}
		for _, v := range record["groups"].([]any) {
			delete(v.(map[string]any), "changesCoverage")
		}
		raw, e := json.Marshal(record)
		if e != nil {
			return e
		}
		return h.Put(stamp(q.From.Unix()), raw)
	})
	if err != nil {
		t.Fatal(err)
	}
	out, err = s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	if p = out.Severity[0].Points[0]; p.ChangesCoverage != "unknown" || p.Counts.High != 1 {
		t.Fatal("legacy coverage guessed", p)
	}
}

func TestTrendsReviewChangesCoverageMatrix(t *testing.T) {
	a := trendFixture(epoch)
	a.Diagnostics.UnsupportedRules = nil
	old, _ := reduceTrends(TrendBatch{}, a)
	for _, tc := range []struct {
		name   string
		mutate func(*TrendBatch)
		want   string
	}{
		{"complete", func(b *TrendBatch) {}, "complete"},
		{"identity", func(b *TrendBatch) { b.Domains[0].TransitionsUnknown = true }, "unknown"},
		{"policy", func(b *TrendBatch) { b.Policy = "different" }, "unknown"},
		{"gap", func(b *TrendBatch) { b.Domains[0].Complete = false }, "unknown"},
		{"mixed", func(b *TrendBatch) {
			b.Domains = append(b.Domains, TrendDomain{Namespace: "other", Rule: "other", SourceAt: b.At, Complete: true, TransitionsUnknown: true})
		}, "partial"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := trendFixture(epoch.Add(time.Minute))
			b.Diagnostics.UnsupportedRules = nil
			tc.mutate(&b)
			_, h := reduceTrends(old, b)
			g := trendGroup(t, h, "severity", "all")
			if g.ChangesCoverage != tc.want {
				t.Fatal(g)
			}
		})
	}
}

func TestTrendsReviewAdmissionDeterministicAndHourlyChurn(t *testing.T) {
	// Each tick individually fits; only the within-hour union exceeds the cap.
	makeHour := func(prefix string) TrendHour {
		h := TrendHour{}
		h.Groups = append(h.Groups, TrendGroup{Kind: "severity", Key: "all"})
		for i := 0; i < TrendMaxGroups-1; i++ {
			h.Groups = append(h.Groups, TrendGroup{Kind: "rules", Key: prefix + string(rune(i+32))})
		}
		return h
	}
	prior := makeHour("a")
	next := makeHour("b")
	next.Groups = append(next.Groups, prior.Groups[1:]...)
	reversed := TrendHour{Groups: append([]TrendGroup(nil), next.Groups...)}
	for i, j := 0, len(reversed.Groups)-1; i < j; i, j = i+1, j-1 {
		reversed.Groups[i], reversed.Groups[j] = reversed.Groups[j], reversed.Groups[i]
	}
	b, c := TrendBatch{}, TrendBatch{}
	admitTrendGroups(&b, &next, prior)
	admitTrendGroups(&c, &reversed, prior)
	if len(next.Groups) != TrendMaxGroups || !reflect.DeepEqual(next, reversed) || b.Diagnostics.CapLosses != TrendMaxGroups-1 {
		t.Fatal("unstable or unbounded admission")
	}
	keys := map[string]bool{}
	for _, g := range next.Groups {
		keys[trendKey(g.Kind, g.Key)] = true
	}
	for _, g := range prior.Groups {
		if !keys[trendKey(g.Kind, g.Key)] {
			t.Fatal("previous admission evicted", g)
		}
	}
}
