package server

import (
	"context"
	"encoding/json"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"path/filepath"
	"testing"
	"time"
)

func TestHistorySettingsDefaultConsentAndRetainedPopulation(t *testing.T) {
	s, h := newTestServer(t)
	source := &settingsDataplane{stubDataplane: newStubDataplane()}
	s.dp = source
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	w := historySettingsRequest(h, "GET", "test-context", "")
	var response map[string]json.RawMessage
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &response) != nil {
		t.Fatal(w.Body.String())
	}
	for _, field := range []string{"namespaces", "selection"} {
		if _, ok := response[field]; ok {
			t.Fatal("retired top-level field", field)
		}
	}
	var policyFields map[string]json.RawMessage
	if err := json.Unmarshal(response["policy"], &policyFields); err != nil {
		t.Fatal(err)
	}
	if _, exists := policyFields["cluster"]; exists {
		t.Fatal("obsolete cluster flag exposed")
	}
	var p localhistory.Policy
	json.Unmarshal(response["policy"], &p)
	if p.Enabled || p.SignalHistory || p.SignalEpoch != "" || p.RetentionDays != 30 {
		t.Fatal(p)
	}
	p.Enabled = true
	p.SignalHistory = true
	if w = historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	c := s.historyCollectors["test-context"]
	deadline := time.Now().Add(3 * time.Second)
	for c.Status().LastSuccess.IsZero() {
		if time.Now().After(deadline) {
			t.Fatal("no publication")
		}
		time.Sleep(time.Millisecond)
	}
	from := c.Status().LastSuccess.Truncate(time.Hour)
	c.Close()
	p.RetentionDays = 90 // Reconfiguration reopens the store; a no-op save preserves the worker.
	p.Revision = 1
	if w = historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	out, err := querySettingsTrends(s.historyCollectors["test-context"], "test-context", from)
	if err != nil || len(out.Severity) == 0 || out.Severity[0].Points[0].Counts == nil || out.Severity[0].Points[0].Counts.High != 1 {
		t.Fatal("save lost retained data", out, err)
	}
	if _, err = s.historyCollectors["test-context"].QueryTrends(localhistory.TrendQuery{Context: "test-context-other", From: from, To: from.Add(time.Hour)}); err == nil {
		t.Fatal("context leak")
	}
	p.Enabled = false
	p.Revision = 2
	if w = historySettingsRequest(h, "POST", "test-context", policyBody(p)); w.Code != 200 || s.historyCollectors["test-context"] != nil {
		t.Fatal(w.Body.String())
	}
	s.CloseLocalHistory()
	s2, _ := newTestServer(t)
	s2.dp = source
	if err = s2.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s2.CloseLocalHistory()
	if s2.historyPolicy("test-context").Enabled || len(s2.historyCollectors) != 0 {
		t.Fatal("restart changed consent")
	}
}
