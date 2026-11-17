package localhistory

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

// Seed retained hours directly to isolate query selection from detector coverage.
func TestTrendsZeroRankingBeforeTopPreservesUnknownIncompleteAndCustom(t *testing.T) {
	s, _ := trendStore(t, 30)
	from := epoch.Truncate(time.Hour)
	b := trendFixture(from)
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	hour := TrendHour{At: from, Epoch: b.Epoch}
	add := func(key string, counts *TrendCounts, coverage string) {
		hour.Groups = append(hour.Groups, TrendGroup{Kind: "rules", Key: key, Label: key, TrendPoint: TrendPoint{At: from, SampleAt: from, SourceAt: from, Counts: counts, Coverage: coverage, ChangesCoverage: coverage}})
	}
	for i := 0; i < 12; i++ {
		add(fmt.Sprintf("a-zero-%02d", i), &TrendCounts{}, "complete")
	}
	add("z-unknown", nil, "unknown")
	add("z-incomplete", &TrendCounts{}, "partial")
	add("z-positive", &TrendCounts{High: 2, Changes: 3}, "complete")
	add("a-low-changes", &TrendCounts{Low: 2, Changes: 4}, "complete")
	if err := s.db.Update(func(tx *bolt.Tx) error {
		data, err := json.Marshal(hour)
		if err != nil {
			return err
		}
		return tx.Bucket(trendBucket).Bucket(signalContextKey(b.Context)).Bucket([]byte("hours")).Put(stamp(from.Unix()), data)
	}); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: from, To: from.Add(time.Hour), AsOf: from.Add(time.Minute)}
	for _, mode := range []string{"topHigh10", "topChanges10"} {
		q.RulesMode = mode
		out, err := s.QueryTrends(q)
		if err != nil {
			t.Fatal(err)
		}
		keys := []string{}
		for _, v := range out.Rules {
			keys = append(keys, v.Key)
		}
		want := []string{"a-low-changes", "z-positive"}
		if mode == "topHigh10" {
			want = []string{"z-positive", "z-incomplete", "z-unknown"}
		}
		if !reflect.DeepEqual(keys, want) {
			t.Fatalf("%s zero rows displaced eligible rows: %v", mode, keys)
		}
		if len(out.Catalog.Rules) != 16 {
			t.Fatalf("%s pruned catalog: %+v", mode, out.Catalog)
		}
	}
	q.RulesMode = "custom"
	q.Rules = []string{"a-zero-00", "z-unknown", "z-incomplete", "missing"}
	out, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Rules) != 4 || out.Rules[0].Points[0].Counts == nil || *out.Rules[0].Points[0].Counts != (TrendCounts{}) || out.Rules[1].Points[0].Counts != nil || out.Rules[2].Points[0].Coverage != "partial" || out.Rules[3].Points[0].Counts != nil {
		t.Fatalf("custom selection changed: %+v", out.Rules)
	}
}

func TestTrendsCanonicalCapRejectionAtomicAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	b := trendFixture(epoch, TrendSignal{ID: "baseline", Severity: "high"})
	b.FullProjection = true
	if err = s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour), AsOf: epoch.Add(2 * time.Minute)}
	before, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	current := func() []byte {
		var raw []byte
		if err := s.db.View(func(tx *bolt.Tx) error {
			raw = append(raw, tx.Bucket(trendBucket).Bucket(signalContextKey(b.Context)).Get([]byte("current"))...)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	prior := current()
	b.At = b.At.Add(time.Minute)
	b.Domains = nil
	for i := 0; i < TrendMaxGroups; i++ {
		b.Domains = append(b.Domains, TrendDomain{Namespace: "apps", Rule: fmt.Sprintf("rule-%04d", i), SourceAt: b.At, Complete: true, CachedPopulation: true})
	}
	if err = b.Validate(); err != nil {
		t.Fatal("fixture must reach storage admission", err)
	}
	if err = s.AppendTrends(b); err == nil || !strings.Contains(err.Error(), "canonical projection storage cap") {
		t.Fatal("canonical cap not rejected", err)
	}
	if !reflect.DeepEqual(prior, current()) {
		t.Fatal("rejected batch replaced current projection")
	}
	verify := func() {
		t.Helper()
		out, err := s.QueryTrends(q)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before.Severity, out.Severity) || !reflect.DeepEqual(before.Rules, out.Rules) || !reflect.DeepEqual(before.Catalog, out.Catalog) {
			t.Fatal("rejected batch changed retained results")
		}
	}
	verify()
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	verify()
	if !reflect.DeepEqual(prior, current()) {
		t.Fatal("reopen changed preserved projection")
	}
}
