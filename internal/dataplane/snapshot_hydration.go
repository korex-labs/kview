package dataplane

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Paging enumerates keys only. Neither a transaction nor a batch of JSON payloads
// is retained while yielding to foreground work.
type snapshotKeyPager interface {
	SnapshotKeysPage(cluster string, after []byte, limit int) ([]persistedSnapshotCell, []byte, error)
}

type snapshotHydrationCell struct {
	source snapshotPersistence
	epoch  uint64
	ready  chan struct{}
	err    error
}

type snapshotHydrationPass struct {
	plane    *clusterPlane
	source   snapshotPersistence
	after    []byte
	epoch    uint64
	attempts int
	partial  bool
}

type snapshotHydrationQueue struct {
	mu           sync.Mutex
	epoch        uint64
	closed       bool
	running      bool
	passes       []*snapshotHydrationPass
	retention    *persistenceRetentionPass
	retentionDue time.Time
	wake         chan struct{}
}

func (m *manager) queueSnapshotHydration(p *clusterPlane) {
	sp := m.currentPersistence()
	if sp == nil || !p.currentPolicy().Persistence.Enabled {
		return
	}
	if _, ok := sp.(snapshotKeyPager); !ok {
		return
	}
	q := &m.snapshotHydration
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	for _, pass := range q.passes {
		if pass.plane == p && pass.source == sp && pass.epoch == q.epoch {
			return
		}
	}
	p.persistHydrating.Store(true)
	p.persistHydrationPartial.Store(false)
	q.passes = append(q.passes, &snapshotHydrationPass{plane: p, source: sp, epoch: q.epoch})
	m.startSnapshotHydrationLocked()
}

const persistenceRetentionInterval = time.Minute

// Queue state is never held during persistence I/O. Replacing the pointer
// coalesces policy changes without mutating a pass owned by the worker.
func (m *manager) queuePersistenceRetention(sp snapshotPersistence, age time.Duration) {
	q := &m.snapshotHydration
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	q.retention = nil
	q.retentionDue = time.Time{}
	if sp != nil {
		q.retention = newPersistenceRetentionPass(sp, time.Now().UTC(), age)
	}
	if sp != nil || q.running {
		m.startSnapshotHydrationLocked()
	}
}

func (m *manager) startSnapshotHydrationLocked() {
	q := &m.snapshotHydration
	if q.wake == nil {
		q.wake = make(chan struct{}, 1)
	}
	if !q.running {
		q.running = true
		go m.runSnapshotHydration()
	}
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

func (m *manager) closeSnapshotHydration() {
	q := &m.snapshotHydration
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closed = true
	for _, pass := range q.passes {
		pass.plane.persistHydrating.Store(false)
		pass.plane.persistHydrationPartial.Store(true)
	}
	q.passes = nil
	q.retention = nil
	if q.wake != nil {
		select {
		case q.wake <- struct{}{}:
		default:
		}
	}
}

// Failed keys/pages get at most three attempts. Exhaustion and budget skips
// leave partial coverage while other keys and contexts continue progressing.
func (m *manager) runSnapshotHydration() {
	q := &m.snapshotHydration
	timer := time.NewTimer(10 * time.Millisecond)
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
		case <-q.wake:
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(10 * time.Millisecond)
		q.mu.Lock()
		if q.closed || (len(q.passes) == 0 && q.retention == nil) {
			q.running = false
			q.mu.Unlock()
			return
		}
		if m.hydrationDemand.Load() != 0 {
			q.mu.Unlock()
			continue
		}
		retention := q.retention
		if retention != nil && !time.Now().Before(q.retentionDue) {
			// Completed passes are recreated only when their next maintenance is due.
			if !q.retentionDue.IsZero() {
				retention = newPersistenceRetentionPass(retention.source, time.Now().UTC(), retention.maxAge)
				q.retention = retention
				q.retentionDue = time.Time{}
			}
			q.mu.Unlock()
			done, err := m.stepPersistenceRetention(retention)
			q.mu.Lock()
			if q.retention == retention && (done || err != nil) {
				q.retentionDue = time.Now().Add(persistenceRetentionInterval)
			}
			if q.closed {
				q.running = false
				q.mu.Unlock()
				return
			}
		}
		if len(q.passes) == 0 {
			if !q.retentionDue.IsZero() {
				timer.Reset(time.Until(q.retentionDue))
			}
			q.mu.Unlock()
			continue
		}
		pass := q.passes[0]
		retired := pass.epoch != q.epoch
		q.mu.Unlock()
		done := retired || pass.source != m.currentPersistence() || !pass.plane.currentPolicy().Persistence.Enabled
		if !done {
			done = m.snapshotHydrationTurn(pass)
		}
		q.mu.Lock()
		if q.closed {
			q.running = false
			q.mu.Unlock()
			return
		}
		q.passes = q.passes[1:]
		if !done {
			q.passes = append(q.passes, pass)
		}
		pending := false
		for _, next := range q.passes {
			if next.plane == pass.plane {
				pending = true
				break
			}
		}
		if pass.epoch == q.epoch && pass.partial {
			pass.plane.persistHydrationPartial.Store(true)
		}
		pass.plane.persistHydrating.Store(pending)
		q.mu.Unlock()
	}
}

