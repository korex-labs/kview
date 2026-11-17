package dataplane

import (
	"errors"
	"sync/atomic"
	"time"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

var canonicalPublicationRevision atomic.Uint64

// Invalidation only enqueues bounded metadata; projection work stays on the worker.
func (m *manager) invalidateCanonicalHistory(name string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for contextName, q := range m.historySubscriptions {
		if name == "" || name == contextName {
			q.Enqueue(localhistory.Publication{Context: contextName, Kind: "canonical-policy", Revision: canonicalPublicationRevision.Add(1), ObservedAt: time.Now().UTC()})
		}
	}
}

// SubscribeHistoryPublications registers exact-context consent without creating,
// hydrating or fetching a plane. Existing and subsequently published planes bind
// under the same manager lock. Release never joins a worker under that lock.
func (m *manager) SubscribeHistoryPublications(name, epoch string) (*localhistory.PublicationQueue, func(), error) {
	q, err := localhistory.NewPublicationQueue(name, epoch, 2048)
	if err != nil {
		return nil, nil, err
	}
	m.mu.Lock()
	if m.historySubscriptions[name] != nil {
		m.mu.Unlock()
		q.Close()
		return nil, nil, errors.New("publication subscription already exists")
	}
	if len(m.historySubscriptions) >= 128 {
		m.mu.Unlock()
		q.Close()
		return nil, nil, errors.New("publication subscription capacity reached")
	}
	if m.historySubscriptions == nil {
		m.historySubscriptions = make(map[string]*localhistory.PublicationQueue)
	}
	m.historySubscriptions[name] = q
	if p := m.planes[name]; p != nil {
		p.historyPublications.Store(q)
	}
	m.mu.Unlock()
	return q, func() {
		m.mu.Lock()
		if m.historySubscriptions[name] == q {
			delete(m.historySubscriptions, name)
			if p := m.planes[name]; p != nil {
				p.historyPublications.CompareAndSwap(q, nil)
			}
		}
		m.mu.Unlock()
		q.Close()
	}, nil
}

// notifySnapshotPublication runs strictly after the store mutex is released.
// The disabled path is one pointer load. Only bounded metadata is enqueued;
// neither detectors nor arbitrary callbacks execute in publication paths.
func notifySnapshotPublication[I any](t snapshotStoreTelemetry, namespace string, snap Snapshot[I]) {
	if t.publications == nil {
		return
	}
	q := t.publications.Load()
	if q == nil || snap.restored || snap.Err != nil || snap.Meta.ObservedAt.IsZero() || snap.Meta.Freshness != FreshnessClassHot || snap.Meta.Coverage != CoverageClassFull || snap.Meta.Completeness != CompletenessClassComplete || snap.Meta.Degradation != DegradationClassNone {
		return
	}
	q.Enqueue(localhistory.Publication{Context: t.cluster, Namespace: namespace, Kind: string(t.kind), Revision: snap.Meta.Revision, ObservedAt: snap.Meta.ObservedAt})
}
