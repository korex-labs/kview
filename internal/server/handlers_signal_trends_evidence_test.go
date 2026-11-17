package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type evidenceHTTPSource struct {
	changedTrendHTTPSource
	calls atomic.Int32
}

func (s *evidenceHTTPSource) HistoryPublicationBatch(_ context.Context, event localhistory.Publication, at time.Time) localhistory.TrendBatch {
	s.calls.Add(1)
	b := localhistory.TrendBatch{Context: event.Context, Epoch: event.Epoch, Policy: "policy", At: at, FullProjection: true}
	d := localhistory.TrendDomain{Namespace: "apps", Rule: "pod_crash_loop_waiting", SourceAt: at, Complete: true, CachedPopulation: true}
	for i := 0; i < 12; i++ {
		severity := "high"
		if i == 11 && s.changed.Load() {
			severity = "medium"
		}
		d.Signals = append(d.Signals, localhistory.TrendSignal{ID: fmt.Sprint(i), IdentityKey: fmt.Sprint(i), ResourceUID: fmt.Sprint(i), IdentityKnown: i != 11, Severity: severity, Node: localhistory.TrendNodeKey(fmt.Sprintf("worker-%02d", i), fmt.Sprint(i))})
	}
	b.Domains = []localhistory.TrendDomain{d}
	return b
}
func TestTrendsHTTPDurableEvidence(t *testing.T) {
	source := &evidenceHTTPSource{}
	c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, SignalEpoch: "http-epoch", QueryContext: "synthetic-a", Directory: filepath.Join(t.TempDir(), "history"), RetentionDays: 30}, source)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	wait := func(wantCalls int32) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if source.calls.Load() >= wantCalls && !c.Status().LastSuccess.IsZero() {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("collector did not publish")
	}
	wait(1)
	s := &Server{token: "fixture-token", readOnly: true, historyCollectors: map[string]*localhistory.Collector{"synthetic-a": c}, dp: &stubDataplane{}}
	handler := s.Router()
	from := c.Status().LastSuccess.UTC().Truncate(time.Hour)
	base := "/api/history/signal-trends?from=" + from.Format(time.RFC3339) + "&to=" + from.Add(time.Hour).Format(time.RFC3339)
	request := func(path, token, name string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
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
	read := func(path string) localhistory.TrendResponse {
		t.Helper()
		w := request(path, "fixture-token", "synthetic-a")
		var out localhistory.TrendResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return out
	}
	source.changed.Store(true)
	if !source.q.Enqueue(localhistory.Publication{Context: "synthetic-a", Kind: "pods", Namespace: "apps", Revision: 1, ObservedAt: time.Now().UTC()}) {
		t.Fatal("enqueue")
	}
	details := base + "&diagnostics=transitions&nodesMode=topSignals10"
	deadline := time.Now().Add(5 * time.Second)
	for {
		out := read(details)
		if len(out.TransitionHours) == 1 && out.TransitionHours[0].Reasons["missing-uid"] == 1 && !c.Status().LastSuccess.Before(out.Severity[0].Points[0].SampleAt) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("rejection not published", out)
		}
		time.Sleep(time.Millisecond)
	}
	before, calls := c.Status(), source.calls.Load()
	out := read(details)
	h := out.TransitionHours[0]
	if h.Epoch != "http-epoch" || h.At != from || len(h.Groups) != 12 || h.Reasons["missing-uid"] != 1 {
		t.Fatal(h)
	}
	affected := localhistory.TrendNodeKey("worker-11", "11")
	for _, n := range out.Nodes {
		if n.Key == affected {
			t.Fatal("fixture must be outside top ten")
		}
	}
	selected := read(base + "&diagnostics=transitions&nodesMode=custom&node=" + url.QueryEscape(affected) + "&rulesMode=custom&rule=pod_crash_loop_waiting&namespacesMode=custom&namespace=apps")
	g := selected.TransitionHours[0].Groups
	if len(g) != 1 || g[0].Node != affected || g[0].Reasons["missing-uid"] != 1 || g[0].DomainBefore.High != 12 || g[0].DomainAfter.High != 11 || g[0].DomainAfter.Medium != 1 {
		t.Fatal("lost UID or mislabeled domain counts", g)
	}
	wrong := read(base + "&diagnostics=transitions&nodesMode=custom&node=" + url.QueryEscape(localhistory.TrendNodeKey("worker-11", "replaced")))
	if len(wrong.TransitionHours[0].Groups) != 0 || wrong.TransitionHours[0].Reasons["missing-uid"] != 1 {
		t.Fatal("UID isolation or whole-hour counters", wrong)
	}
	oldPath := "/api/history/signal-trends?from=" + from.Add(-time.Hour).Format(time.RFC3339) + "&to=" + from.Format(time.RFC3339) + "&diagnostics=transitions"
	if len(read(oldPath).TransitionHours) != 0 {
		t.Fatal("evidence outside requested range")
	}
	for _, path := range []string{base, base + "&nodesMode=custom&node=" + url.QueryEscape(affected)} {
		w := request(path, "fixture-token", "synthetic-a")
		if strings.Contains(w.Body.String(), "transitionHours") || strings.Contains(w.Body.String(), "transitionDiagnostics") {
			t.Fatal("default leaked diagnostics", w.Body.String())
		}
	}
	for _, tc := range []struct {
		token, name string
		status      int
	}{{"", "synthetic-a", 401}, {"fixture-token", "", 400}, {"fixture-token", "synthetic-ab", 409}} {
		w := request(details, tc.token, tc.name)
		if w.Code != tc.status || strings.Contains(w.Body.String(), "transitionHours") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if !reflect.DeepEqual(before, c.Status()) || source.calls.Load() != calls {
		t.Fatal("GET sampled source")
	}
	delete(s.historyCollectors, "synthetic-a")
	if w := request(details, "fixture-token", "synthetic-a"); w.Code != 409 {
		t.Fatal("collection consent bypass", w.Code)
	}
}
