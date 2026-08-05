package dataplane

import "context"

func (m *manager) NamespacesSnapshot(ctx context.Context, clusterName string) (NamespaceSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NamespacesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NodesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) PersistentVolumesSnapshot(ctx context.Context, clusterName string) (PersistentVolumesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PersistentVolumesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) ClusterRolesSnapshot(ctx context.Context, clusterName string) (ClusterRolesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ClusterRolesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) ClusterRoleBindingsSnapshot(ctx context.Context, clusterName string) (ClusterRoleBindingsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ClusterRoleBindingsSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) CRDsSnapshot(ctx context.Context, clusterName string) (CRDsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.CRDsSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) ClusterCustomResourcesSnapshot(ctx context.Context, clusterName string) (CustomResourcesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ClusterCustomResourcesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) PodsSnapshot(ctx context.Context, clusterName, namespace string) (PodsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) CustomResourcesSnapshot(ctx context.Context, clusterName, namespace string) (CustomResourcesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.CustomResourcesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) DeploymentsSnapshot(ctx context.Context, clusterName, namespace string) (DeploymentsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ServicesSnapshot(ctx context.Context, clusterName, namespace string) (ServicesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) IngressesSnapshot(ctx context.Context, clusterName, namespace string) (IngressesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) NetworkPoliciesSnapshot(ctx context.Context, clusterName, namespace string) (NetworkPoliciesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NetworkPoliciesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) PVCsSnapshot(ctx context.Context, clusterName, namespace string) (PVCsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) (ConfigMapsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) SecretsSnapshot(ctx context.Context, clusterName, namespace string) (SecretsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ServiceAccountsSnapshot(ctx context.Context, clusterName, namespace string) (ServiceAccountsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ServiceAccountsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) RolesSnapshot(ctx context.Context, clusterName, namespace string) (RolesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.RolesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) RoleBindingsSnapshot(ctx context.Context, clusterName, namespace string) (RoleBindingsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.RoleBindingsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) HelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) (HelmReleasesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.HelmReleasesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) DaemonSetsSnapshot(ctx context.Context, clusterName, namespace string) (DaemonSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) StatefulSetsSnapshot(ctx context.Context, clusterName, namespace string) (StatefulSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ReplicaSetsSnapshot(ctx context.Context, clusterName, namespace string) (ReplicaSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) JobsSnapshot(ctx context.Context, clusterName, namespace string) (JobsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) CronJobsSnapshot(ctx context.Context, clusterName, namespace string) (CronJobsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) HPAsSnapshot(ctx context.Context, clusterName, namespace string) (HPAsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.HPAsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ResourceQuotasSnapshot(ctx context.Context, clusterName, namespace string) (ResourceQuotasSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ResourceQuotasSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) LimitRangesSnapshot(ctx context.Context, clusterName, namespace string) (LimitRangesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.LimitRangesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) NodeMetricsSnapshot(ctx context.Context, clusterName string) (NodeMetricsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NodeMetricsSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) PodMetricsSnapshot(ctx context.Context, clusterName, namespace string) (PodMetricsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PodMetricsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

// NodeMetricsCachedSnapshot returns the most recent cached node metrics snapshot without scheduling a fetch.
// Returns ok=false (and a zero snapshot) when the cache is cold or the plane does not exist yet.
// Handlers use this from enrichment paths so an unavailable/denied metrics-server can never block a list response.
func (m *manager) NodeMetricsCachedSnapshot(clusterName string) (NodeMetricsSnapshot, bool) {
	m.mu.RLock()
	plane, ok := m.planes[clusterName]
	m.mu.RUnlock()
	if !ok {
		return NodeMetricsSnapshot{}, false
	}
	return peekClusterSnapshot(&plane.nodeMetricsStore)
}

// PodMetricsCachedSnapshot returns the most recent cached pod metrics snapshot for a namespace
// without scheduling a fetch. Same semantics as NodeMetricsCachedSnapshot.
func (m *manager) PodMetricsCachedSnapshot(clusterName, namespace string) (PodMetricsSnapshot, bool) {
	m.mu.RLock()
	plane, ok := m.planes[clusterName]
	m.mu.RUnlock()
	if !ok {
		return PodMetricsSnapshot{}, false
	}
	return plane.podMetricsStore.getCached(namespace)
}
