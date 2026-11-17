package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestHistorySettingsServerOwnedIdentityLifecycle(t *testing.T) {
	s, h := newTestServer(t)
	s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	read := func() localhistory.Policy {
		t.Helper()
		w := historySettingsRequest(h, "GET", "test-context", "")
		var response struct {
			Policy                  localhistory.Policy
			SignalHistoryCapability struct{ EpochRequired bool }
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		if response.SignalHistoryCapability.EpochRequired {
			t.Fatal("client still required to supply generation")
		}
		return response.Policy
	}
	save := func(p localhistory.Policy) localhistory.Policy {
		t.Helper()
		w := historySettingsRequest(h, "POST", "test-context", policyBody(p))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return read()
	}
	p := read()
	if p.SignalHistory || p.SignalEpoch != "" {
		t.Fatal("GET expanded consent", p)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("GET created storage")
	}
	p.Enabled = true
	p = save(p)
	if p.SignalHistory || p.SignalEpoch != "" {
		t.Fatal("aggregate consent created identity", p)
	}
	p.SignalHistory = true
	p = save(p)
	epoch := p.SignalEpoch
	if len(epoch) != 32 {
		t.Fatal("generation not initialized", p)
	}
	// The retained publication's node identity includes the durable generation.
	evidence := func() string {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			now := time.Now().UTC().Truncate(time.Hour)
			r, err := s.historyCollectors["test-context"].QueryTrends(localhistory.TrendQuery{Context: "test-context", From: now, To: now.Add(time.Hour)})
			if err == nil && len(r.Catalog.Nodes) > 0 {
				if r.Catalog.Nodes[0].Key != localhistory.TrendNodeKey("worker", "uid-"+epoch) {
					t.Fatal("wrong retained identity", r.Catalog.Nodes)
				}
				return r.Catalog.Nodes[0].Key
			}
			if time.Now().After(deadline) {
				t.Fatal("no publication evidence", r, err)
			}
			time.Sleep(time.Millisecond)
		}
	}
	first := evidence()
	for _, change := range []string{"retention", "signal-off", "signal-on", "collection-off", "collection-on"} {
		switch change {
		case "retention":
			p.RetentionDays = 90
		case "signal-off":
			p.SignalHistory = false
		case "signal-on":
			p.SignalHistory = true
		case "collection-off":
			p.Enabled = false
		case "collection-on":
			p.Enabled = true
		}
		p.SignalEpoch = "" // old/partial clients may omit the internal field
		p = save(p)
		if p.SignalEpoch != epoch {
			t.Fatal(change, "rotated identity")
		}
	}
	// Current client mutations omit the durable generation.
	p = save(p)
	after := evidence()
	if after != first {
		t.Fatal("save lost history", first, after)
	}
	durable, err := localhistory.LoadSettings(dir)
	if err != nil || durable.Effective("test-context").SignalEpoch != epoch {
		t.Fatal(durable, err)
	}
	s.CloseLocalHistory()
	s2, h2 := newTestServer(t)
	s2.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err := s2.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s2.CloseLocalHistory()
	s, h = s2, h2
	if read().SignalEpoch != epoch {
		t.Fatal("restart rotated identity")
	}
	after = evidence()
	if after != first {
		t.Fatal("restart lost history")
	}
}

