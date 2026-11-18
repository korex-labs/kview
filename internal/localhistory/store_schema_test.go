package localhistory

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestCurrentSchemaRoundTripReadOnlyAndIdentity(t *testing.T) {
	s, path := trendStore(t, 30)
	if err := s.db.View(func(tx *bolt.Tx) error {
		days, err := validateCurrent(tx)
		if err != nil || days != 30 {
			t.Fatalf("schema: %d %v", days, err)
		}
		var names []string
		_ = tx.ForEach(func(k []byte, _ *bolt.Bucket) error { names = append(names, string(k)); return nil })
		if !reflect.DeepEqual(names, []string{"history-meta-v1", "signal-trends-v1"}) {
			t.Fatal(names)
		}
		if !bytes.Equal(tx.Bucket(trendBucket).Get([]byte("bytes")), stamp(0)) {
			t.Fatal("accounting not initialized")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if other, err := createCurrent(path, 30); err == nil {
		if err := other.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("exclusive creation overwrote store")
	}
	b := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
	b.Context = "arn:example/cluster:α"
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: b.Context, From: epoch, To: epoch.Add(time.Hour), AsOf: epoch.Add(time.Minute)}
	before, err := s.QueryTrends(q)
	if err != nil || len(before.Severity) == 0 || before.Severity[0].Points[0].Counts.High != 1 {
		t.Fatal(before, err)
	}
	for _, name := range []string{b.Context + "-other", "arn:example/cluster:", "other"} {
		isolated := q
		isolated.Context = name
		out, err := s.QueryTrends(isolated)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range out.Severity {
			for _, point := range row.Points {
				if point.Counts != nil {
					t.Fatal("cross-context evidence", name)
				}
			}
		}
	}
	for _, name := range []string{"a\x00b", "a\nb", " leading", "trailing "} {
		bad := b
		bad.Context = name
		if s.AppendTrends(bad) == nil {
			t.Fatal("invalid context accepted", name)
		}
		invalid := q
		invalid.Context = name
		if _, err := s.QueryTrends(invalid); err == nil {
			t.Fatal("invalid query accepted", name)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	ro, err := reopen(path, true)
	if err != nil {
		t.Fatal(err)
	}
	out, err := ro.QueryTrends(q)
	if err != nil || !reflect.DeepEqual(before.Severity, out.Severity) {
		t.Fatal("read-only round trip", err)
	}
	if ro.AppendTrends(b) == nil {
		t.Fatal("read-only append succeeded")
	}
	if err := ro.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, after) {
		t.Fatal("read-only query mutated DB")
	}
	if rw, err := OpenReal(path, 90); err == nil {
		if err := rw.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("retention silently changed")
	}
	after, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, after) {
		t.Fatal("retention refusal mutated DB")
	}
	rw, err := OpenReal(path, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := rw.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	replay, err := rw.QueryTrends(q)
	if err != nil || len(replay.Severity) != 1 || !reflect.DeepEqual(before.Severity[0].Points[0].Counts, replay.Severity[0].Points[0].Counts) || replay.Severity[0].Points[0].ConfirmedChanges != 0 {
		t.Fatal("replay changed totals", err)
	}
	if err := rw.Close(); err != nil {
		t.Fatal(err)
	}
	managed, err := openReal(path, 90, true)
	if err != nil {
		t.Fatal(err)
	}
	if managed.retention != 90 {
		t.Fatal("managed retention not applied")
	}
	if err := managed.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCurrentSchemaRefusalPreservesEveryByte(t *testing.T) {
	cases := []string{"prototype", "foreign", "empty", "missing-meta", "wrong-meta-schema", "missing-trends", "missing-trend-schema", "wrong-trend-schema", "missing-bytes", "short-bytes", "negative-bytes", "excess-bytes", "bad-retention", "extra-bucket"}
	for _, kind := range cases {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "history.db")
			if kind == "empty" {
				if err := os.WriteFile(path, nil, 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				s, err := OpenReal(path, 30)
				if err != nil {
					t.Fatal(err)
				}
				err = s.db.Update(func(tx *bolt.Tx) error {
					m, b := tx.Bucket(metaKey), tx.Bucket(trendBucket)
					switch kind {
					case "prototype", "foreign":
						if err := tx.DeleteBucket(metaKey); err != nil {
							return err
						}
						if err := tx.DeleteBucket(trendBucket); err != nil {
							return err
						}
						name := "cache"
						if kind == "prototype" {
							name = "history-prototype-v2"
						}
						_, err := tx.CreateBucket([]byte(name))
						return err
					case "missing-meta":
						return tx.DeleteBucket(metaKey)
					case "wrong-meta-schema":
						return m.Put([]byte("schema"), []byte("2"))
					case "missing-trends":
						return tx.DeleteBucket(trendBucket)
					case "missing-trend-schema":
						return b.Delete([]byte("schema"))
					case "wrong-trend-schema":
						return b.Put([]byte("schema"), []byte("2"))
					case "missing-bytes":
						return b.Delete([]byte("bytes"))
					case "short-bytes":
						return b.Put([]byte("bytes"), []byte{0})
					case "negative-bytes":
						return b.Put([]byte("bytes"), stamp(-1))
					case "excess-bytes":
						return b.Put([]byte("bytes"), stamp(trendRetainedMaxBytes+1))
					case "bad-retention":
						return m.Put([]byte("retention"), []byte{31})
					case "extra-bucket":
						_, err := tx.CreateBucket([]byte("series"))
						return err
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, managed := range []bool{false, true} {
				s, err := openReal(path, 90, managed)
				if err == nil {
					if err := s.Close(); err != nil {
						t.Error(err)
					}
					t.Fatal("incompatible file accepted", managed)
				}
				if !errors.Is(err, ErrIncompatibleDatabase) {
					t.Fatalf("missing incompatible classification: %v", err)
				}
				after, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(before, after) {
					t.Fatal("refusal mutated DB", managed)
				}
			}
		})
	}
	missing := filepath.Join(t.TempDir(), "absent.db")
	if s, err := reopen(missing, false); err == nil {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("reopened missing file")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("reopen created missing file", err)
	}
}

func TestCurrentTrendRetentionBoundariesAndAccounting(t *testing.T) {
	for _, days := range []int{30, 90} {
		t.Run(fmt.Sprint(days), func(t *testing.T) {
			s, _ := trendStore(t, days)
			for _, name := range []string{"inactive", "active"} {
				b := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
				b.Context = name
				if err := s.AppendTrends(b); err != nil {
					t.Fatal(err)
				}
			}
			boundary := epoch.Add(time.Duration(days) * 24 * time.Hour)
			if err := s.pruneTrends(boundary); err != nil {
				t.Fatal(err)
			}
			inspect := func(wantHour bool) {
				t.Helper()
				if err := s.db.View(func(tx *bolt.Tx) error {
					root := tx.Bucket(trendBucket)
					var actual int64
					err := root.ForEach(func(k, v []byte) error {
						if v != nil {
							return nil
						}
						b := root.Bucket(k)
						actual += int64(len(b.Get([]byte("current"))))
						h := b.Bucket([]byte("hours"))
						if (h.Get(stamp(epoch.Unix())) != nil) != wantHour {
							t.Fatal("inactive context cutoff incorrect")
						}
						return h.ForEach(func(_, v []byte) error { actual += int64(len(v)); return nil })
					})
					if actual != number(root.Get([]byte("bytes"))) {
						t.Fatal("retained accounting mismatch", actual)
					}
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			inspect(true)
			if err := s.pruneTrends(boundary.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			inspect(false)
		})
	}
}

func TestCurrentTrendContextCapUpdatesAndPruneBeforeRejection(t *testing.T) {
	s, _ := trendStore(t, 30)
	for i := 0; i < MaxScopes; i++ {
		b := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
		b.Context = fmt.Sprintf("context-%03d", i)
		if err := s.AppendTrends(b); err != nil {
			t.Fatal(err)
		}
	}
	update := trendFixture(epoch.Add(time.Minute), TrendSignal{ID: "one", Severity: "medium"})
	update.Context = "context-000"
	if err := s.AppendTrends(update); err != nil {
		t.Fatal("existing context denied at cap", err)
	}
	rejected := trendFixture(epoch.Add(31 * 24 * time.Hour))
	rejected.Context = "new-context"
	if err := s.AppendTrends(rejected); err == nil {
		t.Fatal("context cap ignored")
	}
	if err := s.db.View(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		if root.Bucket(signalContextKey(rejected.Context)) != nil {
			t.Fatal("failed admission left context")
		}
		var actual int64
		err := root.ForEach(func(k, v []byte) error {
			if v != nil {
				return nil
			}
			b := root.Bucket(k)
			actual += int64(len(b.Get([]byte("current"))))
			if k, _ := b.Bucket([]byte("hours")).Cursor().First(); k != nil {
				t.Fatal("prune rolled back with rejected admission")
			}
			return nil
		})
		if actual != number(root.Get([]byte("bytes"))) {
			t.Fatal("prune accounting incorrect")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCurrentSchemaPrivateFileAndSymlinkRefusal(t *testing.T) {
	for _, kind := range []string{"public", "symlink", "directory"} {
		t.Run(kind, func(t *testing.T) {
			s, path := trendStore(t, 30)
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			target := path
			switch kind {
			case "public":
				if err = os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target = path + ".target"
				if err = os.Rename(path, target); err != nil {
					t.Fatal(err)
				}
				if err = os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			case "directory":
				target = path + ".target"
				if err = os.Rename(path, target); err != nil {
					t.Fatal(err)
				}
				if err = os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if opened, err := OpenReal(path, 30); err == nil {
				if err := opened.Close(); err != nil {
					t.Error(err)
				}
				t.Fatal("unsafe DB accepted")
			}
			after, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("refusal changed existing data")
			}
		})
	}
}

func TestCurrentTrendRetainedCapRollsBackWritesAndDiagnostics(t *testing.T) {
	s, _ := trendStore(t, 30)
	b := trendFixture(epoch, TrendSignal{ID: "one", Severity: "high"})
	if err := s.AppendTrends(b); err != nil {
		t.Fatal(err)
	}
	var current, hour []byte
	if err := s.db.Update(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		c := root.Bucket(signalContextKey(b.Context))
		current = bytes.Clone(c.Get([]byte("current")))
		hour = bytes.Clone(c.Bucket([]byte("hours")).Get(stamp(epoch.Unix())))
		// Inject the boundary directly so the regression does not allocate 64 MiB.
		return root.Put([]byte("bytes"), stamp(trendRetainedMaxBytes))
	}); err != nil {
		t.Fatal(err)
	}
	prior := s.transitionDiagnostics(b.Context, b.Epoch)
	b.At = epoch.Add(time.Hour)
	b.Domains[0].SourceAt = b.At
	b.Domains[0].Signals[0].Severity = "medium"
	if err := s.AppendTrends(b); err == nil {
		t.Fatal("retained cap ignored")
	}
	if err := s.db.View(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		c := root.Bucket(signalContextKey(b.Context))
		h := c.Bucket([]byte("hours"))
		if !bytes.Equal(current, c.Get([]byte("current"))) || !bytes.Equal(hour, h.Get(stamp(epoch.Unix()))) || h.Get(stamp(b.At.Unix())) != nil {
			t.Fatal("rejected transaction changed evidence")
		}
		if number(root.Get([]byte("bytes"))) != trendRetainedMaxBytes {
			t.Fatal("rejected write changed accounting")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(prior, s.transitionDiagnostics(b.Context, b.Epoch)) {
		t.Fatal("rejected transaction published transition diagnostics")
	}
}
