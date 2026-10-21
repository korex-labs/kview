package outreach

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body))}
}
func testClient(t *testing.T, f transportFunc) *Client {
	t.Helper()
	c := New()
	c.path = filepath.Join(t.TempDir(), "state.json")
	c.http.Transport = f
	c.now = func() time.Time { return time.Date(2026, 10, 16, 23, 59, 0, 0, time.UTC) }
	return c
}
func TestNormalizeVersion(t *testing.T) {
	for in, want := range map[string]string{"v5.2.1": "5.2.1", "5.2.1-rc.1": "5.2.1-rc.1", "dev": "development", "c24e154": "development", "v5.2.1-3-gabcdef-dirty": "development", "": "development"} {
		if got := NormalizeVersion(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}
func TestSendStableIdentityConcurrentDedupRestartVersionDay(t *testing.T) {
	var calls int
	var id string
	c := testClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != statisticsURL || r.Method != "POST" {
			t.Error("wrong destination")
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode statistics payload: %v", err)
			return nil, err
		}
		if len(payload) != 2 || !uuidPattern.MatchString(payload["installation_id"]) {
			t.Fatal(payload)
		}
		if id != "" && id != payload["installation_id"] {
			t.Fatal("identity changed")
		}
		id = payload["installation_id"]
		return response(204, ""), nil
	})
	if _, err := os.Stat(c.path); !os.IsNotExist(err) {
		t.Fatal("identity created without consent")
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Go(func() {
			if err := c.Send(context.Background(), "v5.2.1"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if calls != 1 {
		t.Fatal(calls)
	}
	restarted := New()
	restarted.path = c.path
	restarted.now = c.now
	restarted.http = c.http
	if err := restarted.Send(context.Background(), "v5.2.1"); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("restart did not dedup")
	}
	if err := c.Send(context.Background(), "v5.2.2"); err != nil {
		t.Fatal(err)
	}
	c.now = func() time.Time { return time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC) }
	if err := c.Send(context.Background(), "v5.2.2"); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatal(calls)
	}
	info, _ := os.Stat(c.path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
}
func TestFailedStorageSkipsAndRetriesBounded(t *testing.T) {
	calls := 0
	c := testClient(t, func(*http.Request) (*http.Response, error) { calls++; return response(503, ""), nil })
	now := c.now().Add(-12 * time.Hour)
	c.now = func() time.Time { return now }
	for i := 0; i < 10; i++ {
		_ = c.Send(context.Background(), "dev")
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	for i := 0; i < 10; i++ {
		now = now.Add(16 * time.Minute)
		_ = c.Send(context.Background(), "dev")
	}
	if calls != 3 {
		t.Fatal(calls)
	}
	c.path = filepath.Join(c.path, "impossible.json")
	if c.Send(context.Background(), "v5.3.0") == nil || calls != 3 {
		t.Fatal("storage failure sent telemetry")
	}
}
func TestLatestFallbackCacheAndNoIdentity(t *testing.T) {
	calls := 0
	c := testClient(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() == releaseURL {
			return response(503, ""), nil
		}
		if r.URL.String() != githubURL {
			t.Fatal(r.URL)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatal("credential leak")
		}
		return response(200, `{"tag_name":"v5.2.1","html_url":"https://github.com/korex-labs/kview/releases/tag/v5.2.1"}`), nil
	})
	for i := 0; i < 2; i++ {
		if _, err := c.Latest(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 2 {
		t.Fatal(calls)
	}
	if _, err := os.Stat(c.path); !os.IsNotExist(err) {
		t.Fatal("update created identity")
	}
	now := c.now().Add(6 * time.Hour)
	c.now = func() time.Time { return now }
	if _, err := c.Latest(context.Background()); err != nil || calls != 4 {
		t.Fatal(err, calls)
	}
}
