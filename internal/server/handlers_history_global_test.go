package server

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestHistoryGlobalDefaultsSparseOverridesAndReset(t *testing.T) {
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
	dpBefore := s.dp.PolicyBundle()
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	save := func(name, scope string, changes map[string]any, code int) {
		t.Helper()
		changes["scope"] = scope
		changes["globalRevision"] = s.historySettings.Revision
		changes["revision"] = s.historyPolicy(name).Revision
		if scope == "global" {
			changes["revision"] = s.historySettings.Revision
		}
		raw, _ := json.Marshal(changes)
		w := historySettingsRequest(h, "POST", name, string(raw))
		if w.Code != code {
			t.Fatalf("%d: %s", w.Code, w.Body.String())
		}
	}
	// Unrelated retention edits cannot imply consent.
	save("test-context", "global", map[string]any{"retentionDays": 90}, 200)
	if s.historyPolicy("synthetic-b").SignalHistory || len(s.historyCollectors) != 0 {
		t.Fatal("implicit consent")
	}
	save("synthetic-b", "context", map[string]any{"retentionDays": 30}, 200)
	save("test-context", "global", map[string]any{"enabled": true, "signalHistory": true}, 200)
	a, b := s.historyPolicy("test-context"), s.historyPolicy("synthetic-b")
	if !a.Enabled || !b.Enabled || a.RetentionDays != 90 || b.RetentionDays != 30 || a.SignalEpoch == "" || b.SignalEpoch == "" || a.SignalEpoch == b.SignalEpoch {
		t.Fatal(a, b)
	}
	if !s.historyCollectors["test-context"].Status().Enabled || !s.historyCollectors["synthetic-b"].Status().Enabled {
		t.Fatal("inheritors not reconciled")
	}
	bCollector := s.historyCollectors["synthetic-b"]
	save("test-context", "global", map[string]any{"retentionDays": 30}, 200)
	if s.historyCollectors["synthetic-b"] != bCollector {
		t.Fatal("isolated override restarted")
	}
	// Existing overrides stay custom even when a later global value happens to match.
	if s.historySettings.ContextOverrides["synthetic-b"].RetentionDays == nil {
		t.Fatal("global update clobbered override")
	}
	save("synthetic-b", "context", map[string]any{"signalHistory": false}, 200)
	save("test-context", "global", map[string]any{"retentionDays": 90}, 200)
	if s.historyPolicy("synthetic-b").SignalHistory || s.historyPolicy("synthetic-b").RetentionDays != 30 {
		t.Fatal("override lost")
	}
	stale := `{"scope":"context","globalRevision":0,"revision":0,"signalHistory":true}`
	if w := historySettingsRequest(h, "POST", "synthetic-b", stale); w.Code != 409 {
		t.Fatal("stale defaults accepted", w.Code)
	}
	save("synthetic-b", "context", map[string]any{"reset": true}, 200)
	if len(s.historySettings.ContextOverrides) != 0 || s.historyPolicy("synthetic-b").RetentionDays != 90 || !s.historyPolicy("synthetic-b").SignalHistory {
		t.Fatal("reset did not inherit")
	}
	if s.historyPolicy("test-context").SignalEpoch != a.SignalEpoch || s.historyPolicy("synthetic-b").SignalEpoch != b.SignalEpoch {
		t.Fatal("epoch rotated")
	}
	if !reflect.DeepEqual(dpBefore, s.dp.PolicyBundle()) {
		t.Fatal("history mutated dataplane preferences")
	}
	before := s.historySettings.Clone()
	// Failed persistence cannot apply any global changes or restart any worker.
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "settings.json"), 0700); err != nil {
		t.Fatal(err)
	}
	aCollector := s.historyCollectors["test-context"]
	save("test-context", "global", map[string]any{"enabled": false}, 503)
	if !reflect.DeepEqual(before, s.historySettings) || s.historyCollectors["test-context"] != aCollector {
		t.Fatal("failed save applied")
	}
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	if err := localhistory.SaveSettings(dir, before); err != nil {
		t.Fatal(err)
	}
	s.CloseLocalHistory()
	s2, _ := newTestServer(t)
	s2.mgr = mgr
	s2.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	if err := s2.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s2.CloseLocalHistory()
	if s2.historyPolicy("synthetic-b").SignalEpoch != b.SignalEpoch || !s2.historyCollectors["synthetic-b"].Status().Enabled {
		t.Fatal("restart lost inherited consent")
	}
}

