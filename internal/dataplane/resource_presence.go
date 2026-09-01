package dataplane

import (
	"fmt"
	"sort"
	"strings"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

const ResourcePresenceMaxItems = ResourceMapMaxNodes

type ResourcePresenceRequest struct {
	Identities []dto.ResourceIdentityDTO `json:"identities"`
}

type ResourcePresenceItem struct {
	Requested    dto.ResourceIdentityDTO `json:"requested"`
	Identity     dto.ResourceIdentityDTO `json:"identity"`
	Resolved     bool                    `json:"resolved"`
	Ambiguous    bool                    `json:"ambiguous,omitempty"`
	Availability ResourceMapAvailability `json:"availability"`
}

type ResourcePresenceResponse struct {
	Active string                   `json:"active"`
	Items  []ResourcePresenceItem   `json:"items"`
	Cache  ResourceMapCacheMetadata `json:"cache"`
}

func (m *manager) ResourcePresence(clusterName string, req ResourcePresenceRequest) (ResourcePresenceResponse, error) {
	m.mu.RLock()
	plane, ok := m.planes[clusterName]
	m.mu.RUnlock()
	if !ok {
		return ResourcePresenceResponse{}, ErrResourceMapPlaneUnavailable
	}
	return plane.ResourcePresence(req)
}

type resourcePresenceGroup struct {
	route   string
	targets []int
}

// resolveCanonicalPresenceTarget deliberately omits Resource Map's compatibility
// fallback. Presence requests carry a complete canonical identity, so matching
// only Kind/scope/namespace/name could turn a different GVR into a false present.
func (idx *resourceMapIndex) resolveCanonicalPresenceTarget(target dto.ResourceIdentityDTO) (int, bool) {
	ids := idx.byCanonicalNoUID[canonicalNoUIDKey(target)]
	if target.UID == "" {
		if len(ids) == 1 {
			return ids[0], false
		}
		return -1, len(ids) > 1
	}
	match := -1
	matches := 0
	for _, id := range ids {
		if idx.identities[id].UID == target.UID {
			match = id
			matches++
		}
	}
	if matches == 1 {
		return match, false
	}
	return -1, matches > 1
}

func resourcePresenceRoute(identity dto.ResourceIdentityDTO) (string, bool) {
	canonical := strings.Join([]string{identity.Group, identity.Version, identity.Resource, identity.Kind, string(identity.Scope)}, "|")
	switch canonical {
	case "|v1|namespaces|Namespace|cluster":
		return "namespaces", true
	case "|v1|nodes|Node|cluster":
		return "nodes", true
	case "|v1|persistentvolumes|PersistentVolume|cluster":
		return "persistentvolumes", true
	case "rbac.authorization.k8s.io|v1|clusterroles|ClusterRole|cluster":
		return "clusterroles", true
	case "rbac.authorization.k8s.io|v1|clusterrolebindings|ClusterRoleBinding|cluster":
		return "clusterrolebindings", true
	case "apiextensions.k8s.io|v1|customresourcedefinitions|CustomResourceDefinition|cluster":
		return "customresourcedefinitions", true
	case "|v1|pods|Pod|namespaced":
		return "pods", true
	case "|v1|services|Service|namespaced":
		return "services", true
	case "|v1|configmaps|ConfigMap|namespaced":
		return "configmaps", true
	case "|v1|secrets|Secret|namespaced":
		return "secrets", true
	case "|v1|serviceaccounts|ServiceAccount|namespaced":
		return "serviceaccounts", true
	case "|v1|persistentvolumeclaims|PersistentVolumeClaim|namespaced":
		return "persistentvolumeclaims", true
	case "|v1|resourcequotas|ResourceQuota|namespaced":
		return "resourcequotas", true
	case "|v1|limitranges|LimitRange|namespaced":
		return "limitranges", true
	case "apps|v1|deployments|Deployment|namespaced":
		return "deployments", true
	case "apps|v1|daemonsets|DaemonSet|namespaced":
		return "daemonsets", true
	case "apps|v1|statefulsets|StatefulSet|namespaced":
		return "statefulsets", true
	case "apps|v1|replicasets|ReplicaSet|namespaced":
		return "replicasets", true
	case "batch|v1|jobs|Job|namespaced":
		return "jobs", true
	case "batch|v1|cronjobs|CronJob|namespaced":
		return "cronjobs", true
	case "networking.k8s.io|v1|ingresses|Ingress|namespaced":
		return "ingresses", true
	case "networking.k8s.io|v1|networkpolicies|NetworkPolicy|namespaced":
		return "networkpolicies", true
	case "autoscaling|v2|horizontalpodautoscalers|HorizontalPodAutoscaler|namespaced":
		return "horizontalpodautoscalers", true
	case "rbac.authorization.k8s.io|v1|roles|Role|namespaced":
		return "roles", true
	case "rbac.authorization.k8s.io|v1|rolebindings|RoleBinding|namespaced":
		return "rolebindings", true
	}
	if strings.Contains(identity.Group, ".") && !strings.HasSuffix(identity.Group, ".k8s.io") {
		if identity.Scope == dto.ResourceScopeNamespaced {
			return "customresources", true
		}
		if identity.Scope == dto.ResourceScopeCluster {
			return "clusterresources", true
		}
	}
	return "", false
}

func (p *clusterPlane) collectResourcePresenceRoute(route, namespace string, scanLimit int) resourceMapCollector {
	collector := resourceMapCollector{
		reasons:   map[string]struct{}{},
		families:  map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{},
		scanLimit: scanLimit,
	}
	scope := resourceMapNamespaceScope{namespace: namespace, required: true}
	switch route {
	case "namespaces":
		collectClusterResourceMap(&collector, route, &p.nsStore)
	case "nodes":
		collectClusterResourceMap(&collector, route, &p.nodesStore)
	case "persistentvolumes":
		collectClusterResourceMap(&collector, route, &p.persistentVolumesStore)
	case "clusterroles":
		collectClusterResourceMap(&collector, route, &p.clusterRolesStore)
	case "clusterrolebindings":
		collectClusterResourceMap(&collector, route, &p.clusterRoleBindingsStore)
	case "customresourcedefinitions":
		collectClusterResourceMap(&collector, route, &p.crdsStore)
	case "clusterresources":
		collectClusterCustomResourceMap(&collector, route, &p.clusterCustomResourcesStore)
	case "pods":
		collectNamespacedResourceMap(&collector, route, &p.podsStore, scope)
	case "deployments":
		collectNamespacedResourceMap(&collector, route, &p.depsStore, scope)
	case "services":
		collectNamespacedResourceMap(&collector, route, &p.svcsStore, scope)
	case "ingresses":
		collectNamespacedResourceMap(&collector, route, &p.ingStore, scope)
	case "networkpolicies":
		collectNamespacedResourceMap(&collector, route, &p.networkPoliciesStore, scope)
	case "persistentvolumeclaims":
		collectNamespacedResourceMap(&collector, route, &p.pvcsStore, scope)
	case "configmaps":
		collectNamespacedResourceMap(&collector, route, &p.cmsStore, scope)
	case "secrets":
		collectNamespacedResourceMap(&collector, route, &p.secsStore, scope)
	case "serviceaccounts":
		collectNamespacedResourceMap(&collector, route, &p.saStore, scope)
	case "roles":
		collectNamespacedResourceMap(&collector, route, &p.rolesStore, scope)
	case "rolebindings":
		collectNamespacedResourceMap(&collector, route, &p.roleBindingsStore, scope)
	case "daemonsets":
		collectNamespacedResourceMap(&collector, route, &p.dsStore, scope)
	case "statefulsets":
		collectNamespacedResourceMap(&collector, route, &p.stsStore, scope)
	case "replicasets":
		collectNamespacedResourceMap(&collector, route, &p.rsStore, scope)
	case "jobs":
		collectNamespacedResourceMap(&collector, route, &p.jobsStore, scope)
	case "cronjobs":
		collectNamespacedResourceMap(&collector, route, &p.cjStore, scope)
	case "horizontalpodautoscalers":
		collectNamespacedResourceMap(&collector, route, &p.hpaStore, scope)
	case "resourcequotas":
		collectNamespacedResourceMap(&collector, route, &p.rqStore, scope)
	case "limitranges":
		collectNamespacedResourceMap(&collector, route, &p.lrStore, scope)
	case "customresources":
		collectNamespacedCustomResourceMap(&collector, route, &p.customResourcesStore, scope)
	}
	return collector
}

// ResourcePresence resolves canonical identities exclusively from already-loaded
// snapshot cache cells. It never schedules work, reads persistence, or invokes
// Kubernetes clients.
func (p *clusterPlane) ResourcePresence(req ResourcePresenceRequest) (ResourcePresenceResponse, error) {
	if len(req.Identities) == 0 || len(req.Identities) > ResourcePresenceMaxItems {
		return ResourcePresenceResponse{}, fmt.Errorf("resource presence identities must contain between 1 and %d items", ResourcePresenceMaxItems)
	}
	out := ResourcePresenceResponse{Active: p.name, Items: make([]ResourcePresenceItem, len(req.Identities))}
	groups := map[string]*resourcePresenceGroup{}
	for i, identity := range req.Identities {
		if err := identity.Validate(); err != nil {
			return ResourcePresenceResponse{}, fmt.Errorf("invalid resource presence identity %d: %w", i, err)
		}
		out.Items[i] = ResourcePresenceItem{Requested: identity, Identity: identity, Availability: ResourceMapAvailabilityUnknown}
		route, supported := resourcePresenceRoute(identity)
		if !supported {
			continue
		}
		key := route + "\x00" + identity.Namespace
		group := groups[key]
		if group == nil {
			group = &resourcePresenceGroup{route: route}
			groups[key] = group
		}
		group.targets = append(group.targets, i)
	}

	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	remaining := ResourceMapMaxScannedRecords
	for _, key := range keys {
		if remaining <= 0 {
			break
		}
		group := groups[key]
		namespace := req.Identities[group.targets[0]].Namespace
		collector := p.collectResourcePresenceRoute(group.route, namespace, remaining)
		remaining -= collector.meta.ScannedRecords
		out.Cache.SnapshotsPresent += collector.meta.SnapshotsPresent
		out.Cache.SnapshotsMissing += collector.meta.SnapshotsMissing
		out.Cache.ScannedRecords += collector.meta.ScannedRecords
		index := newResourceMapIndex(&collector)
		out.Cache.TotalNodes += len(index.identities)
		authoritativeAbsence := !collector.truncated && len(collector.reasons) == 0
		for _, targetIndex := range group.targets {
			item := &out.Items[targetIndex]
			record, ambiguous := index.resolveCanonicalPresenceTarget(item.Requested)
			item.Ambiguous = ambiguous
			if record >= 0 {
				item.Identity = index.identities[record]
				item.Resolved = true
				item.Availability = ResourceMapAvailabilityPresent
				out.Cache.ReturnedNodes++
			} else if authoritativeAbsence && !ambiguous {
				item.Availability = ResourceMapAvailabilityMissing
			}
		}
	}
	return out, nil
}
