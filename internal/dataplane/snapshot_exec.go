package dataplane

import (
	"context"
	"time"

	"github.com/alex-mamchenkov/kview/internal/cluster"
)

type clusterSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients) ([]I, error)
}

type namespacedSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients, string) ([]I, error)
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
	if cached, ok := store.getFresh(desc.ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil {
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
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
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

	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setClusterSnapshot(store, fallback)
		return fallback, runErr
	}
	setClusterSnapshot(store, out)
	if runErr == nil && out.Err == nil {
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
	if cached, ok := store.getFresh(namespace, desc.ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil {
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
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
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

	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setNamespacedSnapshot(store, namespace, fallback)
		return fallback, runErr
	}
	setNamespacedSnapshot(store, namespace, out)
	if runErr == nil && out.Err == nil {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, desc.kind, namespace, out)
		}
	}
	return out, runErr
}
