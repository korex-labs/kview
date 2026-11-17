package server

import (
	"context"
	"encoding/json"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"io"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type signalZeroReader struct{}

func (signalZeroReader) Read([]byte) (int, error) { return 0, nil }
func (signalZeroReader) Close() error             { return nil }

type trendHTTPSource struct {
	calls atomic.Int32
}

func (*trendHTTPSource) SubscribeHistoryPublications(name, epoch string) (*localhistory.PublicationQueue, func(), error) {
	q, err := localhistory.NewPublicationQueue(name, epoch, 8)
	return q, func() { q.Close() }, err
}
func (s *trendHTTPSource) HistoryPublicationBatch(_ context.Context, event localhistory.Publication, at time.Time) localhistory.TrendBatch {
	name, epoch := event.Context, event.Epoch
	s.calls.Add(1)
	return localhistory.TrendBatch{Context: name, Epoch: epoch, Policy: "policy", At: at, Domains: []localhistory.TrendDomain{{Rule: "node_resource_pressure", SourceAt: at, Complete: true, Signals: []localhistory.TrendSignal{{ID: "a", IdentityKnown: true, Severity: "high", Node: localhistory.TrendNodeKey("worker", "uid-a")}}}}, Diagnostics: localhistory.TrendDiagnostics{SupportedRules: []string{"node_resource_pressure"}, UnsupportedRules: []string{"detail-only"}, Reasons: map[string]int{}}}
}
func TestTrendsAuthenticatedGETContextFiltersNoIO(t *testing.T) {
	source := &trendHTTPSource{}
	c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a", Directory: filepath.Join(t.TempDir(), "history"), RetentionDays: 30}, source)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	deadline := time.Now().Add(5 * time.Second)
	for c.Status().LastSuccess.IsZero() {
		if time.Now().After(deadline) {
			t.Fatal(c.Status())
		}
		time.Sleep(time.Millisecond)
	}
	s := &Server{token: "secret", readOnly: true, historyCollectors: map[string]*localhistory.Collector{"synthetic-a": c}, dp: &stubDataplane{}}
	handler := s.Router()
	from := c.Status().LastSuccess.UTC().Truncate(time.Hour)
	path := "/api/history/signal-trends?from=" + from.Format(time.RFC3339) + "&to=" + from.Add(2*time.Hour).Format(time.RFC3339)
	request := func(method, path, token, name string, body io.Reader) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, body)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if name != "" {
			r.Header.Set("X-Kview-Context", name)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		name, token string
		code        int
	}{{"synthetic-a", "", 401}, {"", "secret", 400}, {"synthetic-ab", "secret", 409}, {"synthetic-a", "secret", 200}} {
		w := request("GET", path, tc.token, tc.name, nil)
		if w.Code != tc.code {
			t.Fatalf("%+v: %d %s", tc, w.Code, w.Body.String())
		}
	}
	before, calls := c.Status(), source.calls.Load()
	for _, suffix := range []string{"", "&diagnostics=transitions", "&nodesMode=topHigh10", "&rulesMode=custom&rule=node_resource_pressure", "&nodesMode=custom&node=" + url.QueryEscape(localhistory.TrendNodeKey("worker", "uid-a")), "&namespacesMode=favourites&namespace=apps", "&namespacesMode=recent&namespace=apps", "&namespacesMode=tag&namespace=apps"} {
		w := request("GET", path+suffix, "secret", "synthetic-a", nil)
		var got localhistory.TrendResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		if suffix == "&diagnostics=transitions" {
			if got.TransitionDiagnostics == nil || got.TransitionDiagnostics.Context != "synthetic-a" || got.TransitionDiagnostics.Reasons["no-previous-baseline"] != 1 {
				t.Fatal("missing internal diagnostics", w.Body.String())
			}
		} else if got.TransitionDiagnostics != nil || strings.Contains(w.Body.String(), "transitionDiagnostics") {
			t.Fatal("default details leak")
		}
		if got.Context != "synthetic-a" || len(got.Severity) != 1 || len(got.Severity[0].Points) != 2 || got.Severity[0].Points[0].Counts.High != 1 || got.Severity[0].Points[0].Counts.Changes != 0 || got.Severity[0].Points[1].Counts != nil {
			t.Fatal(w.Body.String())
		}
		point, future := got.Severity[0].Points[0], got.Severity[0].Points[1]
		if got.AsOf.Before(point.SampleAt) || got.AsOf.After(time.Now().UTC()) || point.SourceAt.IsZero() || point.SourceAgeSeconds == nil || point.CarriedForward || point.ConfirmedChanges != 0 || future.CarriedForward || future.Freshness != "unknown" || future.ChangesCoverage != "unknown" {
			t.Fatal("wire provenance or future gap changed", w.Body.String())
		}
		for _, field := range []string{`"asOf":`, `"freshness":`, `"sourceAgeSeconds":`, `"confirmedChanges":`, `"sampleAt":`, `"sourceAt":`} {
			if !strings.Contains(w.Body.String(), field) {
				t.Fatal("missing wire field", field, w.Body.String())
			}
		}
	}
	w := request("GET", path+"&rulesMode=custom&nodesMode=custom&namespacesMode=custom", "secret", "synthetic-a", nil)
	var got localhistory.TrendResponse
	if json.Unmarshal(w.Body.Bytes(), &got) != nil || len(got.Rules) != 0 || len(got.Nodes) != 0 || len(got.Namespaces) != 0 {
		t.Fatal("empty selection is not all", w.Body.String())
	}
	for _, suffix := range []string{"&diagnostics=", "&diagnostics=all", "&diagnostics=transitions&diagnostics=transitions", "&unknown=1", "&rule=", "&rule=foo", "&rulesMode=bad", "&nodesMode=bad", "&rulesMode=custom&rule=a&rule=a", "&from=2026-01-01T00:00:00Z", "&context=synthetic-b", "&nodesMode=custom&node=worker", "&rulesMode=custom" + strings.Repeat("&rule=a", 21), "&namespacesMode=tag&namespace=bad%00name"} {
		w = request("GET", path+suffix, "secret", "synthetic-a", nil)
		if w.Code != 400 {
			t.Fatal(suffix, w.Code, w.Body.String())
		}
	}
	for _, body := range []io.Reader{strings.NewReader("x"), signalZeroReader{}} {
		if w = request("GET", path, "secret", "synthetic-a", body); w.Code != 400 {
			t.Fatal("body accepted", w.Code)
		}
	}
	r := httptest.NewRequest("GET", path, nil)
	r.Header.Set("Authorization", "Bearer secret")
	r.Header.Add("X-Kview-Context", "synthetic-a")
	r.Header.Add("X-Kview-Context", "synthetic-a")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal("duplicate context", w.Code)
	}
	if w = request("POST", path, "secret", "synthetic-a", nil); w.Code < 400 {
		t.Fatal("mutation accepted")
	}
	if w = request("GET", path+"&token=secret", "", "synthetic-a", nil); w.Code < 400 {
		t.Fatal("query auth accepted")
	}
	if !reflect.DeepEqual(c.Status(), before) || source.calls.Load() != calls || !isBackgroundPollingPath("/api/history/signal-trends") {
		t.Fatal("GET performed collection or foreground activity")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelled := httptest.NewRequest("GET", path+"&diagnostics=transitions", nil).WithContext(ctx)
	cancelled.Header.Set("Authorization", "Bearer secret")
	cancelled.Header.Set("X-Kview-Context", "synthetic-a")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, cancelled)
	if w.Body.Len() != 0 {
		t.Fatal("request context was not propagated", w.Body.String())
	}
	delete(s.historyCollectors, "synthetic-a")
	if w = request("GET", path, "secret", "synthetic-a", nil); w.Code != 409 {
		t.Fatal("default consent not off", w.Code)
	}
	s.historyCollectors["synthetic-a"] = c
	c.Close()
	if w = request("GET", path, "secret", "synthetic-a", nil); w.Code != 503 {
		t.Fatal("closed store", w.Code)
	}
}
