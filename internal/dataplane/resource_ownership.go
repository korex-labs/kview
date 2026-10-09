package dataplane

import (
	"fmt"
	"sort"
	"strings"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

const (
	ResourceOwnershipMaxDepth   = 4
	ResourceOwnershipMaxMembers = 10
)

type ResourceOwnershipRequest struct {
	Identities []dto.ResourceIdentityDTO `json:"identities"`
	Depth      int                       `json:"depth,omitempty"`
}

type ResourceOwnershipNode struct {
	ResourceMapNode
	JobStatus string `json:"jobStatus,omitempty"`
	PodStatus string `json:"podStatus,omitempty"`
}

type ResourceOwnershipPodGroup struct {
	ID               string                  `json:"id"`
	OwnerID          string                  `json:"ownerId"`
	ObservedCount    int                     `json:"observedCount"`
	CountComplete    bool                    `json:"countComplete"`
	Members          []ResourceOwnershipNode `json:"members"`
	MembersTruncated bool                    `json:"membersTruncated"`
	States           map[string]int          `json:"states"`
}

type ResourceOwnershipResponse struct {
	Active            string                      `json:"active"`
	Roots             []ResourcePresenceItem      `json:"roots"`
	Nodes             []ResourceOwnershipNode     `json:"nodes"`
	Edges             []ResourceMapEdge           `json:"edges"`
	PodGroups         []ResourceOwnershipPodGroup `json:"podGroups"`
	Coverage          ResourceMapCoverage         `json:"coverage"`
	Cache             ResourceMapCacheMetadata    `json:"cache"`
	Limits            ResourceMapLimits           `json:"limits"`
	MaxMembers        int                         `json:"maxMembers"`
	Truncated         bool                        `json:"truncated"`
	TruncationReasons []string                    `json:"truncationReasons,omitempty"`
}

func (m *manager) ResourceOwnership(clusterName string, req ResourceOwnershipRequest) (ResourceOwnershipResponse, error) {
	m.mu.RLock()
	plane, ok := m.planes[clusterName]
	m.mu.RUnlock()
	if !ok {
		return ResourceOwnershipResponse{}, ErrResourceMapPlaneUnavailable
	}
	return plane.ResourceOwnership(req)
}

// Only known workload chains are discovery entrypoints. Arbitrary references,
// selectors and namespace containment never become traversal hops.
func ownershipChildRoutes(route string) []string {
	switch route {
	case "deployments":
		return []string{"replicasets", "pods"}
	case "cronjobs":
		return []string{"jobs", "pods"}
	case "replicasets", "daemonsets", "statefulsets", "jobs":
		return []string{"pods"}
	}
	return nil
}

type ownershipState struct {
	replicaSet *ResourceMapReplicaSetPresentation
	status     string
}

// Consume topology and lifecycle from the same peek. Lifecycle work has its own
// request-wide bound and requires UID agreement; absent/legacy state stays unknown.
func collectOwnershipSnapshot[I any](c *resourceMapCollector, route, namespace string, store *namespacedSnapshotStore[Snapshot[I]], states map[resourceIdentityKey]ownershipState, remaining *int, state func(I) (dto.ResourceIdentityDTO, ownershipState)) {
	s, ok := peekNamespacedSnapshot(store, namespace)
	filter := false
	if !ok {
		s, ok = peekNamespacedSnapshot(store, "")
		ok = ok && exactResourceMapSnapshot(s.Meta)
		filter = true
	}
	c.snapshotFiltered(route+"/"+namespace, len(s.Items), len(s.Items), s.Relationships, s.RelationshipMetadata, s.Meta, ok, namespace, filter)
	if !ok {
		return
	}
	for _, item := range s.Items {
		if *remaining == 0 {
			c.reasons["lifecycle scan limit; remaining state unknown"] = struct{}{}
			break
		}
		*remaining--
		identity, presentation := state(item)
		if identity.Namespace == namespace && identity.UID != "" {
			key := identityKey(identity)
			if _, duplicate := states[key]; duplicate {
				states[key] = ownershipState{} // Ambiguous same-UID rows fail open.
			} else {
				states[key] = presentation
			}
		}
	}
}

func (p *clusterPlane) ResourceOwnership(req ResourceOwnershipRequest) (ResourceOwnershipResponse, error) {
	if len(req.Identities) == 0 || len(req.Identities) > ResourcePresenceMaxItems || req.Depth < 0 || req.Depth > ResourceOwnershipMaxDepth {
		return ResourceOwnershipResponse{}, fmt.Errorf("invalid resource ownership limits")
	}
	if req.Depth == 0 {
		req.Depth = 2
	}
	cells := map[string]string{}
	for _, identity := range req.Identities {
		if err := identity.Validate(); err != nil {
			return ResourceOwnershipResponse{}, err
		}
		if route, ok := resourcePresenceRoute(identity); ok {
			cells[route+"\x00"+identity.Namespace] = route
			for _, child := range ownershipChildRoutes(route) {
				cells[child+"\x00"+identity.Namespace] = child
			}
		}
	}
	keys := make([]string, 0, len(cells))
	for key := range cells {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	// Seed cells first, then topology before Pod fanout, to retain useful roots
	// under the hard shared scan budget.
	seedCells := map[string]bool{}
	for _, identity := range req.Identities {
		if route, ok := resourcePresenceRoute(identity); ok {
			seedCells[route+"\x00"+identity.Namespace] = true
		}
	}
	sort.SliceStable(keys, func(i, j int) bool {
		if seedCells[keys[i]] != seedCells[keys[j]] {
			return seedCells[keys[i]]
		}
		return cells[keys[i]] != "pods" && cells[keys[j]] == "pods"
	})
	collector := resourceMapCollector{reasons: map[string]struct{}{}, families: map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{}}
	states := map[resourceIdentityKey]ownershipState{}
	exactCells := map[string]bool{}
	remaining, stateRemaining := ResourceMapMaxScannedRecords, ResourceMapMaxScannedRecords
	for _, key := range keys {
		if remaining <= 0 {
			collector.truncated = true
			collector.reasons["relationship scan limit"] = struct{}{}
			break
		}
		route := cells[key]
		namespace := strings.SplitN(key, "\x00", 2)[1]
		c := resourceMapCollector{reasons: map[string]struct{}{}, families: map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{}, scanLimit: remaining}
		identity := func(group, resource, kind, name, uid string) dto.ResourceIdentityDTO {
			return dto.ResourceIdentityDTO{Group: group, Version: "v1", Resource: resource, Kind: kind, Scope: dto.ResourceScopeNamespaced, Namespace: namespace, Name: name, UID: uid}
		}
		switch route {
		case "replicasets":
			collectOwnershipSnapshot(&c, route, namespace, &p.rsStore, states, &stateRemaining, func(item dto.ReplicaSetDTO) (dto.ResourceIdentityDTO, ownershipState) {
				id := identity("apps", route, "ReplicaSet", item.Name, item.UID)
				id.Namespace = item.Namespace
				return id, ownershipState{replicaSet: &ResourceMapReplicaSetPresentation{Revision: item.Revision, Desired: item.Desired, Ready: item.Ready}}
			})
		case "jobs":
			collectOwnershipSnapshot(&c, route, namespace, &p.jobsStore, states, &stateRemaining, func(item dto.JobDTO) (dto.ResourceIdentityDTO, ownershipState) {
				id := identity("batch", route, "Job", item.Name, item.UID)
				id.Namespace = item.Namespace
				status := item.Status
				if status == "Complete" && (!item.SuccessfulTerminal || item.Active > 0 || item.Failed > 0) {
					status = ""
				} // Fail open on conflicting or failed state.
				return id, ownershipState{status: status}
			})
		case "pods":
			collectOwnershipSnapshot(&c, route, namespace, &p.podsStore, states, &stateRemaining, func(item dto.PodListItemDTO) (dto.ResourceIdentityDTO, ownershipState) {
				id := identity("", route, "Pod", item.Name, item.UID)
				id.Namespace = item.Namespace
				status := item.Phase
				if item.ListHealthHint == "problem" || item.ListHealthHint == "attention" {
					status = item.ListHealthHint
				}
				return id, ownershipState{status: status}
			})
		default:
			c = p.collectResourcePresenceRoute(route, namespace, remaining)
		}
		exactCells[key] = !c.truncated && len(c.reasons) == 0
		// Invalid records cannot prove absence, even with a complete envelope.
		for _, wrapped := range c.records {
			if wrapped.record.Version != dto.ResourceRelationshipRecordVersion || wrapped.record.Resource.Validate() != nil {
				exactCells[key] = false
			}
		}
		remaining -= c.meta.ScannedRecords
		collector.records = append(collector.records, c.records...)
		collector.meta.ScannedRecords += c.meta.ScannedRecords
		collector.meta.SnapshotsPresent += c.meta.SnapshotsPresent
		collector.meta.SnapshotsMissing += c.meta.SnapshotsMissing
		collector.addFreshness(c.meta.Freshness)
		if c.meta.ObservedAt.After(collector.meta.ObservedAt) {
			collector.meta.ObservedAt = c.meta.ObservedAt
		}
		if collector.meta.OldestObservedAt.IsZero() || (!c.meta.OldestObservedAt.IsZero() && c.meta.OldestObservedAt.Before(collector.meta.OldestObservedAt)) {
			collector.meta.OldestObservedAt = c.meta.OldestObservedAt
		}
		collector.truncated = collector.truncated || c.truncated
		for reason := range c.reasons {
			collector.reasons[reason] = struct{}{}
		}
	}
	return projectResourceOwnership(p.name, req, &collector, exactCells, states), nil
}

// Build only ownership indexes. Each record and owner reference is examined once,
// under separate request-wide caps; unrelated selector/reference payloads are never
// copied or indexed. Adjacency buckets are disjoint, not copied per visited owner.
func ownershipIndex(c *resourceMapCollector) (*resourceMapIndex, map[int][]reverseOwnerRelation, map[string]bool) {
	idx := &resourceMapIndex{byUID: map[string][]int{}, byCanonicalNoUID: map[resourceIdentityKey][]int{}, byOwner: map[resourceMapOwnerKey][]int{}}
	ids := map[resourceIdentityKey]int{}
	uncertain := map[string]bool{}
	for _, wrapped := range c.records {
		r := wrapped.record
		if r.Version != dto.ResourceRelationshipRecordVersion || r.Resource.Validate() != nil {
			uncertain[r.Resource.Namespace] = true
			continue
		}
		key := identityKey(r.Resource)
		if _, exists := ids[key]; exists {
			continue
		}
		id := len(idx.identities)
		ids[key] = id
		idx.identities = append(idx.identities, r.Resource)
		idx.byCanonicalNoUID[canonicalNoUIDKey(r.Resource)] = append(idx.byCanonicalNoUID[canonicalNoUIDKey(r.Resource)], id)
		idx.byOwner[ownerKeyForIdentity(r.Resource)] = append(idx.byOwner[ownerKeyForIdentity(r.Resource)], id)
		if r.Resource.UID != "" {
			idx.byUID[r.Resource.UID] = append(idx.byUID[r.Resource.UID], id)
		}
	}
	parents := map[int]map[int]dto.ResourceOwnerReferenceDTO{}
	remaining := ResourceMapMaxScannedRecords
	for _, wrapped := range c.records {
		r := wrapped.record
		child, valid := ids[identityKey(r.Resource)]
		if !valid || r.Version != dto.ResourceRelationshipRecordVersion {
			continue
		}
		if len(r.Owners) > remaining {
			c.truncated = true
			c.reasons["owner reference scan limit"] = struct{}{}
			remaining = 0
			continue
		}
		remaining -= len(r.Owners)
		if !fullCompleteRelationshipCoverage(r.Coverage) {
			uncertain[r.Resource.Namespace] = true
		}
		if coverage, declared := r.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; declared && !fullCompleteRelationshipCoverage(coverage) {
			uncertain[r.Resource.Namespace] = true
		}
		for _, owner := range r.Owners {
			parent, ok := idx.resolveOwner(owner, r.Resource.Namespace)
			group, version, parsed := parseAPIVersion(owner.APIVersion)
			if !validOwnerReference(owner) || !parsed || !ok {
				uncertain[r.Resource.Namespace] = true
				continue
			}
			identity := idx.identities[parent]
			if identity.Group != group || identity.Version != version || identity.Kind != owner.Kind || identity.Name != owner.Name || identity.Namespace != r.Resource.Namespace || len(idx.byCanonicalNoUID[canonicalNoUIDKey(r.Resource)]) != 1 {
				uncertain[r.Resource.Namespace] = true
				continue
			}
			if parents[child] == nil {
				parents[child] = map[int]dto.ResourceOwnerReferenceDTO{}
			}
			// Prefer exact UID evidence over duplicate name-only evidence.
			if previous, exists := parents[child][parent]; !exists || previous.UID == "" {
				parents[child][parent] = owner
			}
		}
	}
	adjacency := map[int][]reverseOwnerRelation{}
	for child, owners := range parents {
		identity := idx.identities[child]
		if isCoreV1NamespacedResource(identity, "pods", "Pod") && len(owners) != 1 {
			uncertain[identity.Namespace] = true
			continue // Never double-count a Pod in separate owner groups.
		}
		for parent, owner := range owners {
			adjacency[parent] = append(adjacency[parent], reverseOwnerRelation{child: child, owner: owner})
		}
	}
	if len(uncertain) > 0 {
		c.reasons["rejected or ambiguous ownership evidence; Pod counts are lower bounds"] = struct{}{}
	}
	return idx, adjacency, uncertain
}

func ownershipPodPriority(status string) int {
	switch status {
	case "problem", "attention", "Failed":
		return 0
	case "", "unknown", "Unknown":
		return 1
	case "Running", "Succeeded":
		return 3
	default:
		return 2
	}
}

func projectResourceOwnership(context string, req ResourceOwnershipRequest, c *resourceMapCollector, exactCells map[string]bool, states map[resourceIdentityKey]ownershipState) ResourceOwnershipResponse {
	idx, adjacency, uncertain := ownershipIndex(c)
	for parent := range adjacency {
		relations := adjacency[parent]
		sort.Slice(relations, func(i, j int) bool {
			a, b := idx.identities[relations[i].child], idx.identities[relations[j].child]
			pa, pb := ownershipPodPriority(states[identityKey(a)].status), ownershipPodPriority(states[identityKey(b)].status)
			if (a.Kind == "Pod") != (b.Kind == "Pod") {
				return a.Kind != "Pod"
			}
			if a.Kind == "Pod" && pa != pb {
				return pa < pb
			}
			return comparePresentNodeID(context, a, b) < 0
		})
	}
	out := ResourceOwnershipResponse{Active: context, Roots: make([]ResourcePresenceItem, 0, len(req.Identities)), Nodes: []ResourceOwnershipNode{}, Edges: []ResourceMapEdge{}, PodGroups: []ResourceOwnershipPodGroup{}, Cache: c.meta, MaxMembers: ResourceOwnershipMaxMembers, Limits: ResourceMapLimits{Depth: req.Depth, MaxNodes: ResourceMapMaxNodes, MaxEdges: ResourceMapMaxEdges, MaxScanRecords: ResourceMapMaxScannedRecords}}
	reasons := map[string]bool{}
	if c.truncated {
		reasons["scan limit"] = true
	}
	node := func(id, depth int) ResourceOwnershipNode {
		identity := idx.identities[id]
		n := ResourceOwnershipNode{ResourceMapNode: ResourceMapNode{ID: resourceMapNodeID(context, identity), Identity: identity, Depth: depth, Direction: ResourceMapDirectionChild, Availability: ResourceMapAvailabilityPresent, Navigable: true}}
		state := states[identityKey(identity)]
		if len(idx.byCanonicalNoUID[canonicalNoUIDKey(identity)]) != 1 {
			state = ownershipState{} // Replacement/canonical collisions never drive history.
		}
		n.ReplicaSet = state.replicaSet
		if identity.Kind == "Job" {
			n.JobStatus = state.status
		}
		if identity.Kind == "Pod" {
			n.PodStatus = state.status
		}
		return n
	}
	depths := map[int]int{}
	queue := []int{}
	roots := map[int]bool{}
	for _, requested := range req.Identities {
		item := ResourcePresenceItem{Requested: requested, Identity: requested, Availability: ResourceMapAvailabilityUnknown}
		id, ambiguous := idx.resolveCanonicalPresenceTarget(requested)
		item.Ambiguous = ambiguous
		if id >= 0 {
			item.Identity = idx.identities[id]
			item.Resolved = true
			item.Availability = ResourceMapAvailabilityPresent
			roots[id] = true
		} else if route, ok := resourcePresenceRoute(requested); ok && exactCells[route+"\x00"+requested.Namespace] && !ambiguous {
			item.Availability = ResourceMapAvailabilityMissing
		}
		out.Roots = append(out.Roots, item)
	}
	for id := range roots {
		queue = append(queue, id)
	}
	sort.Slice(queue, func(i, j int) bool {
		return comparePresentNodeID(context, idx.identities[queue[i]], idx.identities[queue[j]]) < 0
	})
	for _, id := range queue {
		depths[id] = 0
		out.Nodes = append(out.Nodes, node(id, 0))
	}
	edgeSeen := map[string]bool{}
	for cursor := 0; cursor < len(queue); cursor++ {
		parent := queue[cursor]
		identity := idx.identities[parent]
		depth := depths[parent]
		route, _ := resourcePresenceRoute(identity)
		if len(ownershipChildRoutes(route)) == 0 {
			continue
		}
		group := ResourceOwnershipPodGroup{ID: "pods:" + resourceMapNodeID(context, identity), OwnerID: resourceMapNodeID(context, identity), CountComplete: exactCells["pods\x00"+identity.Namespace] && !uncertain[identity.Namespace] && !c.truncated, Members: []ResourceOwnershipNode{}, States: map[string]int{}}
		for _, relation := range adjacency[parent] {
			child := relation.child
			childRoute, known := resourcePresenceRoute(idx.identities[child])
			if !known || (childRoute != "pods" && len(ownershipChildRoutes(childRoute)) == 0) {
				continue // Unsupported descendants remain unevaluated, not transit hops.
			}
			if depth >= req.Depth {
				reasons["depth limit"] = true
				continue
			}
			if isCoreV1NamespacedResource(idx.identities[child], "pods", "Pod") {
				group.ObservedCount++
				status := states[identityKey(idx.identities[child])].status
				if status == "" {
					status = "unknown"
				}
				group.States[status]++
				// Explicit Pod roots remain ordinary nodes, but still count toward
				// the owner's observed total. Do not duplicate them in the sample.
				if !roots[child] {
					if len(group.Members) < ResourceOwnershipMaxMembers {
						group.Members = append(group.Members, node(child, depth+1))
					}
					continue
				}
			}
			if _, seen := depths[child]; !seen {
				if len(out.Nodes)+len(out.PodGroups) >= ResourceMapMaxNodes {
					reasons["node limit"] = true
					continue
				}
				depths[child] = depth + 1
				queue = append(queue, child)
				out.Nodes = append(out.Nodes, node(child, depth+1))
			}
			from, to := resourceMapNodeID(context, identity), resourceMapNodeID(context, idx.identities[child])
			key := stableParts(from, to)
			if edgeSeen[key] {
				continue
			}
			edgeSeen[key] = true
			if len(out.Edges) >= ResourceMapMaxEdges {
				reasons["edge limit"] = true
				continue
			}
			out.Edges = append(out.Edges, ResourceMapEdge{ID: key, From: from, To: to, Type: ResourceMapEdgeOwner, Source: dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: "metadata.ownerReferences"}, Confidence: ownerEdgeConfidence(relation.owner, identity, true), Resolved: true})
		}
		if group.ObservedCount > 0 {
			group.MembersTruncated = group.ObservedCount > len(group.Members)
			if len(out.Nodes)+len(out.PodGroups) < ResourceMapMaxNodes {
				out.PodGroups = append(out.PodGroups, group)
			} else {
				reasons["node limit"] = true
			}
		}
	}
	for reason := range reasons {
		out.TruncationReasons = append(out.TruncationReasons, reason)
	}
	sort.Strings(out.TruncationReasons)
	out.Truncated = len(reasons) > 0
	coverageReasons := []string{"known workload ownership only; custom descendant discovery and non-owner relationships not evaluated"}
	for reason := range c.reasons {
		coverageReasons = append(coverageReasons, reason)
	}
	sort.Strings(coverageReasons)
	out.Coverage = ResourceMapCoverage{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial, Reasons: coverageReasons, Families: map[dto.ResourceRelationshipFamily]ResourceMapFamilyCoverage{dto.ResourceRelationshipFamilyOwner: {Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}}}
	out.Cache.TotalNodes = len(out.Nodes)
	out.Cache.ReturnedNodes = len(out.Nodes)
	out.Cache.TotalEdges = len(out.Edges)
	out.Cache.ReturnedEdges = len(out.Edges)
	return out
}
