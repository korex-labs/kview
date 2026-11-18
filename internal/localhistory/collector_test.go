package localhistory

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryDisabledAndCancellation(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "absent")
		c, err := StartManaged(context.Background(), Config{Enabled: enabled, Directory: path, QueryContext: "synthetic-a", RetentionDays: 30}, nil)
		if err != nil || c != nil {
			t.Fatal(c, err)
		}
		if _, err = os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("no consent created storage")
		}
	}
	source := &publicationCollectorSource{namespaces: []string{"alpha"}, active: map[string]bool{}, revision: map[string]uint64{}}
	ctx, cancel := context.WithCancel(context.Background())
	dir := filepath.Join(t.TempDir(), "history")
	c, err := StartManaged(ctx, Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a", Directory: dir, RetentionDays: 30}, source)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	waitPublicationCollection(t, c, func(out TrendResponse) bool { return publicationHigh(out) == 0 })
	cancel()
	select {
	case <-c.done:
	case <-time.After(3 * time.Second):
		t.Fatal("worker not joined")
	}
	if c.Status().Enabled {
		t.Fatal("exited worker enabled")
	}
	now := time.Now().UTC().Truncate(time.Hour)
	if _, err = c.QueryTrends(TrendQuery{Context: "synthetic-a", From: now, To: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	c.Close()
	c.Close()
	if _, err = c.QueryTrends(TrendQuery{Context: "synthetic-a", From: now, To: now.Add(time.Hour)}); err == nil {
		t.Fatal("closed database readable")
	}
	store, err := OpenReal(filepath.Join(dir, "history-real-v1.db"), 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}
