package localhistory

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestHistoryRejectRetiredPolicyWithoutMutation(t *testing.T) {
	for _, field := range []string{`"namespaceMode":"manual"`, `"namespaceMode":"follow-enrichment"`, `"namespaces":[]`} {
		dir := t.TempDir()
		if err := os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, "settings.json")
		raw := []byte(`{"synthetic-a":{"enabled":false,"signalHistory":false,"retentionDays":30,"revision":0,` + field + `}}`)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadPolicies(dir); err == nil {
			t.Fatal("retired policy accepted", field)
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(raw, after) {
			t.Fatal("rejected policy changed", err)
		}
	}
}
