package dataplane

import "maps"

// captureCanonicalPlane copies immutable published envelopes one store at a time.
// Each store snapshot is stable, but this is NOT an atomic cross-store capture:
// concurrent publications may be represented by different generations. Policy and
// suppression state are copied independently after store locks are released.
// Detection and both projection consumers use these same captured envelopes.
// Never nest store locks or hold them across manager/suppression access or IO.
func captureCanonicalPlane(p *clusterPlane) *clusterPlane {
	out := &clusterPlane{name: p.name}
	p.nsStore.mu.RLock()
	out.nsStore.snap = p.nsStore.snap
	p.nsStore.mu.RUnlock()
	out.nodesStore.snap, _ = peekClusterSnapshot(&p.nodesStore)
	out.persistentVolumesStore.snap, _ = peekClusterSnapshot(&p.persistentVolumesStore)
	out.clusterRolesStore.snap, _ = peekClusterSnapshot(&p.clusterRolesStore)
	out.clusterRoleBindingsStore.snap, _ = peekClusterSnapshot(&p.clusterRoleBindingsStore)
	out.crdsStore.snap, _ = peekClusterSnapshot(&p.crdsStore)
	out.clusterCustomResourcesStore.snap, _ = peekClusterSnapshot(&p.clusterCustomResourcesStore)
	out.nodeMetricsStore.snap, _ = peekClusterSnapshot(&p.nodeMetricsStore)
	// Preserve cell presence even for a never-usable publication. Population
	// readers still use getCached/peek, which require an observation timestamp.
	p.podsStore.mu.RLock()
	out.podsStore.snaps = maps.Clone(p.podsStore.snaps)
	p.podsStore.mu.RUnlock()
	out.depsStore.snaps = peekAllNamespacedSnapshots(&p.depsStore)
	out.svcsStore.snaps = peekAllNamespacedSnapshots(&p.svcsStore)
	out.ingStore.snaps = peekAllNamespacedSnapshots(&p.ingStore)
	out.networkPoliciesStore.snaps = peekAllNamespacedSnapshots(&p.networkPoliciesStore)
	out.pvcsStore.snaps = peekAllNamespacedSnapshots(&p.pvcsStore)
	out.cmsStore.snaps = peekAllNamespacedSnapshots(&p.cmsStore)
	out.secsStore.snaps = peekAllNamespacedSnapshots(&p.secsStore)
	out.saStore.snaps = peekAllNamespacedSnapshots(&p.saStore)
	out.rolesStore.snaps = peekAllNamespacedSnapshots(&p.rolesStore)
	out.roleBindingsStore.snaps = peekAllNamespacedSnapshots(&p.roleBindingsStore)
	out.helmReleasesStore.snaps = peekAllNamespacedSnapshots(&p.helmReleasesStore)
	out.dsStore.snaps = peekAllNamespacedSnapshots(&p.dsStore)
	out.stsStore.snaps = peekAllNamespacedSnapshots(&p.stsStore)
	out.rsStore.snaps = peekAllNamespacedSnapshots(&p.rsStore)
	out.jobsStore.snaps = peekAllNamespacedSnapshots(&p.jobsStore)
	out.cjStore.snaps = peekAllNamespacedSnapshots(&p.cjStore)
	out.hpaStore.snaps = peekAllNamespacedSnapshots(&p.hpaStore)
	out.rqStore.snaps = peekAllNamespacedSnapshots(&p.rqStore)
	out.lrStore.snaps = peekAllNamespacedSnapshots(&p.lrStore)
	out.customResourcesStore.snaps = peekAllNamespacedSnapshots(&p.customResourcesStore)
	out.podMetricsStore.snaps = peekAllNamespacedSnapshots(&p.podMetricsStore)
	out.persistHydrating.Store(p.persistHydrating.Load())
	out.persistHydrationPartial.Store(p.persistHydrationPartial.Load())
	return out
}
