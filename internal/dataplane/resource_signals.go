package dataplane

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
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

	policy := m.EffectivePolicy(clusterName)
	thresholds := signalThresholdsFromPolicy(policy)
	store := newDashboardSignalStore()
	now := time.Now()
	var meta SnapshotMetadata

	switch scope {
	case ResourceSignalsScopeNamespace:
		s := buildSnapshotSetForNamespace(plane, namespace, thresholds)
		store.Add(m.attachSignalHistory(clusterName, now, applySignalPolicy(detectDashboardSignals(now, namespace, s), policy, clusterName)...)...)
		meta = mergeSnapshotMetaForResourceSignals(s)
	case ResourceSignalsScopeCluster:
		nodesSnap, _ := peekClusterSnapshot(&plane.nodesStore)
		store.Add(m.attachSignalHistory(clusterName, now, applySignalPolicy(detectNodeResourcePressureSignals(now, plane, nodesSnap, thresholds.NodeResourcePressurePct), policy, clusterName)...)...)
		meta = nodesSnap.Meta
	}

	scopeLocation := ""
	if scope == ResourceSignalsScopeNamespace {
		scopeLocation = namespace
	}
	items := store.SignalsForResource(kind, name, scope, scopeLocation)
	out := namespaceInsightSignalsFromDashboard(items)
	if len(out) == 0 {
		out = append(out, applyNamespaceSignalPolicy(fallbackSignalsForResource(now, scope, namespace, kind, name, plane, thresholds.PodRestartCount), policy, clusterName)...)
	}
	out = dedupeNamespaceSignals(out)
	if out == nil {
		out = []dto.NamespaceInsightSignalDTO{}
	}
	return ResourceSignalsResult{Signals: out, Meta: meta}, nil
}

func fallbackSignalsForResource(now time.Time, scope, namespace, kind, name string, plane *clusterPlane, restartThreshold int32) []dto.NamespaceInsightSignalDTO {
	if plane == nil || kind == "" || name == "" {
		return nil
	}
	if scope == ResourceSignalsScopeNamespace {
		return fallbackNamespaceSignals(now, namespace, kind, name, plane)
	}
	if scope == ResourceSignalsScopeCluster {
		return fallbackClusterSignals(now, kind, name, plane, restartThreshold)
	}
	return nil
}

