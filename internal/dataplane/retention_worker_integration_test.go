package dataplane

import (
	"sync"
	"testing"
	"time"
)

func retentionWorkerAwait(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("retention worker did not progress")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestRetentionWorkerWithoutPlanesCoalescesAndRestarts(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/retention.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	policy.Persistence.MaxAgeHours = 24
	m := &manager{persistence: store, policy: policy, bundle: DataplanePolicyBundle{Global: policy}}
	defer m.closeSnapshotHydration()
	old := time.Now().Add(-48 * time.Hour).Unix()
	seed := func(key string) {
		t.Helper()
		if err := store.UpsertSignalHistory("unopened", map[string]SignalHistoryRecord{key: {LastSeenAt: old}}); err != nil {
			t.Fatal(err)
		}
	}
	absent := func(key string) bool {
		rows, err := store.LoadSignalHistory("unopened")
		if err != nil {
			t.Fatal(err)
		}
		_, exists := rows[key]
		return !exists
	}
	seed("first")
	// A foreground demand gates background work, but must never gate policy apply.
	m.hydrationDemand.Add(1)
	if err := m.configurePersistence(policy); err != nil {
		t.Fatal(err)
	}
	if absent("first") {
		t.Fatal("configure synchronously pruned unopened context")
	}
	for _, age := range []int{72, 48, 24} {
		policy.Persistence.MaxAgeHours = age
		m.SetPolicy(policy)
	}
	q := &m.snapshotHydration
	q.mu.Lock()
	queued := q.retention != nil && q.retention.maxAge == 24*time.Hour && len(q.passes) == 0 && q.running
	q.mu.Unlock()
	if !queued {
		t.Fatal("latest retention policy was not coalesced without planes")
	}
	m.hydrationDemand.Add(-1)
	retentionWorkerAwait(t, func() bool { return absent("first") })
	retentionWorkerAwait(t, func() bool { q.mu.Lock(); defer q.mu.Unlock(); return !q.retentionDue.IsZero() })
	seed("later")
	// Advance the maintenance deadline instead of sleeping for the production minute.
	q.mu.Lock()
	q.retentionDue = time.Now().Add(-time.Second)
	m.startSnapshotHydrationLocked()
	q.mu.Unlock()
	retentionWorkerAwait(t, func() bool { return absent("later") })
	policy.Persistence.Enabled = false
	m.SetPolicy(policy)
	retentionWorkerAwait(t, func() bool { q.mu.Lock(); defer q.mu.Unlock(); return !q.running && q.retention == nil })
	if m.currentPersistence() != nil {
		t.Fatal("disable retained persistence")
	}
}

func TestRetentionWorkerCloseWakesIdleMaintenance(t *testing.T) {
	m, base := startupPlaneManager(t)
	m.queuePersistenceRetention(base, time.Hour)
	q := &m.snapshotHydration
	retentionWorkerAwait(t, func() bool { q.mu.Lock(); defer q.mu.Unlock(); return !q.retentionDue.IsZero() })
	m.closeSnapshotHydration()
	retentionWorkerAwait(t, func() bool { q.mu.Lock(); defer q.mu.Unlock(); return !q.running })
	m.queuePersistenceRetention(base, time.Hour)
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.running || q.retention != nil {
		t.Fatal("closed worker restarted")
	}
}

func TestRetentionMirrorReleasesPersistenceLease(t *testing.T) {
	for _, bucket := range []int{2, 3} {
		t.Run(map[int]string{2: "history", 3: "acknowledgements"}[bucket], func(t *testing.T) {
			store, err := openBoltSnapshotPersistence(t.TempDir() + "/retention.bbolt")
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			old := time.Now().Add(-48 * time.Hour).Unix()
			if bucket == 2 {
				err = store.UpsertSignalHistory("ctx", map[string]SignalHistoryRecord{"old": {LastSeenAt: old}})
			} else {
				err = store.UpsertSignalAcknowledgement("ctx", "old", SignalAcknowledgementRecord{UpdatedAt: old})
			}
			if err != nil {
				t.Fatal(err)
			}
			m := &manager{persistence: store}
			var mirror *sync.RWMutex
			if bucket == 2 {
				mirror = &m.signalHistoryMu
			} else {
				mirror = &m.signalAckMu
			}
			mirror.Lock()
			var release sync.Once
			defer release.Do(mirror.Unlock)
			done := make(chan error, 1)
			pass := newPersistenceRetentionPass(store, time.Now(), time.Hour)
			pass.bucket = bucket
			go func() { _, err := m.stepPersistenceRetention(pass); done <- err }()
			retentionWorkerAwait(t, func() bool {
				if bucket == 2 {
					rows, err := store.LoadSignalHistory("ctx")
					if err != nil {
						t.Fatal(err)
					}
					return len(rows) == 0
				}
				rows, err := store.LoadSignalAcknowledgements("ctx")
				if err != nil {
					t.Fatal(err)
				}
				return len(rows) == 0
			})
			writer := make(chan struct{})
			go func() { m.persistenceMu.Lock(); m.persistenceMu.Unlock(); close(writer) }()
			// The disk writer must acquire its lock even while mirror cleanup is blocked.
			startupAwait(t, writer)
			release.Do(mirror.Unlock)
			if err := startupAwait(t, done); err != nil {
				t.Fatal(err)
			}
		})
	}
}
