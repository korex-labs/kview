package dataplane

import (
	"bytes"
	"encoding/json"
	"time"

	bolt "go.etcd.io/bbolt"
)

// persistenceRetentionPass is owned by the manager's background worker. A turn
// examines ONE record, releases its read transaction before decoding, and uses
// compare-and-delete in a short write transaction. Never call the legacy global
// prune methods from that worker: they scan whole buckets under the writer lock.
// Search rows are swept separately to avoid deleteCellIndex's unbounded fanout.
// Interrupted passes are safe to restart, including between index/cell cleanup.
type persistenceRetentionPass struct {
	source snapshotPersistence
	now    time.Time
	maxAge time.Duration
	bucket int
	after  []byte
}

var persistenceRetentionBuckets = [][]byte{
	dataplaneSearchBucket, dataplaneSnapshotBucket, dataplaneSignalBucket,
	dataplaneSignalAckBucket, dataplaneSignalSuppressionBucket,
}

func newPersistenceRetentionPass(source snapshotPersistence, now time.Time, maxAge time.Duration) *persistenceRetentionPass {
	return &persistenceRetentionPass{source: source, now: now.UTC(), maxAge: maxAge}
}

// stepPersistenceRetention must be scheduled off the foreground path, with a
// yield between turns. The caller owns retry/rescheduling and pass serialization.
// Only bbolt implements this bounded path; do not fall back to global pruning
// for alternate persistence implementations. The bool reports pass completion.
func (m *manager) stepPersistenceRetention(pass *persistenceRetentionPass) (bool, error) {
	if pass == nil || pass.bucket >= len(persistenceRetentionBuckets) {
		return true, nil
	}
	// Suppression operations take this barrier before currentPersistence. Taking
	// persistenceMu first here would invert that order when a close is pending.
	suppression := pass.bucket == 4
	if suppression {
		m.signalSuppressionsPruneMu.Lock()
		defer m.signalSuppressionsPruneMu.Unlock()
	}
	m.persistenceMu.RLock()
	leased := true
	defer func() {
		if leased {
			m.persistenceMu.RUnlock()
		}
	}()
	if m.persistence != pass.source {
		return true, nil
	}
	m.snapshotHydration.mu.Lock()
	closed := m.snapshotHydration.closed
	m.snapshotHydration.mu.Unlock()
	if closed {
		return true, nil
	}
	store, ok := pass.source.(*boltSnapshotPersistence)
	if !ok || store == nil || store.db == nil {
		return true, nil
	}
	bucket := persistenceRetentionBuckets[pass.bucket]
	var key, value []byte
	err := store.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucket)
		if b == nil {
			return nil
		}
		c := b.Cursor()
		k, v := c.First()
		if len(pass.after) != 0 {
			k, v = c.Seek(pass.after)
			if bytes.Equal(k, pass.after) {
				k, v = c.Next()
			}
		}
		key, value = bytes.Clone(k), bytes.Clone(v)
		return nil
	})
	if err != nil {
		return false, err
	}
	if key == nil {
		pass.bucket++
		pass.after = nil
		return pass.bucket == len(persistenceRetentionBuckets), nil
	}
	expired := retentionRecordExpired(pass.bucket, key, value, pass.now, pass.maxAge)
	if expired {
		deleted := false
		err = store.db.Update(func(tx *bolt.Tx) error {
			b := tx.Bucket(bucket)
			if b == nil || !bytes.Equal(b.Get(key), value) {
				return nil
			}
			if err := b.Delete(key); err != nil {
				return err
			}
			deleted = true
			if pass.bucket == 1 {
				// Search rows have their own bounded pass; never decode the potentially
				// enormous cell index and delete every resource in one writer turn.
				if cells := tx.Bucket(dataplaneCellIndexBucket); cells != nil {
					return cells.Delete(key)
				}
			}
			return nil
		})
		if err != nil {
			return false, err
		}
		// Lazy mirror loads take their mutex before acquiring persistenceMu.
		// Release the disk lease before touching mirrors to avoid a pending
		// persistence writer turning those reader acquisitions into a deadlock.
		m.persistenceMu.RUnlock()
		leased = false
		if deleted {
			m.pruneRetentionMirror(pass.bucket, key, pass.now, pass.maxAge)
		}
	}
	pass.after = key
	return false, nil
}

