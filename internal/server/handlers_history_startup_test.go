package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func TestHistoryStartupPolicyFailureIsIsolated(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		mode      os.FileMode
	}{
		{"obsolete", `{"private-context-marker":{"enabled":true,"signalHistory":true,"retentionDays":30}}`, 0600},
		{"malformed", `{"private-context-marker":`, 0600},
		{"unsafe-permissions", `{"global":{"enabled":true,"signalHistory":true,"retentionDays":30},"revision":0,"contextOverrides":{},"contexts":{}}`, 0644},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := t.TempDir()
			t.Setenv("XDG_CONFIG_HOME", base)
			dir := filepath.Join(base, "kview", "local-history")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, "settings.json")
			if err := os.WriteFile(path, []byte(tc.raw), tc.mode); err != nil {
				t.Fatal(err)
			}
			s, h := newTestServer(t)
			// No dataplane is needed to reject policy; any attempted collection would fail.
			s.dp = nil
			defer s.CloseLocalHistory()
			err := s.InitializeLocalHistory(context.Background())
			var failure historyStartFailure
			if !errors.As(err, &failure) || string(failure) != "history_settings_unavailable" {
				t.Fatalf("expected safe typed initialization failure, got %v", err)
			}
			if strings.Contains(err.Error(), "private-context-marker") || strings.Contains(err.Error(), base) {
				t.Fatal("startup error leaked private data")
			}
			if s.historySettings != nil || len(s.historyCollectors) != 0 || s.historyPolicy("test-context").Enabled || s.historyPolicy("test-context").SignalEpoch != "" {
				t.Fatal("failed policy granted collection or identity")
			}
			for _, method := range []string{"GET", "POST"} {
				body := ""
				want := 200
				if method == "POST" {
					body = policyBody(localhistory.Policy{Enabled: true, SignalHistory: true, RetentionDays: 30})
					want = 503
				}
				w := historySettingsRequest(h, method, "test-context", body)
				if w.Code != want {
					t.Fatal(w.Code, w.Body.String())
				}
				var dto historySettingsDTO
				if err := json.Unmarshal(w.Body.Bytes(), &dto); err != nil {
					t.Fatal(err)
				}
				if dto.Editable || dto.Policy.Enabled || dto.Global.Enabled || dto.Collector.Enabled || string(dto.ErrorCode) != "history_settings_unavailable" || !strings.Contains(dto.Error, "settings.json") {
					t.Fatalf("unsafe settings response: %+v", dto)
				}
				if strings.Contains(w.Body.String(), "private-context-marker") || strings.Contains(w.Body.String(), base) {
					t.Fatal("settings response leaked private data")
				}
			}
			status := doReqWithHeader(t, h, "GET", "/api/history/status", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
			var got struct {
				ErrorCode  string                       `json:"errorCode"`
				Collector  localhistory.CollectorStatus `json:"collector"`
				Configured bool                         `json:"configured"`
			}
			if err := json.Unmarshal(status.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if status.Code != 200 || got.Configured || got.Collector.Enabled || got.ErrorCode != "history_settings_unavailable" || got.Collector.LastError != failure.Error() {
				t.Fatalf("wrong status: %s", status.Body.String())
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(after, []byte(tc.raw)) {
				t.Fatal("failed startup/save changed policy", err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 1 {
				t.Fatal("unexpected history disk writes", err)
			}
		})
	}
}

func TestHistoryStartupDefaultPolicy(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	s, _ := newTestServer(t)
	s.dp = nil
	defer s.CloseLocalHistory()
	if err := s.InitializeLocalHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	dto := s.historySettingsResponse("test-context")
	if !dto.Editable || dto.ErrorCode != "" || dto.Policy.Enabled || dto.Policy.SignalEpoch != "" || dto.Policy.RetentionDays != 30 {
		t.Fatalf("unexpected default: %+v", dto)
	}
}

func TestHistoryStartupValidGlobalPolicy(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	dir, err := localhistory.SettingsDirectory()
	if err != nil {
		t.Fatal(err)
	}
	settings := localhistory.DefaultSettings()
	settings.Global.Enabled = true
	settings.Global.SignalHistory = true
	settings.Contexts["test-context"] = localhistory.ContextIdentity{SignalEpoch: "synthetic-saved-epoch", Revision: 2}
	if err := localhistory.SaveSettings(dir, settings); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newTestServer(t)
	s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
	defer s.CloseLocalHistory()
	if err := s.InitializeLocalHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	dto := s.historySettingsResponse("test-context")
	if !dto.Editable || dto.ErrorCode != "" || !dto.Policy.Enabled || !dto.Collector.Enabled || dto.Policy.SignalEpoch != "synthetic-saved-epoch" || dto.Policy.Revision != 2 {
		t.Fatalf("valid consent not restored: %+v", dto)
	}
	after, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("valid startup changed saved consent", err)
	}
}

func TestHistoryStartupUnavailableDirectory(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "relative-private-marker")
	s, _ := newTestServer(t)
	defer s.CloseLocalHistory()
	if err := s.InitializeLocalHistory(context.Background()); err != historySettingsUnavailable {
		t.Fatalf("unsafe directory error: %v", err)
	}
	dto := s.historySettingsResponse("test-context")
	if dto.Editable || dto.Policy.Enabled || dto.ErrorCode != historySettingsUnavailable || strings.Contains(dto.Error, "relative-private-marker") {
		t.Fatalf("wrong directory failure: %+v", dto)
	}
}
