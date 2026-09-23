package dataplane

import "context"

func (m *manager) InvalidateHelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.helmReleasesStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindHelmReleases, namespace)
	}
	return nil
}

func (m *manager) InvalidateClusterCustomResourcesSnapshot(ctx context.Context, clusterName string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearClusterSnapshot(&plane.clusterCustomResourcesStore)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindClusterCustomResources, "")
	}
	return nil
}

func (m *manager) InvalidateCustomResourcesSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.customResourcesStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindCustomResources, namespace)
	}
	return nil
}

func (m *manager) InvalidateDeploymentsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindDeployments)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindDeployments)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.depsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindDeployments, namespace)
	}
	return nil
}

func (m *manager) InvalidateConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.cmsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindConfigMaps, namespace)
	}
	return nil
}

func (m *manager) InvalidateServicesSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.svcsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindServices, namespace)
	}
	return nil
}

func (m *manager) InvalidateSecretsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.secsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindSecrets, namespace)
	}
	return nil
}

func (m *manager) InvalidateIngressesSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.ingStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindIngresses, namespace)
	}
	return nil
}

func (m *manager) InvalidateStatefulSetsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindStatefulSets)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindStatefulSets)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.stsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindStatefulSets, namespace)
	}
	return nil
}

func (m *manager) InvalidateDaemonSetsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindDaemonSets)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindDaemonSets)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.dsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindDaemonSets, namespace)
	}
	return nil
}

func (m *manager) InvalidateJobsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindJobs)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindJobs)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.jobsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindJobs, namespace)
	}
	return nil
}

func (m *manager) InvalidateReplicaSetsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindReplicaSets)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindReplicaSets)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.rsStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindReplicaSets, namespace)
	}
	return nil
}

func (m *manager) InvalidateCronJobsSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	mu, epochs, cells := plane.resourceOwnership(ResourceKindCronJobs)
	mu.Lock()
	defer mu.Unlock()
	if live := (*cells)[namespace]; live != nil {
		plane.invalidateResourceLiveLocked(namespace, live, ResourceKindCronJobs)
		return nil
	}
	if *epochs == nil {
		*epochs = make(map[string]uint64)
	}
	(*epochs)[namespace]++
	clearNamespacedSnapshot(&plane.cjStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindCronJobs, namespace)
	}
	return nil
}