func retentionRecordExpired(bucket int, key, value []byte, now time.Time, maxAge time.Duration) bool {
	cutoff := now.Add(-maxAge)
	switch bucket {
	case 0:
		if maxAge <= 0 {
			return false
		}
		var row dataplaneSearchRow
		if json.Unmarshal(value, &row) != nil {
			return false
		}
		observed, err := time.Parse(time.RFC3339Nano, row.ObservedAt)
		return err == nil && !observed.IsZero() && observed.Before(cutoff)
	case 1:
		if maxAge <= 0 {
			return false
		}
		if _, _, _, ok := decodeSnapshotKey(key); !ok {
			return false
		}
		observed, ok := persistedSnapshotObservedAt(value)
		return ok && !observed.IsZero() && observed.Before(cutoff)
	case 2:
		var rec SignalHistoryRecord
		return json.Unmarshal(value, &rec) == nil && signalHistoryExpired(rec, now, maxAge)
	case 3:
		var rec SignalAcknowledgementRecord
		return json.Unmarshal(value, &rec) == nil && signalAcknowledgementExpired(rec, now, maxAge)
	case 4:
		if _, _, err := decodeSignalSuppressionKey(key); err != nil {
			return true
		}
		var rec SignalSuppressionRecord
		return json.Unmarshal(value, &rec) != nil || signalSuppressionExpired(rec, now, maxAge)
	}
	return false
}

func signalHistoryExpired(rec SignalHistoryRecord, now time.Time, maxAge time.Duration) bool {
	return maxAge > 0 && rec.LastSeenAt > 0 && rec.LastSeenAt < now.Add(-maxAge).Unix()
}

func signalAcknowledgementExpired(rec SignalAcknowledgementRecord, now time.Time, maxAge time.Duration) bool {
	last := rec.UpdatedAt
	if last <= 0 {
		last = rec.AcknowledgedAt
	}
	return maxAge > 0 && last > 0 && last < now.Add(-maxAge).Unix()
}

func signalSuppressionExpired(rec SignalSuppressionRecord, now time.Time, maxAge time.Duration) bool {
	_, valid := normalizeImportedSignalSuppression(rec, now)
	return !valid || (maxAge > 0 && rec.UpdatedAt < now.Add(-maxAge).Unix())
}

// Delete only expired mirror values, never invalidate a whole history/ack map:
// those maps can contain a newer publication whose durable write is in flight.
func (m *manager) pruneRetentionMirror(bucket int, key []byte, now time.Time, maxAge time.Duration) {
	switch bucket {
	case 2, 3:
		parts := bytes.SplitN(key, []byte(searchKeySeparator), 2)
		if len(parts) != 2 {
			return
		}
		cluster, identity := string(parts[0]), string(parts[1])
		if bucket == 2 {
			m.signalHistoryMu.Lock()
			if rec, ok := m.signalHistory[cluster][identity]; ok && signalHistoryExpired(rec, now, maxAge) {
				delete(m.signalHistory[cluster], identity)
			}
			m.signalHistoryMu.Unlock()
		} else {
			m.signalAckMu.Lock()
			if rec, ok := m.signalAck[cluster][identity]; ok && signalAcknowledgementExpired(rec, now, maxAge) {
				delete(m.signalAck[cluster], identity)
			}
			m.signalAckMu.Unlock()
		}
	case 4:
		cluster, identity, err := decodeSignalSuppressionKey(key)
		if err != nil {
			return
		}
		m.signalSuppressionsMu.Lock()
		if rec, ok := m.signalSuppressions[cluster][identity]; ok && signalSuppressionExpired(rec, now, maxAge) {
			delete(m.signalSuppressions[cluster], identity)
		}
		m.signalSuppressionsMu.Unlock()
	}
}
