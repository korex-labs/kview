package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/localhistory"
	bolt "go.etcd.io/bbolt"
)

func TestHistorySettingsStartFailureClassification(t *testing.T) {
	for _, kind := range []string{"incompatible", "storage"} {
		t.Run(kind, func(t *testing.T) {
			s, h := newTestServer(t)
			s.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
			dir := filepath.Join(t.TempDir(), "private-credential-marker")
			if err := s.initializeHistorySettings(context.Background(), dir); err != nil {
				t.Fatal(err)
			}
			defer s.CloseLocalHistory()
			sum := sha256.Sum256([]byte("test-context"))
			dbdir := filepath.Join(dir, hex.EncodeToString(sum[:]))
			if err := os.MkdirAll(dbdir, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dbdir, "history-real-v1.db")
			if kind == "incompatible" {
				db, err := bolt.Open(path, 0600, nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Update(func(tx *bolt.Tx) error { _, err := tx.CreateBucket([]byte("prototype")); return err }); err != nil {
					t.Fatal(err)
				}
				if err := db.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.WriteFile(path, []byte("unreadable-private-data"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			expected := historyStorageUnavailable
			if kind == "incompatible" {
				expected = historyDatabaseIncompatible
			}
			verify := func(w *httptest.ResponseRecorder, code int, status bool) {
				t.Helper()
				if w.Code != code {
					t.Fatal(w.Code, w.Body.String())
				}
				var body struct {
					Error     string                       `json:"error"`
					ErrorCode historyStartFailure          `json:"errorCode"`
					Collector localhistory.CollectorStatus `json:"collector"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				message := body.Error
				if status {
					message = body.Collector.LastError
				}
				if body.ErrorCode != expected || message != expected.message() || body.Collector.Enabled {
					t.Fatalf("wrong failure: %+v", body)
				}
				if strings.Contains(w.Body.String(), dir) || strings.Contains(w.Body.String(), "private-credential-marker") || strings.Contains(w.Body.String(), "unreadable-private-data") {
					t.Fatal("private error leaked")
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatal("start failure changed existing file", err)
				}
			}
			p := localhistory.Policy{Enabled: true, SignalHistory: true, RetentionDays: 30}
			verify(historySettingsRequest(h, "POST", "test-context", policyBody(p)), 503, false)
			verify(historySettingsRequest(h, "GET", "test-context", ""), 200, false)
			p = s.historyPolicy("test-context")
			if p.SignalEpoch == "" || p.Revision != 1 {
				t.Fatal("desired state not preserved", p)
			}
			verify(historySettingsRequest(h, "POST", "test-context", policyBody(p)), 503, false)
			verify(doReqWithHeader(t, h, "GET", "/api/history/status", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil), 200, true)
			s.CloseLocalHistory()
			s2, h2 := newTestServer(t)
			s2.dp = &settingsDataplane{stubDataplane: newStubDataplane()}
			if err := s2.initializeHistorySettings(context.Background(), dir); err != nil {
				t.Fatal(err)
			}
			defer s2.CloseLocalHistory()
			verify(historySettingsRequest(h2, "GET", "test-context", ""), 200, false)
			verify(doReqWithHeader(t, h2, "GET", "/api/history/status", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil), 200, true)
			if s2.historyPolicy("test-context").SignalEpoch != p.SignalEpoch {
				t.Fatal("restart rotated identity")
			}
		})
	}
}

func TestHistorySettingsFailureSanitization(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want historyStartFailure
	}{
		{fmt.Errorf("private/path bearer-secret: %w", localhistory.ErrIncompatibleDatabase), historyDatabaseIncompatible},
		{errors.New("private/path bearer-secret incompatible history database"), historyStorageUnavailable},
	} {
		got := classifyHistoryStartFailure(tc.err)
		if got != tc.want || strings.Contains(got.message(), "private/path") || strings.Contains(got.message(), "bearer-secret") {
			t.Fatal("unsafe classification", got)
		}
	}
}
