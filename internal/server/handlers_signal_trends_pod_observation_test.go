package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Reopen a retained hour under the real collector and GET router. GET must not
// need the source that produced the evidence (its new baseline is in another hour).
func TestImagePullObservationRetainedGET(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "history")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	cfg := localhistory.Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a", Directory: dir, RetentionDays: 30}
	path := filepath.Join(dir, "history-real-v1.db")
	s, err := localhistory.OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Truncate(time.Hour).Add(-time.Hour)
	rule := "pod_image_pull_failure"
	b := localhistory.TrendBatch{Context: cfg.QueryContext, Epoch: cfg.SignalEpoch, At: start, Policy: "policy", FullProjection: true, PodObservationScopes: []string{"apps"}}
	b.CapturePodObservation = func(string) localhistory.PodObservation {
		return localhistory.PodObservation{PodCapture: localhistory.PodCapture{At: b.At, Membership: "listed", Catalog: localhistory.ObservationCell{Status: "available"}, Pods: localhistory.ObservationCell{Status: "source-missing"}}}
	}
	if err = s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	b.At = b.At.Add(time.Minute)
	b.Domains = []localhistory.TrendDomain{{Namespace: "apps", Rule: rule, Complete: true, SourceAt: b.At, EvidenceAt: b.At, Signals: []localhistory.TrendSignal{{ID: "example", Severity: "high", IdentityKnown: true}}}}
	b.CapturePodObservation = func(string) localhistory.PodObservation {
		return localhistory.PodObservation{PodCapture: localhistory.PodCapture{At: b.At, Membership: "listed", PodsPresent: true, Catalog: localhistory.ObservationCell{Status: "available"}, Pods: localhistory.ObservationCell{Status: "available"}}}
	}
	if err = s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	source := &trendHTTPSource{}
	c, err := localhistory.StartManaged(context.Background(), cfg, source)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	handler := (&Server{token: "synthetic-token", readOnly: true, historyCollectors: map[string]*localhistory.Collector{cfg.QueryContext: c}, dp: &stubDataplane{}}).Router()
	url := "/api/history/signal-trends?from=" + start.Format(time.RFC3339) + "&to=" + start.Add(time.Hour).Format(time.RFC3339) + "&rulesMode=custom&rule=" + rule
	for _, tc := range []struct {
		query, name string
		code        int
		want        bool
	}{{"", cfg.QueryContext, 200, false}, {"&diagnostics=transitions", cfg.QueryContext, 200, true}, {"&diagnostics=transitions&namespacesMode=custom&namespace=elsewhere", cfg.QueryContext, 200, false}, {"&diagnostics=transitions", "synthetic-ab", 409, false}} {
		r := httptest.NewRequest("GET", url+tc.query, nil)
		r.Header.Set("Authorization", "Bearer synthetic-token")
		r.Header.Set("X-Kview-Context", tc.name)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.code || strings.Contains(w.Body.String(), `"podObservation"`) != tc.want {
			t.Fatal("unexpected opt-in/context response", w.Code)
		}
		if !tc.want {
			continue
		}
		var out localhistory.TrendResponse
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if len(out.TransitionHours) != 1 || len(out.TransitionHours[0].Examples) != 1 || out.TransitionHours[0].Examples[0].Old.PodObservation.FirstRetainedGap.Domain != "omitted" {
			t.Fatal("missing retained hour evidence")
		}
	}
}
