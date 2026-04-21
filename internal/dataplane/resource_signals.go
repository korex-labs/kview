package dataplane

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

// ResourceSignalsScope identifies whether the resource lives at namespace or
// cluster scope. Both values must come from the caller (e.g. URL prefix) and
// are validated by ResourceSignals.
const (
	ResourceSignalsScopeNamespace = "namespace"
	ResourceSignalsScopeCluster   = "cluster"
)

// ResourceSignalsResult is the cache-only response for the per-resource
// signals endpoint. An empty Signals slice indicates no attention-worthy
// state was detected; callers should not treat this as an error.
type ResourceSignalsResult struct {
	Signals []dto.NamespaceInsightSignalDTO
	Meta    SnapshotMetadata
}

// resourceSignalsNamespaceRouteToKind maps URL plural-route segments
// (e.g. "pods", "horizontalpodautoscalers") to the canonical Kubernetes
// kind that the dashboard signal store uses ("Pod",
// "HorizontalPodAutoscaler"). Only routes for which we currently emit
// signals need entries here. Adding a new namespace-scoped kind requires
// updating this map plus the corresponding detector.
var resourceSignalsNamespaceRouteToKind = map[string]string{
	"pods":                     "Pod",
	"deployments":              "Deployment",
	"daemonsets":               "DaemonSet",
	"statefulsets":             "StatefulSet",
	"replicasets":              "ReplicaSet",
	"jobs":                     "Job",
	"cronjobs":                 "CronJob",
	"horizontalpodautoscalers": "HorizontalPodAutoscaler",
	"services":                 "Service",
	"ingresses":                "Ingress",
	"persistentvolumeclaims":   "PersistentVolumeClaim",
	"configmaps":               "ConfigMap",
	"secrets":                  "Secret",
	"serviceaccounts":          "ServiceAccount",
	"roles":                    "Role",
	"rolebindings":             "RoleBinding",
	"helmreleases":             "HelmRelease",
	"resourcequotas":           "ResourceQuota",
}

// resourceSignalsClusterRouteToKind maps URL plural segments for
// cluster-scoped resources to their canonical kind. Adding a new
// cluster-scoped kind requires updating this map plus a snapshot lookup in
// ResourceSignals.
var resourceSignalsClusterRouteToKind = map[string]string{
	"namespaces":                "Namespace",
	"nodes":                     "Node",
	"persistentvolumes":         "PersistentVolume",
	"clusterroles":              "ClusterRole",
	"clusterrolebindings":       "ClusterRoleBinding",
	"customresourcedefinitions": "CustomResourceDefinition",
}

// ResourceSignalKindFromRoute resolves a URL plural segment to the canonical
// kind used by the dataplane signal store. The boolean reports whether the
// route is a recognised signal-bearing kind for the given scope. Callers
// should reject unknown kinds with 404 to keep the API surface predictable.
func ResourceSignalKindFromRoute(scope, routeSegment string) (string, bool) {
	switch scope {
	case ResourceSignalsScopeNamespace:
		k, ok := resourceSignalsNamespaceRouteToKind[strings.ToLower(routeSegment)]
		return k, ok
	case ResourceSignalsScopeCluster:
		k, ok := resourceSignalsClusterRouteToKind[strings.ToLower(routeSegment)]
		return k, ok
	default:
		return "", false
	}
}

