package localhistory

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestHistoryRejectExistingEmptyFileWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unrelated.db")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if s, err := OpenReal(path, 30); err == nil {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("accepted unrelated empty file")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, []byte{}) {
		t.Fatal("rejected existing file was modified")
	}
}

func TestHistoryDiskGuard(t *testing.T) {
	if historyDiskGuard(MaxDatabaseBytes-(16<<20)) != nil || historyDiskGuard(MaxDatabaseBytes-(16<<20)+1) == nil {
		t.Fatal("disk guard boundary")
	}
}

func TestHistoryConfigValidation(t *testing.T) {
	good := Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic:/alpha", Directory: filepath.Join(t.TempDir(), "history"), RetentionDays: 30}
	for _, mutate := range []func(*Config){
		func(c *Config) { c.Directory = "relative" }, func(c *Config) { c.RetentionDays = 31 },
		func(c *Config) { c.QueryContext = "" },
	} {
		c := good
		mutate(&c)
		if c.Validate() == nil {
			t.Fatalf("accepted %+v", c)
		}
	}
	good.Directory = t.TempDir()
	if e := os.Chmod(good.Directory, 0755); e != nil {
		t.Fatal(e)
	}
	if c, e := Start(context.Background(), good, &publicationCollectorSource{}); e == nil {
		c.Close()
		t.Fatal("accepted public directory")
	}
}
