package dataplane

import (
	"sync"
	"time"
)

type observedAtGetter interface {
	ObservedAt() time.Time
}

type snapshotStore[T observedAtGetter] struct {
	mu   sync.RWMutex
	rev  uint64
	snap T
}

func (s *snapshotStore[T]) getFresh(ttl time.Duration) (T, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.snap.ObservedAt().IsZero() {
		var zero T
		return zero, false
	}
	if time.Since(s.snap.ObservedAt()) >= ttl {
		var zero T
		return zero, false
	}
	return s.snap, true
}

func (s *snapshotStore[T]) set(snap T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snap = snap
}

// setClusterSnapshot stores a cluster-wide snapshot and bumps the monotonic revision for that list.
func setClusterSnapshot[I any](s *snapshotStore[Snapshot[I]], snap Snapshot[I]) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rev++
	snap.Meta.Revision = s.rev
	s.snap = snap
}

func peekClusterSnapshot[I any](s *snapshotStore[Snapshot[I]]) (snap Snapshot[I], ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.snap.Meta.ObservedAt.IsZero() {
		return Snapshot[I]{}, false
	}
	return s.snap, true
}

type namespacedSnapshotStore[T observedAtGetter] struct {
	mu    sync.RWMutex
	snaps map[string]T
	nsRev map[string]uint64
}

func newNamespacedSnapshotStore[T observedAtGetter]() namespacedSnapshotStore[T] {
	return namespacedSnapshotStore[T]{snaps: make(map[string]T)}
}

func (s *namespacedSnapshotStore[T]) getFresh(namespace string, ttl time.Duration) (T, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snap, ok := s.snaps[namespace]
	if !ok || snap.ObservedAt().IsZero() {
		var zero T
		return zero, false
	}
	if time.Since(snap.ObservedAt()) >= ttl {
		var zero T
		return zero, false
	}
	return snap, true
}

// getCached returns the latest stored snapshot for the namespace when ObservedAt is set,
// ignoring TTL (dashboard and other read paths that must not trigger list fetches).
func (s *namespacedSnapshotStore[T]) getCached(namespace string) (T, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snap, ok := s.snaps[namespace]
	if !ok || snap.ObservedAt().IsZero() {
		var zero T
		return zero, false
	}
	return snap, true
}

func (s *namespacedSnapshotStore[T]) set(namespace string, snap T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snaps == nil {
		s.snaps = make(map[string]T)
	}
	s.snaps[namespace] = snap
}

// setNamespacedSnapshot stores a per-namespace snapshot and bumps revision for that namespace key.
func setNamespacedSnapshot[I any](s *namespacedSnapshotStore[Snapshot[I]], namespace string, snap Snapshot[I]) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snaps == nil {
		s.snaps = make(map[string]Snapshot[I])
	}
	if s.nsRev == nil {
		s.nsRev = make(map[string]uint64)
	}
	s.nsRev[namespace]++
	snap.Meta.Revision = s.nsRev[namespace]
	s.snaps[namespace] = snap
}

func clearNamespacedSnapshot[I any](s *namespacedSnapshotStore[Snapshot[I]], namespace string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snaps == nil {
		s.snaps = make(map[string]Snapshot[I])
	}
	if s.nsRev == nil {
		s.nsRev = make(map[string]uint64)
	}
	s.nsRev[namespace]++
	delete(s.snaps, namespace)
}

func peekNamespacedSnapshot[I any](s *namespacedSnapshotStore[Snapshot[I]], namespace string) (snap Snapshot[I], ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sn, have := s.snaps[namespace]
	if !have || sn.Meta.ObservedAt.IsZero() {
		return Snapshot[I]{}, false
	}
	return sn, true
}

func peekAllNamespacedSnapshots[I any](s *namespacedSnapshotStore[Snapshot[I]]) map[string]Snapshot[I] {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Snapshot[I], len(s.snaps))
	for namespace, snap := range s.snaps {
		if snap.Meta.ObservedAt.IsZero() {
			continue
		}
		out[namespace] = snap
	}
	return out
}
