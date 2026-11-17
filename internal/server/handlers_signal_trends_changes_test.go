package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// The dataplane regression owns real snapshot/detector integration. This fixture
// exercises the managed publication collector through the actual authenticated
// HTTP router, without Kubernetes or a live application store.
type changedTrendHTTPSource struct {
	q       *localhistory.PublicationQueue
	changed atomic.Bool
}

func (s *changedTrendHTTPSource) SubscribeHistoryPublications(name, epoch string) (*localhistory.PublicationQueue, func(), error) {
	q, err := localhistory.NewPublicationQueue(name, epoch, 8)
	s.q = q
	return q, func() { q.Close() }, err
}
func (s *changedTrendHTTPSource) HistoryPublicationBatch(_ context.Context, event localhistory.Publication, at time.Time) localhistory.TrendBatch {
	severity := "high"
	if s.changed.Load() {
		severity = "medium"
	}
	node := localhistory.TrendNodeKey("synthetic-worker", "synthetic-uid")
	return localhistory.TrendBatch{Context: event.Context, Epoch: event.Epoch, Policy: "policy", At: at,
		Domains: []localhistory.TrendDomain{{Rule: "node_resource_pressure", SourceAt: at, Complete: true,
			Signals: []localhistory.TrendSignal{{ID: "known", IdentityKey: "known-resource", IdentityKnown: true, Severity: severity, Node: node}, {ID: "unknown-peer", IdentityKey: "unknown-resource", Severity: "low", Node: node}}}},
		Diagnostics: localhistory.TrendDiagnostics{SupportedRules: []string{"node_resource_pressure"}, Reasons: map[string]int{}},
	}
}
func TestTrendsHTTPConfirmedChangesPartialCoverage(t *testing.T) {
	source := &changedTrendHTTPSource{}
	c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a", Directory: filepath.Join(t.TempDir(), "history"), RetentionDays: 30}, source)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	s := &Server{token: "fixture-token", readOnly: true, historyCollectors: map[string]*localhistory.Collector{"synthetic-a": c}, dp: &stubDataplane{}}
	handler := s.Router()
	from := time.Now().UTC().Truncate(time.Hour)
	path := "/api/history/signal-trends?from=" + from.Format(time.RFC3339) + "&to=" + from.Add(time.Hour).Format(time.RFC3339) + "&rulesMode=topChanges10&nodesMode=topChanges10&namespacesMode=topChanges10"
	read := func() localhistory.TrendResponse {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer fixture-token")
		r.Header.Set("X-Kview-Context", "synthetic-a")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var out localhistory.TrendResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return out
	}
	wait := func(changes int) localhistory.TrendResponse {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			out := read()
			if len(out.Severity) > 0 && len(out.Severity[0].Points) > 0 {
				p := out.Severity[0].Points[0]
				// The store commit precedes collector status publication; await both.
				if p.Counts != nil && p.ConfirmedChanges == changes && !c.Status().LastSuccess.Before(p.SampleAt) {
					return out
				}
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("HTTP did not expose publication", c.Status())
		return localhistory.TrendResponse{}
	}
	wait(0) // initial observation is a baseline, not an appearance
	source.changed.Store(true)
	if !source.q.Enqueue(localhistory.Publication{Context: "synthetic-a", Kind: "nodes", Revision: 1, ObservedAt: time.Now().UTC()}) {
		t.Fatal("enqueue")
	}
	out := wait(1)
	if out.Severity[0].Points[0].ChangesCoverage != "partial" {
		t.Fatal("partial transition evidence upgraded", out)
	}
	for _, series := range [][]localhistory.TrendSeries{out.Rules, out.Nodes} {
		if len(series) != 1 || series[0].ChangesScore != 1 || series[0].Points[0].ConfirmedChanges != 1 || series[0].Points[0].ChangesCoverage != "partial" {
			t.Fatal("HTTP lost confirmed partial ranking", series)
		}
	}
	before := c.Status()
	read()
	if !reflect.DeepEqual(c.Status(), before) {
		t.Fatal("HTTP read triggered collection")
	}
}
