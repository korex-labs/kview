package localhistory

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestTrendsTopChangesPositiveCandidatesOnly(t *testing.T) {
	for _, positives := range []int{0, 1, 12} {
		t.Run(fmt.Sprintf("positives-%d", positives), func(t *testing.T) {
			s, _ := trendStore(t, 30)
			from := epoch.Truncate(time.Hour)
			b := trendFixture(from)
			if err := s.AppendTrends(b); err != nil {
				t.Fatal(err)
			}
			hour := TrendHour{At: from, Epoch: b.Epoch}
			keys := map[string][]string{}
			for _, kind := range []string{"rules", "nodes", "namespaces"} {
				add := func(name string, counts *TrendCounts, coverage string, changes int) {
					key := name
					if kind == "nodes" {
						key = TrendNodeKey(name, "uid-"+name)
					}
					keys[kind] = append(keys[kind], key)
					hour.Groups = append(hour.Groups, TrendGroup{Kind: kind, Key: key, Label: name, TrendPoint: TrendPoint{At: from, SampleAt: from, SourceAt: from, Counts: counts, Coverage: coverage, ChangesCoverage: coverage, ConfirmedChanges: changes}})
				}
				add("zero-complete", &TrendCounts{}, "complete", 0)
				add("zero-partial", &TrendCounts{High: 5}, "partial", 0)
				add("zero-unknown", nil, "unknown", 0)
				for i := 0; i < positives; i++ {
					// Confirmed transitions remain candidates even without active counts.
					add(fmt.Sprintf("positive-%02d", i), nil, "partial", i+1)
				}
			}
			if err := s.db.Update(func(tx *bolt.Tx) error {
				data, err := json.Marshal(hour)
				if err != nil {
					return err
				}
				return tx.Bucket(trendBucket).Bucket(signalContextKey(b.Context)).Bucket([]byte("hours")).Put(stamp(from.Unix()), data)
			}); err != nil {
				t.Fatal(err)
			}
			q := TrendQuery{Context: b.Context, From: from, To: from.Add(2 * time.Hour), AsOf: from.Add(time.Hour), RulesMode: "topChanges10", NodesMode: "topChanges10", NamespacesMode: "topChanges10"}
			out, err := s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			for _, series := range [][]TrendSeries{out.Rules, out.Nodes, out.Namespaces} {
				if len(series) != min(positives, 10) {
					t.Fatalf("wanted only positive candidates, got %+v", series)
				}
				for i, row := range series {
					if row.ChangesScore != positives-i || row.Points[0].ConfirmedChanges != positives-i {
						t.Fatalf("incorrect score/order: %+v", row)
					}
				}
			}
			q.RulesMode, q.NodesMode, q.NamespacesMode = "custom", "custom", "custom"
			q.Rules, q.Nodes, q.Namespaces = keys["rules"][:3], keys["nodes"][:3], keys["namespaces"][:3]
			out, err = s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			for _, series := range [][]TrendSeries{out.Rules, out.Nodes, out.Namespaces} {
				if len(series) != 3 || series[0].Points[0].Counts == nil || series[1].Points[0].Coverage != "partial" || series[2].Points[0].Counts != nil {
					t.Fatalf("explicit zero/unknown selections changed: %+v", series)
				}
			}
		})
	}
}
