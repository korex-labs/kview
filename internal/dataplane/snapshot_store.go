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

type namespacedSnapshotStore[T observedAtGetter] struct {
	mu    sync.RWMutex
	snaps map[string]T
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