// ResourceSignals returns dataplane-derived signals attributed to a single
// resource, sourced exclusively from cached snapshots. The endpoint is safe
// to poll: it does not schedule new live Kubernetes reads and does not
// depend on metrics-server availability. Detail-level signals (computed
// from a resource's full DetailsDTO) are not produced here; those are
// embedded by the per-kind detail endpoints during drawer migration.
func (m *manager) ResourceSignals(ctx context.Context, clusterName, scope, namespace, kind, name string) (ResourceSignalsResult, error) {
	if name == "" || kind == "" {
		return ResourceSignalsResult{}, fmt.Errorf("missing kind or name")
	}
	if scope != ResourceSignalsScopeNamespace && scope != ResourceSignalsScopeCluster {
		return ResourceSignalsResult{}, fmt.Errorf("invalid scope %q", scope)
	}
	if scope == ResourceSignalsScopeNamespace && namespace == "" {
		return ResourceSignalsResult{}, fmt.Errorf("missing namespace for namespace-scoped resource")
	}

	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceProjection)
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return ResourceSignalsResult{}, err
	}
	plane, _ := planeAny.(*clusterPlane)
	if plane == nil {
		return ResourceSignalsResult{}, nil
	}

	policy := m.Policy()
	store := newDashboardSignalStore()
	now := time.Now()
	var meta SnapshotMetadata

	switch scope {
	case ResourceSignalsScopeNamespace:
		s := buildSnapshotSetForNamespace(
			plane, namespace,
			int32(policy.Dashboard.RestartElevatedThreshold),
			policy.Metrics.ContainerNearLimitPct,
		)
		store.Add(detectDashboardSignals(now, namespace, s)...)
		meta = mergeSnapshotMetaForResourceSignals(s)
	case ResourceSignalsScopeCluster:
		nodesSnap, _ := peekClusterSnapshot(&plane.nodesStore)
		store.Add(detectNodeResourcePressureSignals(now, plane, nodesSnap, policy.Metrics.NodePressurePct)...)
		meta = nodesSnap.Meta
	}

	scopeLocation := ""
	if scope == ResourceSignalsScopeNamespace {
		scopeLocation = namespace
	}
	items := store.SignalsForResource(kind, name, scope, scopeLocation)
	out := namespaceInsightSignalsFromDashboard(items)
	if out == nil {
		out = []dto.NamespaceInsightSignalDTO{}
	}
	return ResourceSignalsResult{Signals: out, Meta: meta}, nil
}

// mergeSnapshotMetaForResourceSignals reports the worst-freshness /
// worst-degradation across the cached namespace snapshots that fed signal
// detection. Returns a zero SnapshotMetadata when no snapshot is cached
// (the caller can render this as "no data yet").
func mergeSnapshotMetaForResourceSignals(s dashboardSnapshotSet) SnapshotMetadata {
	metas := make([]SnapshotMetadata, 0, 20)
	if s.podsOK {
		metas = append(metas, s.pods.Meta)
	}
	if s.depsOK {
		metas = append(metas, s.deps.Meta)
	}
	if s.dsOK {
		metas = append(metas, s.ds.Meta)
	}
	if s.stsOK {
		metas = append(metas, s.sts.Meta)
	}
	if s.rsOK {
		metas = append(metas, s.rs.Meta)
	}
	if s.jobsOK {
		metas = append(metas, s.jobs.Meta)
	}
	if s.cjsOK {
		metas = append(metas, s.cjs.Meta)
	}
	if s.hpasOK {
		metas = append(metas, s.hpas.Meta)
	}
	if s.svcsOK {
		metas = append(metas, s.svcs.Meta)
	}
	if s.ingsOK {
		metas = append(metas, s.ings.Meta)
	}
	if s.pvcsOK {
		metas = append(metas, s.pvcs.Meta)
	}
	if s.cmsOK {
		metas = append(metas, s.cms.Meta)
	}
	if s.secsOK {
		metas = append(metas, s.secs.Meta)
	}
	if s.sasOK {
		metas = append(metas, s.sas.Meta)
	}
	if s.rolesOK {
		metas = append(metas, s.roles.Meta)
	}
	if s.roleBindingsOK {
		metas = append(metas, s.roleBindings.Meta)
	}
	if s.helmOK {
		metas = append(metas, s.helmReleases.Meta)
	}
	if s.quotasOK {
		metas = append(metas, s.resourceQuotas.Meta)
	}
	if len(metas) == 0 {
		return SnapshotMetadata{}
	}
	return SnapshotMetadata{
		Freshness:   WorstFreshnessFromSnapshots(metas...),
		Degradation: WorstDegradationFromSnapshots(metas...),
	}
}