// Only the other inheritor fails; the selected context still starts normally.
type historyOtherSourceFailure struct{ *settingsDataplane }

func (d *historyOtherSourceFailure) SubscribeHistoryPublications(name, epoch string) (*localhistory.PublicationQueue, func(), error) {
	if name == "synthetic-b" {
		return nil, nil, errors.New("private/path bearer-secret source failed")
	}
	return d.settingsDataplane.SubscribeHistoryPublications(name, epoch)
}
func TestHistoryGlobalOtherInheritorFailure(t *testing.T) {
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
	s.dp = &historyOtherSourceFailure{&settingsDataplane{stubDataplane: newStubDataplane()}}
	dir := filepath.Join(t.TempDir(), "history")
	if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	w := historySettingsRequest(h, "POST", "test-context", `{"scope":"global","revision":0,"globalRevision":0,"enabled":true,"signalHistory":true}`)
	if w.Code != 503 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, response := range []string{w.Body.String(), historySettingsRequest(h, "GET", "test-context", "").Body.String()} {
		var dto historySettingsDTO
		if err := json.Unmarshal([]byte(response), &dto); err != nil {
			t.Fatal(err)
		}
		if dto.Error != "" || !dto.Collector.Enabled || len(dto.CollectionFailures) != 1 || dto.CollectionFailures[0].Context != "synthetic-b" || dto.CollectionFailures[0].ErrorCode != historySourceUnavailable || dto.CollectionFailures[0].Error != historySourceUnavailable.message() {
			t.Fatal(response)
		}
		if strings.Contains(response, "bearer-secret") || strings.Contains(response, "private/path") {
			t.Fatal("raw error leaked")
		}
	}
	saved, err := localhistory.LoadSettings(dir)
	if err != nil || !saved.Global.Enabled || !saved.Global.SignalHistory || saved.Revision != 1 || len(saved.ContextOverrides) != 0 {
		t.Fatal("defaults not durable", saved, err)
	}
}
func TestHistoryGlobalInitialInheritanceRestartAndNewContext(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "history")
	settings := localhistory.DefaultSettings()
	settings.Global = localhistory.Defaults{Enabled: true, SignalHistory: true, RetentionDays: 90}
	if err := localhistory.SaveSettings(dir, settings); err != nil {
		t.Fatal(err)
	}
	var firstEpoch string
	for i := 0; i < 3; i++ {
		s, _ := newTestServer(t)
		s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
		if i == 2 {
			config := strings.Replace(minimalKubeconfig, "current-context: test-context", "- context:\n    cluster: test-cluster\n    user: test-user\n  name: synthetic-new\ncurrent-context: test-context", 1)
			path := filepath.Join(t.TempDir(), "kubeconfig")
			if err := os.WriteFile(path, []byte(config), 0600); err != nil {
				t.Fatal(err)
			}
			mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
			if err != nil {
				t.Fatal(err)
			}
			s.mgr = mgr
		}
		if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
			t.Fatal(err)
		}
		p := s.historyPolicy("test-context")
		if p.SignalEpoch == "" || !s.historyForContext("test-context").Status().Enabled || p.RetentionDays != 90 || len(s.historySettings.ContextOverrides) != 0 {
			t.Fatal("initial inheritance failed", p)
		}
		if i == 0 {
			firstEpoch = p.SignalEpoch
		} else if p.SignalEpoch != firstEpoch {
			t.Fatal("restart rotated epoch")
		}
		if i == 2 {
			added := s.historyPolicy("synthetic-new")
			if added.SignalEpoch == "" || added.SignalEpoch == firstEpoch || !s.historyForContext("synthetic-new").Status().Enabled {
				t.Fatal("new context did not inherit independently", added)
			}
		}
		durable, err := localhistory.LoadSettings(dir)
		if err != nil || durable.Effective("test-context").SignalEpoch != p.SignalEpoch {
			t.Fatal("identity not durable", err)
		}
		s.CloseLocalHistory()
	}
}
