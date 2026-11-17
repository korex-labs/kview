package server

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

func TestHistorySettingsCurrentMutationOnly(t *testing.T) {
	s, h := newTestServer(t)
	if err := s.initializeHistorySettings(context.Background(), filepath.Join(t.TempDir(), "history")); err != nil {
		t.Fatal(err)
	}
	defer s.CloseLocalHistory()
	base := map[string]any{"scope": "context", "revision": 0, "globalRevision": 0}
	before := s.historySettings.Clone()
	for _, field := range []string{"scope", "revision", "globalRevision"} {
		for _, null := range []bool{false, true} {
			obj := map[string]any{}
			for k, v := range base {
				obj[k] = v
			}
			if null {
				obj[field] = nil
			} else {
				delete(obj, field)
			}
			raw, _ := json.Marshal(obj)
			if w := historySettingsRequest(h, "POST", "test-context", string(raw)); w.Code != 400 {
				t.Fatal(field, w.Code, w.Body.String())
			}
		}
	}
	for _, field := range []string{"cluster", "nodes", "signalEpoch", "namespaceMode", "namespaces", "context", "policy"} {
		obj := map[string]any{}
		for k, v := range base {
			obj[k] = v
		}
		obj[field] = nil
		raw, _ := json.Marshal(obj)
		if w := historySettingsRequest(h, "POST", "test-context", string(raw)); w.Code != 400 {
			t.Fatal(field, w.Code, w.Body.String())
		}
	}
	if !reflect.DeepEqual(before, s.historySettings) {
		t.Fatal("rejected mutation persisted")
	}
	// The three policy values are optional: each sparse update preserves the rest.
	for i, changes := range []map[string]any{{"enabled": true}, {"retentionDays": 90}, {"signalHistory": false}, {"reset": true}} {
		changes["scope"] = "context"
		changes["revision"] = i
		changes["globalRevision"] = 0
		raw, _ := json.Marshal(changes)
		if w := historySettingsRequest(h, "POST", "test-context", string(raw)); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		p := s.historyPolicy("test-context")
		if p.SignalHistory || p.SignalEpoch != "" || len(s.historyCollectors) != 0 {
			t.Fatal("consent expanded", p)
		}
		if i < 3 && !p.Enabled {
			t.Fatal("sparse edit lost enabled")
		}
		if (i == 1 || i == 2) && p.RetentionDays != 90 {
			t.Fatal("sparse edit lost retention")
		}
	}
	if len(s.historySettings.ContextOverrides) != 0 {
		t.Fatal("reset retained overrides")
	}
}
