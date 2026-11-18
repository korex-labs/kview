// Package localhistory stores bounded canonical Dashboard publications in a dedicated DB.
package localhistory

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	bolt "go.etcd.io/bbolt"
	berrors "go.etcd.io/bbolt/errors"
)

const SampleSeconds = 900

var metaKey = []byte("history-meta-v1")
var ErrInvalidQuery = errors.New("invalid bounded aligned query")

// Leave headroom for a bounded transaction; this is not a filesystem quota.
func historyDiskGuard(size int64) error {
	if size > MaxDatabaseBytes-(16<<20) {
		return errors.New("history disk safety threshold reached; collection paused")
	}
	return nil
}

type Store struct {
	transitionMu sync.Mutex
	transitions  map[string]*TransitionDiagnostics
	db           *bolt.DB
	retention    int
}

// createCurrent exclusively creates the complete current schema in one transaction.
func createCurrent(path string, days int) (*Store, error) {
	if days != 30 && days != 90 {
		return nil, errors.New("retention must be 30 or 90 days")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error {
		m, err := tx.CreateBucket(metaKey)
		if err != nil {
			return err
		}
		if err = m.Put([]byte("schema"), []byte("1")); err != nil {
			return err
		}
		if err = m.Put([]byte("retention"), []byte{byte(days)}); err != nil {
			return err
		}
		b, err := tx.CreateBucket(trendBucket)
		if err != nil {
			return err
		}
		if err = b.Put([]byte("schema"), []byte("1")); err != nil {
			return err
		}
		return b.Put([]byte("bytes"), stamp(0))
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db, retention: days}, nil
}

// ErrIncompatibleDatabase identifies a refused existing format without exposing paths.
var ErrIncompatibleDatabase = errors.New("incompatible history database; existing file preserved")

// validateCurrent never initializes, repairs, or migrates existing storage.
func validateCurrent(tx *bolt.Tx) (int, error) {
	count := 0
	if err := tx.ForEach(func(name []byte, _ *bolt.Bucket) error {
		count++
		if string(name) != string(metaKey) && string(name) != string(trendBucket) {
			return ErrIncompatibleDatabase
		}
		return nil
	}); err != nil {
		return 0, err
	}
	m, b := tx.Bucket(metaKey), tx.Bucket(trendBucket)
	if count != 2 || m == nil || b == nil {
		return 0, ErrIncompatibleDatabase
	}
	if string(m.Get([]byte("schema"))) != "1" || string(b.Get([]byte("schema"))) != "1" {
		return 0, ErrIncompatibleDatabase
	}
	retention := m.Get([]byte("retention"))
	if len(retention) != 1 || (retention[0] != 30 && retention[0] != 90) {
		return 0, ErrIncompatibleDatabase
	}
	accounting := b.Get([]byte("bytes"))
	if len(accounting) != 8 || number(accounting) < 0 || number(accounting) > trendRetainedMaxBytes {
		return 0, ErrIncompatibleDatabase
	}
	return int(retention[0]), nil
}

// reopen validates under a read-only handle BEFORE any writable open: bbolt
// otherwise initializes existing empty files even when validation later fails.
func reopen(path string, readOnly bool) (*Store, error) {
	if !readOnly {
		checked, err := reopen(path, true)
		if err != nil {
			return nil, err
		}
		if err = checked.Close(); err != nil {
			return nil, err
		}
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("history DB must be private regular file")
	}
	if info.Size() == 0 {
		return nil, ErrIncompatibleDatabase
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second, ReadOnly: readOnly})
	if err != nil {
		if errors.Is(err, berrors.ErrInvalid) || errors.Is(err, berrors.ErrVersionMismatch) || errors.Is(err, berrors.ErrChecksum) {
			return nil, fmt.Errorf("%w: %w", ErrIncompatibleDatabase, err)
		}
		return nil, fmt.Errorf("open history database (preserved, no migration): %w", err)
	}
	s := &Store{db: db}
	err = db.View(func(tx *bolt.Tx) error {
		var err error
		s.retention, err = validateCurrent(tx)
		return err
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// OpenReal refuses incompatible files and retention changes; never overwrites.
func OpenReal(path string, days int) (*Store, error) { return openReal(path, days, false) }
func openReal(path string, days int, changeRetention bool) (*Store, error) {
	if days != 30 && days != 90 {
		return nil, errors.New("retention must be 30 or 90 days")
	}
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return createCurrent(path, days)
	} else if err != nil {
		return nil, err
	}
	checked, err := reopen(path, true)
	if err != nil {
		return nil, err
	}
	retention := checked.retention
	if err = checked.Close(); err != nil {
		return nil, err
	}
	if retention != days && !changeRetention {
		return nil, errors.New("history retention mismatch")
	}
	s, err := reopen(path, false)
	if err != nil {
		return nil, err
	}
	if s.retention != days {
		if !changeRetention {
			_ = s.Close()
			return nil, errors.New("history retention mismatch")
		}
		if err = s.db.Update(func(tx *bolt.Tx) error {
			if _, err := validateCurrent(tx); err != nil {
				return err
			}
			return tx.Bucket(metaKey).Put([]byte("retention"), []byte{byte(days)})
		}); err != nil {
			_ = s.Close()
			return nil, err
		}
		s.retention = days
	}
	return s, nil
}

func (s *Store) Close() error {
	s.transitionMu.Lock()
	defer s.transitionMu.Unlock()
	s.transitions = nil
	return s.db.Close()
}
func stamp(n int64) []byte { var b [8]byte; binary.BigEndian.PutUint64(b[:], uint64(n)); return b[:] }
func number(b []byte) int64 {
	if len(b) != 8 {
		return 0
	}
	return int64(binary.BigEndian.Uint64(b))
}
func validIdentity(s string, empty bool) bool {
	return (empty || len(s) > 0) && len(s) <= 512 && utf8.ValidString(s) && !strings.ContainsAny(s, "\x00\r\n") && strings.TrimSpace(s) == s
}

// ValidateScope checks the same identity domain used by persisted keys.
func ValidateScope(s Scope) error {
	if !validIdentity(s.Context, false) || !validIdentity(s.Namespace, true) {
		return errors.New("invalid history scope")
	}
	return nil
}
