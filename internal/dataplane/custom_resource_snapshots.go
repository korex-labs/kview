package dataplane

import (
	"context"
	"fmt"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	crs "github.com/korex-labs/kview/v5/internal/kube/resource/customresources"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

func dynamicClientWithoutWarnings(cfg *rest.Config) (dynamic.Interface, error) {
	copy := rest.CopyConfig(cfg)
	copy.WarningHandler = rest.NoWarnings{}
	copy.WarningHandlerWithContext = rest.NoWarnings{}
	return dynamic.NewForConfig(copy)
}

func (p *clusterPlane) customResourceSnapshotMeta(now time.Time, agg dto.CustomResourceAggregationMeta) SnapshotMetadata {
	meta := p.snapshotMetaHot(now)
	if agg.DeniedKinds > 0 || agg.ErrorKinds > 0 {
		meta.Coverage = CoverageClassPartial
		meta.Completeness = CompletenessClassInexact
		meta.Degradation = DegradationClassMinor
	}
	if agg.TotalKinds > 0 && agg.AccessibleKinds == 0 && agg.ErrorKinds > 0 {
		meta.Coverage = CoverageClassUnknown
		meta.Completeness = CompletenessClassUnknown
		meta.Degradation = DegradationClassSevere
	}
	return meta
}

func (p *clusterPlane) ClusterCustomResourcesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (CustomResourcesSnapshot, error) {
	kind := ResourceKindClusterCustomResources
	source := workSourceOrAPI(ctx)
	ttl := p.currentPolicy().SnapshotTTL(kind)
	if cached, ok := p.clusterCustomResourcesStore.getFresh(ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, kind, false)
	}

	var persisted CustomResourcesSnapshot
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil {
		var loaded CustomResourcesSnapshot
		if ok, err := sp.Load(p.name, kind, "", &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	crdSnap, crdErr := p.CRDsSnapshot(ctx, sched, clients, prio)
	if crdErr != nil && len(crdSnap.Items) == 0 {
		out := CustomResourcesSnapshot{Meta: p.snapshotMetaCold(time.Now().UTC())}
		n := NormalizeError(crdErr)
		out.Err = &n
		if havePersisted {
			fallback := persistedSnapshotFallback(persisted, out)
			setClusterSnapshot(&p.clusterCustomResourcesStore, fallback)
			return fallback, crdErr
		}
		setClusterSnapshot(&p.clusterCustomResourcesStore, out)
		return out, crdErr
	}

	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: kind}
	var out CustomResourcesSnapshot
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		if c == nil || c.RestConfig == nil {
			err := fmt.Errorf("nil rest config")
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		dynClient, err := dynamicClientWithoutWarnings(c.RestConfig)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}

		items, agg, err := crs.ListAllClusterCRs(runCtx, dynClient, crdSnap.Items)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaCold(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		if items == nil {
			items = []dto.CustomResourceInstanceDTO{}
		}
		out.Items = items
		out.Aggregation = &agg
		out.Meta = p.customResourceSnapshotMeta(now, agg)
		if p.stats != nil {
			p.stats.recordFetchResult(source, kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setClusterSnapshot(&p.clusterCustomResourcesStore, fallback)
		return fallback, runErr
	}
	setClusterSnapshot(&p.clusterCustomResourcesStore, out)
	if runErr == nil && out.Err == nil {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, kind, "", out)
		}
	}
	return out, runErr
}

func (p *clusterPlane) CustomResourcesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (CustomResourcesSnapshot, error) {
	kind := ResourceKindCustomResources
	source := workSourceOrAPI(ctx)
	ttl := p.currentPolicy().SnapshotTTL(kind)
	if cached, ok := p.customResourcesStore.getFresh(namespace, ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, kind, false)
	}

	var persisted CustomResourcesSnapshot
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil {
		var loaded CustomResourcesSnapshot
		if ok, err := sp.Load(p.name, kind, namespace, &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	crdSnap, crdErr := p.CRDsSnapshot(ctx, sched, clients, prio)
	if crdErr != nil && len(crdSnap.Items) == 0 {
		out := CustomResourcesSnapshot{Meta: p.snapshotMetaCold(time.Now().UTC())}
		n := NormalizeError(crdErr)
		out.Err = &n
		if havePersisted {
			fallback := persistedSnapshotFallback(persisted, out)
			setNamespacedSnapshot(&p.customResourcesStore, namespace, fallback)
			return fallback, crdErr
		}
		setNamespacedSnapshot(&p.customResourcesStore, namespace, out)
		return out, crdErr
	}

	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: kind, Namespace: namespace}
	var out CustomResourcesSnapshot
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		if c == nil || c.RestConfig == nil {
			err := fmt.Errorf("nil rest config")
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		dynClient, err := dynamicClientWithoutWarnings(c.RestConfig)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}

		items, agg, err := crs.ListAllNamespacedCRs(runCtx, dynClient, crdSnap.Items, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaCold(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, kind, 0, err)
			}
			return err
		}
		if items == nil {
			items = []dto.CustomResourceInstanceDTO{}
		}
		out.Items = items
		out.Aggregation = &agg
		out.Meta = p.customResourceSnapshotMeta(now, agg)
		if p.stats != nil {
			p.stats.recordFetchResult(source, kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setNamespacedSnapshot(&p.customResourcesStore, namespace, fallback)
		return fallback, runErr
	}
	setNamespacedSnapshot(&p.customResourcesStore, namespace, out)
	if runErr == nil && out.Err == nil {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, kind, namespace, out)
		}
	}
	return out, runErr
}
