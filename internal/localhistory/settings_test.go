package localhistory

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testPolicies() map[string]Policy {
	return map[string]Policy{"synthetic-a": {Enabled: true, RetentionDays: 30, Revision: 1}, "synthetic-b": {RetentionDays: 90, Revision: 4}}
}
func TestHistorySettingsPrivateAtomicRoundTrip(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "history")
	if p, e := LoadPolicies(dir); e != nil || len(p) != 0 {
		t.Fatal(p, e)
	}
	if _, e := os.Stat(dir); !os.IsNotExist(e) {
		t.Fatal("load created directory")
	}
	p := testPolicies()
	if e := SavePolicies(dir, p); e != nil {
		t.Fatal(e)
	}
	for path, mode := range map[string]os.FileMode{dir: 0700, filepath.Join(dir, "settings.json"): 0600} {
		i, e := os.Stat(path)
		if e != nil || i.Mode().Perm() != mode {
			t.Fatal(path, i, e)
		}
	}
	got, e := LoadPolicies(dir)
	if e != nil || !reflect.DeepEqual(got, p) {
		t.Fatal(got, e)
	}
	before, e := os.ReadFile(filepath.Join(dir, "settings.json"))
	if e != nil {
		t.Fatal(e)
	}
	bad := testPolicies()
	v := bad["synthetic-a"]
	v.RetentionDays = 31
	bad["synthetic-a"] = v
	for _, bad := range []map[string]Policy{bad, nil} {
		if e := SavePolicies(dir, bad); e == nil {
			t.Fatal("accepted invalid policies")
		}
		after, e := os.ReadFile(filepath.Join(dir, "settings.json"))
		if e != nil || !bytes.Equal(before, after) {
			t.Fatal("failed save changed old state", e)
		}
	}
	p["synthetic-a"] = Policy{RetentionDays: 90, Revision: 2}
	if e := SavePolicies(dir, p); e != nil {
		t.Fatal(e)
	}
	got, e = LoadPolicies(dir)
	if e != nil || !reflect.DeepEqual(got, p) {
		t.Fatal(got, e)
	}
	// Natural rename failure after temporary write/sync: target is a nonempty directory.
	target := filepath.Join(dir, "settings.json")
	if e := os.Remove(target); e != nil {
		t.Fatal(e)
	}
	if e := os.Mkdir(target, 0700); e != nil {
		t.Fatal(e)
	}
	sentinel := filepath.Join(target, "preserved")
	if e := os.WriteFile(sentinel, []byte("old"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := SavePolicies(dir, p); e == nil {
		t.Fatal("rename unexpectedly succeeded")
	}
	raw, e := os.ReadFile(sentinel)
	if e != nil || string(raw) != "old" {
		t.Fatal("target damaged", e)
	}
	entries, e := os.ReadDir(dir)
	if e != nil || len(entries) != 1 {
		t.Fatal("temporary file leaked", entries, e)
	}
}
func TestHistorySettingsRejectUnsafeFiles(t *testing.T) {
	for _, kind := range []string{"public-file", "public-dir", "file-symlink", "dir-symlink", "directory", "oversize", "null", "trailing", "unknown", "bad-policy"} {
		t.Run(kind, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "history")
			if e := SavePolicies(dir, testPolicies()); e != nil {
				t.Fatal(e)
			}
			path := filepath.Join(dir, "settings.json")
			switch kind {
			case "public-file":
				if e := os.Chmod(path, 0644); e != nil {
					t.Fatal(e)
				}
			case "public-dir":
				if e := os.Chmod(dir, 0755); e != nil {
					t.Fatal(e)
				}
			case "file-symlink":
				if e := os.Rename(path, path+".real"); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(path+".real", path); e != nil {
					t.Fatal(e)
				}
			case "dir-symlink":
				if e := os.Rename(dir, dir+".real"); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(dir+".real", dir); e != nil {
					t.Fatal(e)
				}
			case "directory":
				if e := os.Remove(path); e != nil {
					t.Fatal(e)
				}
				if e := os.Mkdir(path, 0700); e != nil {
					t.Fatal(e)
				}
			default:
				raw := map[string]string{"oversize": strings.Repeat(" ", 65537), "null": "null", "trailing": "{} {}", "unknown": `{"synthetic-a":{"retentionDays":30,"path":"elsewhere"}}`, "bad-policy": `{"synthetic-a":{"retentionDays":31}}`}[kind]
				if e := os.WriteFile(path, []byte(raw), 0600); e != nil {
					t.Fatal(e)
				}
			}
			if _, e := LoadPolicies(dir); e == nil {
				t.Fatal("unsafe file accepted")
			}
			if kind == "dir-symlink" || kind == "public-dir" {
				if e := SavePolicies(dir, testPolicies()); e == nil {
					t.Fatal("unsafe directory accepted for save")
				}
			}
		})
	}
	for _, dir := range []string{"", "relative-history"} {
		if _, e := LoadPolicies(dir); e == nil {
			t.Fatal("relative load accepted")
		}
		if e := SavePolicies(dir, testPolicies()); e == nil {
			t.Fatal("relative save accepted")
		}
	}
}
func TestHistorySettingsGlobalLimitsIncludeDisabled(t *testing.T) {
	p := map[string]Policy{}
	for i := 0; i < MaxScopes; i++ {
		p[fmt.Sprintf("synthetic-%03d", i)] = Policy{RetentionDays: 30}
	}
	if e := validatePolicies(p); e != nil {
		t.Fatal(e)
	}
	p["extra"] = Policy{RetentionDays: 30}
	if e := validatePolicies(p); e == nil {
		t.Fatal("context limit bypassed")
	}
	// Per-field valid but serialized map exceeds the bounded persistence envelope.
	p = map[string]Policy{}
	for i := 0; i < MaxScopes; i++ {
		p[fmt.Sprintf("%03d", i)+strings.Repeat("x", 500)] = Policy{RetentionDays: 30}
	}
	if e := SavePolicies(filepath.Join(t.TempDir(), "history"), p); e == nil {
		t.Fatal("oversize settings accepted")
	}
}
