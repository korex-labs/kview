package localhistory

import (
	"fmt"
	"testing"
	"time"
)

func TestTrendCatalogBeforeRankingAndContextScoped(t *testing.T) {
	s, _ := trendStore(t, 30)
	b := trendFixture(epoch)
	b.Domains = nil
	for i := 0; i < 25; i++ {
		name := fmt.Sprintf("apps-%02d", i)
		b.Domains = append(b.Domains, TrendDomain{Namespace: name, Rule: "pod_crash_loop_waiting", SourceAt: epoch, Complete: true, Signals: []TrendSignal{{ID: name, IdentityKnown: true, Severity: "high", Node: TrendNodeKey("worker", name)}}})
	}
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	b.At = epoch.Add(time.Minute)
	for i := range b.Domains {
		b.Domains[i].SourceAt = b.At
		b.Domains[i].Signals[0].Severity = "medium"
	}
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(time.Hour), AsOf: epoch.Add(2 * time.Minute)}
	got, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 10 || len(got.Catalog.Nodes) != 25 || len(got.Catalog.Namespaces) != 25 || got.Catalog.Truncated {
		t.Fatal("catalog limited to ranking", got.Catalog)
	}
	q.Context = "synthetic-other"
	got, err = s.QueryTrends(q)
	if err != nil || len(got.Catalog.Nodes) != 0 {
		t.Fatal("context leakage", got.Catalog, err)
	}
}
func TestTrendCatalogBoundedStable(t *testing.T) {
	rows := map[string]*TrendSeries{}
	for i := 0; i <= TrendCatalogLimit; i++ {
		key := fmt.Sprintf("ns-%05d", i)
		rows[key] = &TrendSeries{Key: key, Label: key}
	}
	got := catalogFromSeries(map[string]map[string]*TrendSeries{"namespaces": rows})
	if !got.Truncated || len(got.Namespaces) != TrendCatalogLimit || got.Namespaces[0].Key != "ns-00000" {
		t.Fatal("unbounded or unordered")
	}
}
