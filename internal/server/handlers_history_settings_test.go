package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"reflect"
)

type settingsDataplane struct {
	*stubDataplane
	entered chan struct{}
	exited  chan struct{}
	once    sync.Once
}

func (d *settingsDataplane) HistoryNamespaces(name string) []string {
	return []string{"synthetic-apps"}
}
func (d *settingsDataplane) SubscribeHistoryPublications(name, epoch string) (*localhistory.PublicationQueue, func(), error) {
	q, err := localhistory.NewPublicationQueue(name, epoch, 8)
	return q, func() { q.Close() }, err
}
func (d *settingsDataplane) HistoryPublicationBatch(ctx context.Context, event localhistory.Publication, at time.Time) localhistory.TrendBatch {
	if d.entered != nil {
		d.once.Do(func() { close(d.entered) })
		<-ctx.Done()
		close(d.exited)
	}
	b := localhistory.TrendBatch{Context: event.Context, Epoch: event.Epoch, At: at, Policy: "test-policy", Diagnostics: localhistory.TrendDiagnostics{Reasons: map[string]int{}}}
	for _, namespace := range []string{"synthetic-apps"} {
		b.Domains = append(b.Domains, localhistory.TrendDomain{Namespace: namespace, Rule: "pod_crash_loop_waiting", Complete: true, SourceAt: at, Generation: "one", Signals: []localhistory.TrendSignal{{ID: "identity-" + event.Epoch + "-" + namespace, IdentityKnown: true, Severity: "high", Node: localhistory.TrendNodeKey("worker", "uid-"+event.Epoch)}}})
	}
	return b
}
func querySettingsTrends(c *localhistory.Collector, name string, from time.Time) (localhistory.TrendResponse, error) {
	return c.QueryTrends(localhistory.TrendQuery{Context: name, From: from, To: from.Add(time.Hour)})
}
func historySettingsRequest(h http.Handler, method, name, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/history/settings", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+testToken)
	r.Header.Set("X-Kview-Context", name)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func policyBody(p localhistory.Policy) string {
	raw, _ := json.Marshal(map[string]any{"scope": "context", "globalRevision": 0, "enabled": p.Enabled, "signalHistory": p.SignalHistory, "retentionDays": p.RetentionDays, "revision": p.Revision})
	return string(raw)
}
func TestHistorySettingsTwoContextIsolation(t *testing.T) {
	s, h := newTestServer(t)
	config := strings.Replace(minimalKubeconfig, "current-context: test-context", "- context:\n    cluster: test-cluster\n    user: test-user\n  name: synthetic-b\ncurrent-context: test-context", 1)
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
	if err != nil {
		t.Fatal(err)
	}
	s.mgr = mgr
	s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	dir := filepath.Join(t.TempDir(), "history")
	if err = s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	p := localhistory.Policy{Enabled: true, SignalHistory: true, RetentionDays: 90}
	for _, name := range []string{"test-context", "synthetic-b"} {
		w := historySettingsRequest(h, "POST", name, policyBody(p))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var response map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if _, exists := response["retainedScopes"]; exists {
			t.Fatal("obsolete gauge registry exposed")
		}
		var capability map[string]json.RawMessage
		if err := json.Unmarshal(response["signalHistoryCapability"], &capability); err != nil {
			t.Fatal(err)
		}
		if _, exists := capability["supportedRules"]; exists {
			t.Fatal("prototype rule list exposed")
		}
		if string(capability["requiresIdentityConsent"]) != "true" {
			t.Fatal("consent capability lost")
		}
	}
	b := s.historyCollectors["synthetic-b"]
	deadline := time.Now().Add(5 * time.Second)
	for b.Status().LastSuccess.IsZero() {
		if time.Now().After(deadline) {
			t.Fatal("no second-context sample")
		}
		time.Sleep(time.Millisecond)
	}
	from := b.Status().LastSuccess.Truncate(time.Hour)
	before, err := querySettingsTrends(b, "synthetic-b", from)
	if err != nil || len(before.Severity) == 0 || before.Severity[0].Points[0].Counts == nil {
		t.Fatal(before, err)
	}
	bPolicy := s.historyPolicy("synthetic-b")
	// Reconfigure then disable A while B retains the exact worker, policy and DB rows.
	p.Revision = 1
	p.RetentionDays = 30
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	p.Revision = 2
	p.Enabled = false
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if s.historyCollectors["test-context"] != nil || s.historyCollectors["synthetic-b"] != b || !b.Status().Enabled {
		t.Fatal("another context worker changed")
	}
	after, err := querySettingsTrends(b, "synthetic-b", from)
	// Query-time coverage can advance without changing persisted evidence.
	stored := func(r localhistory.TrendResponse) any {
		if len(r.Severity) == 0 {
			return nil
		}
		return r.Severity[0].Points[0].Counts
	}
	if err != nil || !reflect.DeepEqual(stored(before), stored(after)) {
		t.Fatal("other DB changed", err)
	}
	saved, err := localhistory.LoadSettings(dir)
	if err != nil || !reflect.DeepEqual(saved.Effective("synthetic-b"), bPolicy) || saved.Effective("test-context").Enabled {
		t.Fatal(saved, err)
	}
	w := doReqWithHeader(t, h, "GET", "/api/history/signal-trends?from="+from.Format(time.RFC3339)+"&to="+from.Add(time.Hour).Format(time.RFC3339), map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
	if w.Code != 409 {
		t.Fatal("disabled history unexpectedly readable", w.Code)
	}
	// Restart preserves disabled consent, resumes B only, and keeps B readable.
	s.CloseLocalHistory()
	s2, _ := newTestServer(t)
	s2.mgr = mgr
	s2.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err = s2.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s2.CloseLocalHistory()
	if s2.historyCollectors["test-context"] != nil || !s2.historyCollectors["synthetic-b"].Status().Enabled {
		t.Fatal("restart lost independent consent")
	}
	after, err = querySettingsTrends(s2.historyCollectors["synthetic-b"], "synthetic-b", from)
	if err != nil || !reflect.DeepEqual(stored(before), stored(after)) {
		t.Fatal("restart lost B rows", err)
	}
}

func TestHistorySettingsLifecycleAndPersistence(t *testing.T) {
	s, h := newTestServer(t)
	s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("default created history storage")
	}
	p := localhistory.Policy{Enabled: true, SignalHistory: true, RetentionDays: 90}
	w := historySettingsRequest(h, "POST", "test-context", policyBody(p))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), dir) {
		t.Fatal("path leaked")
	}
	c := s.historyCollectors["test-context"]
	deadline := time.Now().Add(5 * time.Second)
	for c.Status().LastSuccess.IsZero() {
		if time.Now().After(deadline) {
			t.Fatal("no sample")
		}
		time.Sleep(time.Millisecond)
	}
	from := c.Status().LastSuccess.Truncate(time.Hour)
	before, err := querySettingsTrends(c, "test-context", from)
	if err != nil {
		t.Fatal(err)
	}
	p.Revision = 1
	p.Enabled = false
	w = historySettingsRequest(h, "POST", "test-context", policyBody(p))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if s.historyCollectors["test-context"] != nil {
		t.Fatal("disable retained worker")
	}
	saved, err := localhistory.LoadSettings(dir)
	if err != nil || saved.Effective("test-context").Enabled {
		t.Fatal(saved, err)
	}
	s.CloseLocalHistory()
	s2, h2 := newTestServer(t)
	s2.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err = s2.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s2.CloseLocalHistory()
	p = saved.Effective("test-context")
	p.Enabled = true
	p.RetentionDays = 30
	w = historySettingsRequest(h2, "POST", "test-context", policyBody(p))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	after, err := querySettingsTrends(s2.historyCollectors["test-context"], "test-context", from)
	if err != nil || s2.historyPolicy("test-context").RetentionDays != 30 || len(after.Severity) == 0 || !reflect.DeepEqual(after.Severity[0].Points[0].Counts, before.Severity[0].Points[0].Counts) {
		t.Fatal("retention/re-enable lost stored samples", after, err)
	}
	// A running persisted opt-in resumes, without requiring browser/profile state.
	s2.CloseLocalHistory()
	s3, _ := newTestServer(t)
	s3.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err = s3.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s3.CloseLocalHistory()
	if !s3.historyCollectors["test-context"].Status().Enabled {
		t.Fatal("saved consent did not resume")
	}
}
func TestHistorySettingsValidationAuthorizationAndCAS(t *testing.T) {
	s, h := newTestServer(t)
	s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err := s.initializeHistorySettings(context.Background(), filepath.Join(t.TempDir(), "history")); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	body := `{"scope":"context","globalRevision":0,"enabled":true,"retentionDays":30,"signalHistory":true,"revision":0}`
	for _, tc := range []struct {
		name, body string
		code       int
	}{
		{"unknown", body, 404}, {"", body, 400}, {"test-context", `null`, 400}, {"test-context", body + ` {}`, 400},
		{"test-context", strings.Replace(body, `"retentionDays":30`, `"retentionDays":31`, 1), 400},
		{"test-context", strings.Replace(body, `"revision":0`, `"revision":0,"namespaces":[]`, 1), 400},
		{"test-context", strings.Replace(body, `"revision":0`, `"revision":0,"namespaceMode":"manual"`, 1), 400},
		{"test-context", strings.Replace(body, `"revision":0`, `"revision":0,"context":"other"`, 1), 400},
		{"test-context", strings.Replace(body, `"revision":0`, `"revision":0,"directory":"/arbitrary"`, 1), 400},
	} {
		if w := historySettingsRequest(h, "POST", tc.name, tc.body); w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body.String())
		}
	}
	for _, mode := range []string{"unauthenticated", "query-token", "read-only", "cross-site", "form"} {
		s.readOnly = mode == "read-only"
		r := httptest.NewRequest("POST", "/api/history/settings", strings.NewReader(body))
		r.Header.Set("X-Kview-Context", "test-context")
		r.Header.Set("Content-Type", "application/json")
		if mode != "unauthenticated" && mode != "query-token" {
			r.Header.Set("Authorization", "Bearer "+testToken)
		}
		if mode == "query-token" {
			r.URL.RawQuery = "token=" + testToken
		}
		if mode == "cross-site" {
			r.Header.Set("Sec-Fetch-Site", "cross-site")
		}
		if mode == "form" {
			r.Header.Set("Content-Type", "text/plain")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code < 400 {
			t.Fatal(mode, w.Code)
		}
	}
	s.readOnly = false
	if w := historySettingsRequest(h, "POST", "test-context", body); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := historySettingsRequest(h, "POST", "test-context", body); w.Code != 409 {
		t.Fatal("stale edit overwrote consent", w.Code)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 10 {
				w := historySettingsRequest(h, "GET", "test-context", "")
				if w.Code != 200 {
					t.Error(w.Code)
				}
			}
		}()
	}
	if w := historySettingsRequest(h, "POST", "test-context", `{"scope":"context","globalRevision":0,"enabled":false,"retentionDays":30,"signalHistory":true,"revision":1}`); w.Code != 200 {
		t.Fatal(w.Code)
	}
	wg.Wait()
}
func TestHistorySettingsDisableJoinsAndFailuresAreTruthful(t *testing.T) {
	s, h := newTestServer(t)
	d := &settingsDataplane{stubDataplane: newStubDataplane(), entered: make(chan struct{}), exited: make(chan struct{})}
	s.dp = d
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	p := localhistory.Policy{Enabled: true, SignalHistory: true, RetentionDays: 30}
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Code)
	}
	select {
	case <-d.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("worker not entered")
	}
	p.Enabled = false
	p.Revision = 1
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Code)
	}
	select {
	case <-d.exited:
	default:
		t.Fatal("disable did not join")
	}
	// Failed durable save leaves consent and runtime unchanged.
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "settings.json"), 0700); err != nil {
		t.Fatal(err)
	}
	p.Enabled = true
	p.Revision = 2
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 503 {
		t.Fatal(w.Code)
	}
	if s.historyPolicy("test-context").Enabled {
		t.Fatal("failed save changed consent")
	}
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	s.dp = newStubDataplane() // no cache-only history Source: persisted desired state, failed worker
	w := historySettingsRequest(h, "POST", "test-context", policyBody(p))
	if w.Code != 503 || !bytes.Contains(w.Body.Bytes(), []byte(`"enabled":false`)) {
		t.Fatal(w.Code, w.Body.String())
	}
	if !s.historyPolicy("test-context").Enabled || s.historyFailures["test-context"] == "" {
		t.Fatal("start failure hidden")
	}
}
