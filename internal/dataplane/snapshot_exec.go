package dataplane

import (
	"context"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

type clusterSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients) ([]I, error)
	// skipPersistence opts out of bbolt save/hydrate for snapshot kinds that
	// are high-churn and short-TTL (e.g. metrics.k8s.io). Leaving this false
	// preserves the default persistence path for every existing kind.
	skipPersistence bool
}

type namespacedSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients, string) ([]I, error)
	// skipPersistence opts out of bbolt save/hydrate; see the cluster
	// descriptor for rationale.
	skipPersistence bool
}

func (p *clusterPlane) snapshotMetaUnknown(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassUnknown,
		Coverage:     CoverageClassUnknown,
		Degradation:  DegradationClassSevere,
		Completeness: CompletenessClassUnknown,
	}
}

func (p *clusterPlane) snapshotMetaCold(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassCold,
		Coverage:     CoverageClassUnknown,
		Degradation:  DegradationClassMinor,
		Completeness: CompletenessClassUnknown,
	}
}

func (p *clusterPlane) snapshotMetaHot(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassHot,
		Coverage:     CoverageClassFull,
		Degradation:  DegradationClassNone,
		Completeness: CompletenessClassComplete,
	}
}

func executeClusterSnapshot[I any](
	p *clusterPlane,
	ctx context.Context,
	sched *workScheduler,
	prio WorkPriority,
	clients ClientsProvider,
	store *snapshotStore[Snapshot[I]],
	desc clusterSnapshotDescriptor[I],
) (Snapshot[I], error) {
	source := workSourceOrAPI(ctx)
	ttl := desc.ttl
	if sched != nil {
		ttl = effectiveSnapshotTTL(desc.ttl, source, prio, desc.kind, sched.HealthSnapshot(p.name), sched.ClusterPressureSnapshot(p.name))
	}
	if cached, ok := store.getFresh(ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var staleCached Snapshot[I]
	var haveStaleCached bool
	if desc.skipPersistence {
		staleCached, haveStaleCached = peekClusterSnapshot(store)
	}
	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil && !desc.skipPersistence {
		var loaded Snapshot[I]
		if ok, err := sp.Load(p.name, desc.kind, "", &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      desc.kind,
		Namespace: "",
	}

	var out Snapshot[I]
	executed := false
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		executed = true
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, desc.kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Err = nil
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		items, err := desc.fetch(runCtx, c)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Items = nil
			out.Meta = p.snapshotMetaCold(now)
			p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, "", "list", desc.capScope, err)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		out.Err = nil
		out.Items = items
		out.Meta = p.snapshotMetaHot(now)
		p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, "", "list", desc.capScope, nil)
		if p.stats != nil {
			p.stats.recordFetchResult(source, desc.kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	// A joined caller waits for the scheduler owner but does not execute this
	// call's closure, so its local out value is empty. Never let that follower
	// overwrite an existing snapshot with the zero value.
	if !executed {
		if joined, ok := peekClusterSnapshot(store); ok {
			return joined, runErr
		}
		return out, runErr
	}
	if runErr != nil && len(out.Items) == 0 && haveStaleCached {
		fallback := staleCachedSnapshotFallback(staleCached, out)
		setClusterSnapshot(store, fallback)
		return fallback, runErr
	}
	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setClusterSnapshot(store, fallback)
		return fallback, runErr
	}
	setClusterSnapshot(store, out)
	if runErr == nil && out.Err == nil && !desc.skipPersistence {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, desc.kind, "", out)
		}
	}
	return out, runErr
}

func executeNamespacedSnapshot[I any](
	p *clusterPlane,
	ctx context.Context,
	sched *workScheduler,
	prio WorkPriority,
	clients ClientsProvider,
	namespace string,
	store *namespacedSnapshotStore[Snapshot[I]],
	desc namespacedSnapshotDescriptor[I],
) (Snapshot[I], error) {
	source := workSourceOrAPI(ctx)
	ttl := desc.ttl
	if sched != nil {
		ttl = effectiveSnapshotTTL(desc.ttl, source, prio, desc.kind, sched.HealthSnapshot(p.name), sched.ClusterPressureSnapshot(p.name))
	}
	if cached, ok := store.getFresh(namespace, ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var staleCached Snapshot[I]
	var haveStaleCached bool
	if desc.skipPersistence {
		staleCached, haveStaleCached = peekNamespacedSnapshot(store, namespace)
	}
	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil && !desc.skipPersistence {
		var loaded Snapshot[I]
		if ok, err := sp.Load(p.name, desc.kind, namespace, &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      desc.kind,
		Namespace: namespace,
	}

	var out Snapshot[I]
	executed := false
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		executed = true
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, desc.kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Err = nil
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		items, err := desc.fetch(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Items = nil
			out.Meta = p.snapshotMetaCold(now)
			p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, namespace, "list", desc.capScope, err)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		out.Err = nil
		out.Items = items
		out.Meta = p.snapshotMetaHot(now)
		p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, namespace, "list", desc.capScope, nil)
		if p.stats != nil {
			p.stats.recordFetchResult(source, desc.kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	// A joined caller waits for the scheduler owner but does not execute this
	// call's closure, so its local out value is empty. Preserve the latest
	// namespace snapshot instead of replacing it with an empty cache cell.
	if !executed {
		if joined, ok := peekNamespacedSnapshot(store, namespace); ok {
			return joined, runErr
		}
		return out, runErr
	}
	if runErr != nil && len(out.Items) == 0 && haveStaleCached {
		fallback := staleCachedSnapshotFallback(staleCached, out)
		setNamespacedSnapshot(store, namespace, fallback)
		return fallback, runErr
	}
	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setNamespacedSnapshot(store, namespace, fallback)
		return fallback, runErr
	}
	setNamespacedSnapshot(store, namespace, out)
	if runErr == nil && out.Err == nil && !desc.skipPersistence {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, desc.kind, namespace, out)
		}
	}
	return out, runErr
}
