package localhistory

import (
	"path/filepath"
	"testing"
	"time"
)

var epoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func trendStore(t *testing.T, days int) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := OpenReal(path, days)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, path
}