func fallbackNamespaceSignals(_ time.Time, namespace, kind, name string, plane *clusterPlane) []dto.NamespaceInsightSignalDTO {
	switch kind {
	case "Pod":
		snap, _ := peekNamespacedSnapshot(&plane.podsStore, namespace)
		for _, item := range EnrichPodListItemsForAPI(snap.Items) {
			if item.Name != name || item.ListSignalSeverity == "" || item.ListSignalSeverity == listSignalOK {
				continue
			}
			reason := "Pod needs attention."
			switch {
			case item.LastEvent != nil && item.LastEvent.Type == "Warning":
				if strings.TrimSpace(item.LastEvent.Reason) != "" {
					reason = fmt.Sprintf("Pod reports warning event: %s.", item.LastEvent.Reason)
				} else {
					reason = "Pod reports warning events."
				}
			case item.Restarts > 0:
				reason = fmt.Sprintf("Pod restart activity is elevated (%d restarts).", item.Restarts)
			case strings.EqualFold(strings.TrimSpace(item.Phase), "Pending"):
				reason = "Pod is still pending scheduling/startup."
			case strings.EqualFold(strings.TrimSpace(item.Phase), "Failed"):
				reason = "Pod is in failed phase."
			case podListNotReady(item.Ready):
				reason = fmt.Sprintf("Pod is not ready (%s).", item.Ready)
			}
			return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, item.ListSignalSeverity, listSeverityScore(item.ListSignalSeverity), reason)}
		}
	case "Deployment":
		snap, _ := peekNamespacedSnapshot(&plane.depsStore, namespace)
		for _, item := range EnrichDeploymentListItemsForAPI(snap.Items) {
			if item.Name == name && item.RolloutNeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 65, "Deployment rollout needs attention.")}
			}
		}
	case "DaemonSet":
		snap, _ := peekNamespacedSnapshot(&plane.dsStore, namespace)
		for _, item := range EnrichDaemonSetListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 62, "DaemonSet state needs attention.")}
			}
		}
	case "StatefulSet":
		snap, _ := peekNamespacedSnapshot(&plane.stsStore, namespace)
		for _, item := range EnrichStatefulSetListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 62, "StatefulSet state needs attention.")}
			}
		}
	case "ReplicaSet":
		snap, _ := peekNamespacedSnapshot(&plane.rsStore, namespace)
		for _, item := range EnrichReplicaSetListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 60, "ReplicaSet state needs attention.")}
			}
		}
	case "Job":
		snap, _ := peekNamespacedSnapshot(&plane.jobsStore, namespace)
		for _, item := range EnrichJobListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 64, "Job state needs attention.")}
			}
		}
	case "CronJob":
		snap, _ := peekNamespacedSnapshot(&plane.cjStore, namespace)
		for _, item := range EnrichCronJobListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 58, "CronJob state needs attention.")}
			}
		}
	case "HorizontalPodAutoscaler":
		snap, _ := peekNamespacedSnapshot(&plane.hpaStore, namespace)
		for _, item := range snap.Items {
			if item.Name == name && item.NeedsAttention {
				reason := "HorizontalPodAutoscaler needs attention."
				if len(item.AttentionReasons) > 0 {
					reason = strings.Join(item.AttentionReasons, "; ")
				}
				severity, score := hpaSignalSeverityAndScore(item)
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, severity, score, reason)}
			}
		}
	case "Service":
		snap, _ := peekNamespacedSnapshot(&plane.svcsStore, namespace)
		for _, item := range EnrichServiceListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 62, "Service routing needs attention.")}
			}
		}
	case "Ingress":
		snap, _ := peekNamespacedSnapshot(&plane.ingStore, namespace)
		for _, item := range EnrichIngressListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 62, "Ingress routing needs attention.")}
			}
		}
	case "PersistentVolumeClaim":
		snap, _ := peekNamespacedSnapshot(&plane.pvcsStore, namespace)
		for _, item := range EnrichPVCListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 60, "PersistentVolumeClaim needs attention.")}
			}
		}
	case "ConfigMap":
		snap, _ := peekNamespacedSnapshot(&plane.cmsStore, namespace)
		for _, item := range EnrichConfigMapListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "low", 35, "ConfigMap content needs attention.")}
			}
		}
	case "Secret":
		snap, _ := peekNamespacedSnapshot(&plane.secsStore, namespace)
		for _, item := range EnrichSecretListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "low", 35, "Secret content needs attention.")}
			}
		}
	case "ServiceAccount":
		snap, _ := peekNamespacedSnapshot(&plane.saStore, namespace)
		for _, item := range EnrichServiceAccountListItemsForAPI(snap.Items) {
			if item.Name != name || item.ListSignalSeverity == "" || item.ListSignalSeverity == listSignalOK {
				continue
			}
			reason := "ServiceAccount posture needs attention."
			if item.TokenMountPolicy == "enabled" {
				reason = "ServiceAccount token automount is enabled."
			}
			return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, item.ListSignalSeverity, listSeverityScore(item.ListSignalSeverity), reason)}
		}
	case "Role":
		snap, _ := peekNamespacedSnapshot(&plane.rolesStore, namespace)
		for _, item := range EnrichRoleListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "low", 32, "Role permission surface needs attention.")}
			}
		}
	case "RoleBinding":
		snap, _ := peekNamespacedSnapshot(&plane.roleBindingsStore, namespace)
		for _, item := range EnrichRoleBindingListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "low", 32, "RoleBinding subject surface needs attention.")}
			}
		}
	case "HelmRelease":
		snap, _ := peekNamespacedSnapshot(&plane.helmReleasesStore, namespace)
		for _, item := range EnrichHelmReleaseListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, namespace, name, "medium", 60, "HelmRelease state needs attention.")}
			}
		}
	}
	return nil
}