func (m *manager) snapshotHydrationTurn(pass *snapshotHydrationPass) (done bool) {
	// A broken adapter must not kill the worker or strand pending coverage.
	defer func() {
		if recover() != nil {
			pass.partial = true
			done = true
		}
	}()
	cells, after, err := pass.source.(snapshotKeyPager).SnapshotKeysPage(pass.plane.name, pass.after, 1)
	if err != nil {
		pass.attempts++
		if pass.attempts >= 3 {
			pass.partial = true
			return true
		}
		return false
	}
	for _, cell := range cells {
		if m.hydrationDemand.Load() != 0 {
			return false
		}
		err := pass.plane.restoreSnapshotCell(context.Background(), cell.Kind, cell.Namespace, false)
		if err != nil {
			pass.attempts++
			if !errors.Is(err, errSnapshotHydrationBudget) && pass.attempts < 3 {
				return false
			}
			pass.partial = true
		}
	}
	pass.attempts = 0
	pass.after = after
	return after == nil
}

const snapshotHydrationByteBudget = 4 << 20

var errSnapshotHydrationBudget = errors.New("snapshot exceeds background hydration byte budget")

type boundedSnapshotLoader interface {
	LoadBounded(string, ResourceKind, string, any, int) (bool, error)
}

// Carry actual persistence identity and admission epoch through generic helpers.
type hydrationPersistence struct {
	snapshotPersistence
	epoch    uint64
	maxBytes int
}

func (s *hydrationPersistence) Load(cluster string, kind ResourceKind, namespace string, into any) (bool, error) {
	if s.maxBytes == 0 {
		return s.snapshotPersistence.Load(cluster, kind, namespace, into)
	}
	if bounded, ok := s.snapshotPersistence.(boundedSnapshotLoader); ok {
		return bounded.LoadBounded(cluster, kind, namespace, into, s.maxBytes)
	}
	return false, errSnapshotHydrationBudget
}

// Foreground waits only for this exact key. Errors are shared with existing
// waiters but not memoized as absence; the next request can retry. A successful
// miss is memoized per persistence instance, not across disable/enable.
func (p *clusterPlane) restoreSnapshotCell(ctx context.Context, kind ResourceKind, namespace string, foreground bool) error {
	return p.restoreSnapshotCellWith(ctx, kind, namespace, foreground, func(sp snapshotPersistence) error { return p.loadSnapshotCell(sp, kind, namespace) })
}