func TestHistorySettingsIdentityIsolationAndRejection(t *testing.T) {
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
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	p := localhistory.Policy{SignalHistory: true, RetentionDays: 30}
	// Consent may be saved while collection is off, but cannot choose a generation.
	p.SignalEpoch = "client-chosen"
	if w := historySettingsRequest(h, "POST", "test-context", func() string { raw, _ := json.Marshal(p); return string(raw) }()); w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	p.SignalEpoch = ""
	for _, name := range []string{"", "unknown"} {
		if w := historySettingsRequest(h, "POST", name, policyBody(p)); w.Code < 400 {
			t.Fatal("invalid context accepted")
		}
	}
	if len(s.historySettings.Contexts) != 0 {
		t.Fatal("rejection changed durable state")
	}
	for _, name := range []string{"test-context", "synthetic-b"} {
		if w := historySettingsRequest(h, "POST", name, policyBody(p)); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	a, b := s.historyPolicy("test-context"), s.historyPolicy("synthetic-b")
	if a.SignalEpoch == "" || b.SignalEpoch == "" || a.SignalEpoch == b.SignalEpoch {
		t.Fatal("contexts share generation", a, b)
	}
	for _, value := range []string{b.SignalEpoch, "arbitrary-replacement"} {
		p = a
		p.SignalEpoch = value
		if w := historySettingsRequest(h, "POST", "test-context", func() string { raw, _ := json.Marshal(p); return string(raw) }()); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	p = a
	p.Revision = 0
	p.SignalEpoch = ""
	if w := historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 409 {
		t.Fatal("stale consent accepted")
	}
	durable, err := localhistory.LoadSettings(dir)
	if err != nil || durable.Effective("test-context").SignalEpoch != a.SignalEpoch || durable.Effective("synthetic-b").SignalEpoch != b.SignalEpoch || durable.Effective("test-context").Revision != a.Revision {
		t.Fatal("rejection mutated state", durable, err)
	}
}

func TestHistorySettingsIdentityRejectedConsentDoesNotPersist(t *testing.T) {
	for _, mode := range []string{"unauthenticated", "read-only", "invalid-policy", "storage-failure"} {
		t.Run(mode, func(t *testing.T) {
			s, h := newTestServer(t)
			dir := filepath.Join(t.TempDir(), "history")
			if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
				t.Fatal(err)
			}
			defer s.CloseLocalHistory()
			p := localhistory.Policy{SignalHistory: true, RetentionDays: 30}
			s.readOnly = mode == "read-only"
			if mode == "invalid-policy" {
				p.RetentionDays = 31
			}
			if mode == "storage-failure" {
				if err := os.WriteFile(dir, []byte("not a directory"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "unauthenticated" {
					r.Header.Del("Authorization")
				}
				h.ServeHTTP(w, r)
			})
			w := historySettingsRequest(handler, "POST", "test-context", policyBody(p))
			want := map[string]int{"unauthenticated": 401, "read-only": 403, "invalid-policy": 400, "storage-failure": 503}[mode]
			if w.Code != want || len(s.historySettings.Contexts) != 0 || s.historyPolicy("test-context").SignalEpoch != "" {
				t.Fatal("rejected consent changed state", w.Code, w.Body.String(), s.historySettings.Contexts)
			}
			if mode != "storage-failure" {
				if _, err := os.Stat(dir); !os.IsNotExist(err) {
					t.Fatal("rejected consent created storage")
				}
			}
		})
	}
}

func TestHistorySettingsExistingIdentityAndConsentOff(t *testing.T) {
	for _, epoch := range []string{"", "existing-operator-value"} {
		t.Run(epoch, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "history")
			p := localhistory.Policy{SignalHistory: epoch != "", SignalEpoch: epoch, RetentionDays: 30}
			settings := localhistory.DefaultSettings()
			settings.Contexts["test-context"] = localhistory.ContextIdentity{SignalEpoch: p.SignalEpoch}
			settings.ContextOverrides["test-context"] = localhistory.PolicyOverride{Enabled: &p.Enabled, SignalHistory: &p.SignalHistory, RetentionDays: &p.RetentionDays}
			if err := localhistory.SaveSettings(dir, settings); err != nil {
				t.Fatal(err)
			}
			s, h := newTestServer(t)
			if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
				t.Fatal(err)
			}
			defer s.CloseLocalHistory()
			// Explicitly revoke consent while retaining the server-owned generation.
			body := `{"scope":"context","globalRevision":0,"enabled":false,"retentionDays":90,"signalHistory":false,"revision":0}`
			if w := historySettingsRequest(h, http.MethodPost, "test-context", body); w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			saved := s.historyPolicy("test-context")
			if saved.SignalHistory || saved.SignalEpoch != epoch {
				t.Fatal("consent-off save changed identity or consent", saved)
			}
		})
	}
}