func fallbackClusterSignals(_ time.Time, kind, name string, plane *clusterPlane, restartThreshold int32) []dto.NamespaceInsightSignalDTO {
	switch kind {
	case "Node":
		snap, _ := peekClusterSnapshot(&plane.nodesStore)
		items := snap.Items
		if derived := derivedNodeListItemsForSignals(plane, restartThreshold); len(derived) > 0 {
			items = MergeDirectAndDerivedNodeListItems(items, derived)
		}
		for _, item := range EnrichNodeListItemsForAPI(items) {
			if item.Name != name || item.ListSignalSeverity == "" || item.ListSignalSeverity == listSignalOK {
				continue
			}
			reason := "Node state needs attention."
			switch {
			case strings.EqualFold(strings.TrimSpace(item.Status), "NotReady"):
				reason = "Node is not ready."
			case strings.EqualFold(strings.TrimSpace(item.Status), "Unknown"):
				reason = "Node readiness is unknown."
			case item.PodDensityBucket == deployBucketDegraded:
				reason = "Node pod density is high."
			case item.Derived && item.ProblematicPods > 0:
				reason = fmt.Sprintf("Node has %d problematic pod%s in cached pod snapshots.", item.ProblematicPods, pluralSuffix(item.ProblematicPods))
			}
			return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, "", name, item.ListSignalSeverity, listSeverityScore(item.ListSignalSeverity), reason)}
		}
	case "PersistentVolume":
		snap, _ := peekClusterSnapshot(&plane.persistentVolumesStore)
		for _, item := range EnrichPersistentVolumeListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, "", name, "medium", 58, "PersistentVolume state needs attention.")}
			}
		}
	case "ClusterRole":
		snap, _ := peekClusterSnapshot(&plane.clusterRolesStore)
		for _, item := range EnrichClusterRoleListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, "", name, "low", 32, "ClusterRole permission surface needs attention.")}
			}
		}
	case "ClusterRoleBinding":
		snap, _ := peekClusterSnapshot(&plane.clusterRoleBindingsStore)
		for _, item := range EnrichClusterRoleBindingListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, "", name, "low", 32, "ClusterRoleBinding subject surface needs attention.")}
			}
		}
	case "CustomResourceDefinition":
		snap, _ := peekClusterSnapshot(&plane.crdsStore)
		for _, item := range EnrichCRDListItemsForAPI(snap.Items) {
			if item.Name == name && item.NeedsAttention {
				return []dto.NamespaceInsightSignalDTO{fallbackSignal(kind, "", name, "medium", 56, "CustomResourceDefinition state needs attention.")}
			}
		}
	}
	return nil
}

func derivedNodeListItemsForSignals(plane *clusterPlane, restartThreshold int32) []dto.NodeListItemDTO {
	if plane == nil {
		return nil
	}
	if restartThreshold <= 0 {
		restartThreshold = signalRestartMinThreshold
	}
	proj := buildDerivedNodesProjection(plane, cachedPodNamespaces(plane), restartThreshold, NodesSnapshot{}, "derived")
	if len(proj.Nodes) == 0 {
		return nil
	}
	out := make([]dto.NodeListItemDTO, 0, len(proj.Nodes))
	for _, n := range proj.Nodes {
		out = append(out, dto.NodeListItemDTO{
			Name:            n.Name,
			Status:          "Derived",
			PodsCount:       n.Pods,
			HealthBucket:    n.Severity,
			NeedsAttention:  n.ProblematicPods > 0,
			Derived:         true,
			DerivedSource:   proj.Meta.Source,
			DerivedCoverage: proj.Meta.Coverage,
			DerivedNote:     proj.Meta.Note,
			NamespaceCount:  n.NamespaceCount,
			ProblematicPods: n.ProblematicPods,
			RestartCount:    n.RestartCount,
		})
	}
	return out
}

func fallbackSignal(kind, namespace, name, severity string, score int, reason string) dto.NamespaceInsightSignalDTO {
	scope := ResourceSignalsScopeCluster
	scopeLocation := ""
	if namespace != "" {
		scope = ResourceSignalsScopeNamespace
		scopeLocation = namespace
	}
	return dto.NamespaceInsightSignalDTO{
		Kind:           kind,
		Namespace:      namespace,
		Name:           name,
		Severity:       severity,
		Score:          score,
		Reason:         reason,
		SignalType:     "resource_needs_attention_fallback",
		ResourceKind:   kind,
		ResourceName:   name,
		Scope:          scope,
		ScopeLocation:  scopeLocation,
		ActualData:     reason,
		CalculatedData: reason,
	}
}

func listSeverityScore(severity string) int {
	switch strings.ToLower(strings.TrimSpace(severity)) {
	case "high":
		return 75
	case "medium":
		return 60
	case "low":
		return 40
	default:
		return 30
	}
}

func pluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func dedupeNamespaceSignals(items []dto.NamespaceInsightSignalDTO) []dto.NamespaceInsightSignalDTO {
	if len(items) <= 1 {
		return items
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]dto.NamespaceInsightSignalDTO, 0, len(items))
	for _, item := range items {
		key := strings.Join([]string{item.SignalType, item.ResourceKind, item.ResourceName, item.Scope, item.ScopeLocation, item.Reason}, "|")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Score > out[j].Score
	})
	return out
}

func applyNamespaceSignalPolicy(items []dto.NamespaceInsightSignalDTO, policy DataplanePolicy, contextName string) []dto.NamespaceInsightSignalDTO {
	if len(items) == 0 {
		return nil
	}
	out := make([]dto.NamespaceInsightSignalDTO, 0, len(items))
	for _, item := range items {
		effective := effectiveSignalSettings(policy, contextName, item.SignalType)
		if !effective.enabled {
			continue
		}
		if isSignalSeverityOverride(effective.severity) {
			item.Severity = effective.severity
		}
		out = append(out, item)
	}
	return out
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