func (p *clusterPlane) restoreSnapshotCellWith(ctx context.Context, kind ResourceKind, namespace string, foreground bool, load func(snapshotPersistence) error) error {
	if foreground && p.hydrationManager != nil {
		p.hydrationManager.hydrationDemand.Add(1)
		defer p.hydrationManager.hydrationDemand.Add(-1)
	}
	sp := p.currentPersistence()
	if sp == nil || !p.currentPolicy().Persistence.Enabled {
		return nil
	}
	epoch := uint64(0)
	if m := p.hydrationManager; m != nil {
		m.snapshotHydration.mu.Lock()
		epoch = m.snapshotHydration.epoch
		closed := m.snapshotHydration.closed
		m.snapshotHydration.mu.Unlock()
		if closed {
			return context.Canceled
		}
	}
	key := workKey{Kind: kind, Namespace: namespace}
	p.hydrationMu.Lock()
	if p.hydrationCells == nil {
		p.hydrationCells = make(map[workKey]*snapshotHydrationCell)
	}
	if cell := p.hydrationCells[key]; cell != nil && cell.source == sp && cell.epoch == epoch {
		p.hydrationMu.Unlock()
		select {
		case <-cell.ready:
			if foreground && errors.Is(cell.err, errSnapshotHydrationBudget) {
				return p.restoreSnapshotCellWith(ctx, kind, namespace, foreground, load)
			}
			return cell.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	cell := &snapshotHydrationCell{source: sp, epoch: epoch, ready: make(chan struct{})}
	p.hydrationCells[key] = cell
	p.hydrationMu.Unlock()
	completed := false
	defer func() {
		p.hydrationMu.Lock()
		if !completed {
			cell.err = errors.New("snapshot hydration interrupted")
		}
		if (!completed || cell.err != nil) && p.hydrationCells[key] == cell {
			delete(p.hydrationCells, key)
		}
		close(cell.ready)
		p.hydrationMu.Unlock()
	}()
	wrapped := &hydrationPersistence{snapshotPersistence: sp, epoch: epoch}
	if !foreground {
		wrapped.maxBytes = snapshotHydrationByteBudget
	}
	cell.err = load(wrapped)
	completed = true
	return cell.err
}

// Serialize publication, not I/O, against retiring a persistence instance and
// shutdown. Store locks inside publish preserve the ordinary revision boundary.
func (p *clusterPlane) publishRestoredSnapshot(sp snapshotPersistence, publish func()) {
	epoch := uint64(0)
	if wrapped, ok := sp.(*hydrationPersistence); ok {
		epoch = wrapped.epoch
		sp = wrapped.snapshotPersistence
	}
	if m := p.hydrationManager; m != nil {
		m.persistenceMu.RLock()
		defer m.persistenceMu.RUnlock()
		if m.persistence != sp {
			return
		}
		m.snapshotHydration.mu.Lock()
		defer m.snapshotHydration.mu.Unlock()
		if m.snapshotHydration.closed || m.snapshotHydration.epoch != epoch {
			return
		}
	} else if p.currentPersistence() != sp {
		return
	}
	if !p.currentPolicy().Persistence.Enabled {
		return
	}
	publish()
}

func restoreClusterCell[I any](p *clusterPlane, sp snapshotPersistence, kind ResourceKind, store *snapshotStore[Snapshot[I]]) error {
	store.mu.RLock()
	untouched := store.rev == 0 && store.snap.Meta.ObservedAt.IsZero()
	store.mu.RUnlock()
	if !untouched {
		return nil
	}
	var snap Snapshot[I]
	ok, err := sp.Load(p.name, kind, "", &snap)
	if err != nil || !ok {
		return err
	}
	if !markPersistedSnapshot(&snap, p.currentPolicy().PersistenceMaxAge()) {
		return nil
	}
	snap.restored = true
	p.publishRestoredSnapshot(sp, func() {
		store.mu.Lock()
		defer store.mu.Unlock()
		if store.rev != 0 || !store.snap.Meta.ObservedAt.IsZero() {
			return
		}
		store.rev++
		snap.Meta.Revision = store.rev
		store.snap = snap
		store.telemetry.recordCacheWrite("", snap)
		if p.stats != nil {
			p.stats.recordHydration(kind, estimateSnapshotPayloadBytes(snap))
		}
	})
	return nil
}

func restoreNamespacedCell[I any](p *clusterPlane, sp snapshotPersistence, kind ResourceKind, namespace string, store *namespacedSnapshotStore[Snapshot[I]]) error {
	store.mu.RLock()
	untouched := store.nsRev[namespace] == 0 && store.snaps[namespace].Meta.ObservedAt.IsZero()
	store.mu.RUnlock()
	if !untouched {
		return nil
	}
	var snap Snapshot[I]
	ok, err := sp.Load(p.name, kind, namespace, &snap)
	if err != nil || !ok {
		return err
	}
	if !markPersistedSnapshot(&snap, p.currentPolicy().PersistenceMaxAge()) {
		return nil
	}
	snap.restored = true
	p.publishRestoredSnapshot(sp, func() {
		store.mu.Lock()
		defer store.mu.Unlock()
		if store.nsRev[namespace] != 0 || !store.snaps[namespace].Meta.ObservedAt.IsZero() {
			return
		}
		if store.snaps == nil {
			store.snaps = make(map[string]Snapshot[I])
		}
		if store.nsRev == nil {
			store.nsRev = make(map[string]uint64)
		}
		store.nsRev[namespace]++
		snap.Meta.Revision = store.nsRev[namespace]
		store.snaps[namespace] = snap
		store.telemetry.recordCacheWrite(namespace, snap)
		if p.stats != nil {
			p.stats.recordHydration(kind, estimateSnapshotPayloadBytes(snap))
		}
	})
	return nil
}

func (p *clusterPlane) loadSnapshotCell(sp snapshotPersistence, kind ResourceKind, namespace string) error {
	switch kind {
	case ResourceKindNamespaces:
		return restoreClusterCell(p, sp, kind, &p.nsStore)
	case ResourceKindNodes:
		return restoreClusterCell(p, sp, kind, &p.nodesStore)
	case ResourceKindPersistentVolumes:
		return restoreClusterCell(p, sp, kind, &p.persistentVolumesStore)
	case ResourceKindClusterRoles:
		return restoreClusterCell(p, sp, kind, &p.clusterRolesStore)
	case ResourceKindClusterRoleBindings:
		return restoreClusterCell(p, sp, kind, &p.clusterRoleBindingsStore)
	case ResourceKindCRDs:
		return restoreClusterCell(p, sp, kind, &p.crdsStore)
	case ResourceKindClusterCustomResources:
		return restoreClusterCell(p, sp, kind, &p.clusterCustomResourcesStore)

	case ResourceKindPods:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.podsStore)
	case ResourceKindDeployments:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.depsStore)
	case ResourceKindServices:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.svcsStore)
	case ResourceKindIngresses:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.ingStore)
	case ResourceKindNetworkPolicies:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.networkPoliciesStore)
	case ResourceKindPVCs:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.pvcsStore)
	case ResourceKindConfigMaps:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.cmsStore)
	case ResourceKindSecrets:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.secsStore)
	case ResourceKindServiceAccounts:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.saStore)
	case ResourceKindRoles:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.rolesStore)
	case ResourceKindRoleBindings:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.roleBindingsStore)
	case ResourceKindHelmReleases:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.helmReleasesStore)
	case ResourceKindDaemonSets:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.dsStore)
	case ResourceKindStatefulSets:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.stsStore)
	case ResourceKindReplicaSets:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.rsStore)
	case ResourceKindJobs:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.jobsStore)
	case ResourceKindCronJobs:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.cjStore)
	case ResourceKindHPAs:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.hpaStore)
	case ResourceKindResourceQuotas:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.rqStore)
	case ResourceKindLimitRanges:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.lrStore)
	case ResourceKindCustomResources:
		return restoreNamespacedCell(p, sp, kind, namespace, &p.customResourcesStore)
	}
	return nil
}
