// Package outreach owns opt-in, non-cluster external communication. It has no timers.
package outreach

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const releaseURL = "https://korex-labs.com/api/kview/releases/latest"
const statisticsURL = "https://korex-labs.com/api/kview/statistics"
const githubURL = "https://api.github.com/repos/korex-labs/kview/releases/latest"

var versionPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$`)
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func NormalizeVersion(v string) string {
	if len(v) <= 64 && !strings.Contains(v, "-dirty") && !regexp.MustCompile(`-[0-9]+-g[0-9a-f]+`).MatchString(v) && versionPattern.MatchString(v) {
		return strings.TrimPrefix(v, "v")
	}
	return "development"
}

type Release struct {
	Tag string `json:"tag_name"`
	URL string `json:"html_url"`
}
type attempt struct {
	Count int       `json:"count"`
	Next  time.Time `json:"next"`
	Sent  bool      `json:"sent"`
}
type state struct {
	ID          string             `json:"installation_id"`
	Day         string             `json:"day"`
	LastVersion string             `json:"last_version"`
	Versions    map[string]attempt `json:"versions"`
}
type Client struct {
	statsMu      sync.Mutex
	releaseMu    sync.Mutex
	path         string
	http         *http.Client
	now          func() time.Time
	release      Release
	releaseUntil time.Time
}

// New does not create files or contact the network. No temporary-dir identity fallback.
func New() *Client {
	base, err := os.UserConfigDir()
	path := ""
	if err == nil && base != "" {
		path = filepath.Join(base, "kview", "installation-statistics.json")
	}
	return &Client{path: path, now: time.Now, http: &http.Client{Timeout: 8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *Client) Latest(ctx context.Context) (Release, error) {
	c.releaseMu.Lock()
	defer c.releaseMu.Unlock()
	if c.now().Before(c.releaseUntil) {
		return c.release, nil
	}
	for _, url := range []string{releaseURL, githubURL} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return Release{}, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "kview-update-check")
		res, err := c.http.Do(req)
		if err != nil {
			continue
		}
		var release Release
		raw, readErr := io.ReadAll(io.LimitReader(res.Body, 65537))
		_ = res.Body.Close() // Response validation, not cleanup, determines the result.
		if res.StatusCode != 200 || readErr != nil || len(raw) > 65536 || json.Unmarshal(raw, &release) != nil {
			continue
		}
		if NormalizeVersion(release.Tag) == "development" || release.URL != "https://github.com/korex-labs/kview/releases/tag/"+release.Tag {
			continue
		}
		c.release = release
		c.releaseUntil = c.now().Add(6 * time.Hour)
		return release, nil
	}
	return Release{}, errors.New("release metadata unavailable")
}

func (c *Client) save(s state) error {
	if c.path == "" {
		return errors.New("config directory unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(c.path), ".statistics-*")
	if err != nil {
		return err
	}
	defer func() {
		// Best-effort cleanup: a successful rename already removed this path.
		_ = os.Remove(f.Name())
	}()
	if _, err = f.Write(raw); err != nil {
		_ = f.Close() // Preserve the original write/sync error.
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close() // Preserve the original write/sync error.
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), c.path)
}

// Send is called only by an explicit, authenticated consent-bearing UI request.
// One attempt per invocation, max three/day/version with a persisted 15-minute backoff.
// Serializing here deduplicates all browser tabs using this backend.
func (c *Client) Send(ctx context.Context, version string) error {
	c.statsMu.Lock()
	defer c.statsMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.path == "" {
		return errors.New("config directory unavailable")
	}
	s := state{}
	raw, err := os.ReadFile(c.path)
	if err == nil {
		if json.Unmarshal(raw, &s) != nil || !uuidPattern.MatchString(s.ID) {
			return errors.New("invalid statistics state")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else {
		var id [16]byte
		if _, err = rand.Read(id[:]); err != nil {
			return err
		}
		id[6] = (id[6] & 0x0f) | 0x40
		id[8] = (id[8] & 0x3f) | 0x80
		s.ID = fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
	}
	now := c.now().UTC()
	day := now.Format("2006-01-02")
	version = NormalizeVersion(version)
	if s.Day != day || s.Versions == nil {
		s.Day = day
		s.LastVersion = ""
		s.Versions = map[string]attempt{}
	}
	a := s.Versions[version]
	if (a.Sent && s.LastVersion == version) || a.Count >= 3 || (!a.Sent && now.Before(a.Next)) {
		return nil
	}
	// Bound local state even if a user runs many distinct versions in a day.
	if len(s.Versions) >= 32 && a.Count == 0 {
		return nil
	}
	a.Sent = false
	a.Count++
	a.Next = now.Add(15 * time.Minute)
	s.Versions[version] = a
	// Persist the identity AND attempt before any outgoing request. On failure, skip.
	if err = c.save(s); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{"installation_id": s.ID, "version": version})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, statisticsURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "kview-statistics")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	_ = res.Body.Close() // Response validation, not cleanup, determines the result.
	if res.StatusCode != http.StatusNoContent {
		return errors.New("statistics unavailable")
	}
	a.Sent = true
	s.LastVersion = version
	s.Versions[version] = a
	return c.save(s)
}
