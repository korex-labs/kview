package dataplane

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"k8s.io/apimachinery/pkg/util/validation"
)

var ErrResourceMapPlaneUnavailable = errors.New("resource map context plane unavailable")

// ResourceMap peeks the already-loaded context plane and delegates to its
// synchronous cache-only graph projection. It intentionally does not call
// PlaneForCluster because that path creates planes and hydrates persistence.
func (m *manager) ResourceMap(clusterName string, req ResourceMapRequest) (ResourceMapResponse, error) {
	m.mu.RLock()
	plane, ok := m.planes[clusterName]
	m.mu.RUnlock()
	if !ok {
		return ResourceMapResponse{}, ErrResourceMapPlaneUnavailable
	}
	return plane.ResourceMap(req)
}

const (
	ResourceMapMaxDepth          = 2
	ResourceMapMaxNodes          = 100
	ResourceMapMaxEdges          = 200
	ResourceMapMaxScannedRecords = 50000
)

type ResourceMapRequest struct {
	Target dto.ResourceIdentityDTO `json:"target"`
	Depth  int                     `json:"depth,omitempty"`
}

type ResourceMapAvailability string

const (
	ResourceMapAvailabilityPresent ResourceMapAvailability = "present"
	ResourceMapAvailabilityMissing ResourceMapAvailability = "missing"
	ResourceMapAvailabilityUnknown ResourceMapAvailability = "unknown"
)

type ResourceMapDirection string

const (
	ResourceMapDirectionCurrent ResourceMapDirection = "current"
	ResourceMapDirectionParent  ResourceMapDirection = "parent"
	ResourceMapDirectionChild   ResourceMapDirection = "child"
	ResourceMapDirectionBoth    ResourceMapDirection = "both"
)

type ResourceMapNode struct {
	ID           string                  `json:"id"`
	Identity     dto.ResourceIdentityDTO `json:"identity"`
	Depth        int                     `json:"depth"`
	Direction    ResourceMapDirection    `json:"direction"`
	Availability ResourceMapAvailability `json:"availability"`
	Navigable    bool                    `json:"navigable"`
	Current      bool                    `json:"current,omitempty"`
}

type ResourceMapEdgeType string

const (
	ResourceMapEdgeOwner           ResourceMapEdgeType = "owner"
	ResourceMapEdgeNamespace       ResourceMapEdgeType = "namespace"
	ResourceMapEdgeObjectReference ResourceMapEdgeType = "objectReference"
	ResourceMapEdgeKindDefinition  ResourceMapEdgeType = "kindDefinition"
	ResourceMapEdgeSelector        ResourceMapEdgeType = "selector"
)

type ResourceMapEdgeConfidence string

const (
	ResourceMapEdgeConfidenceExact ResourceMapEdgeConfidence = "exact"
	ResourceMapEdgeConfidenceHigh  ResourceMapEdgeConfidence = "high"
)

type ResourceMapEdge struct {
	ID         string                              `json:"id"`
	From       string                              `json:"from"`
	To         string                              `json:"to"`
	Type       ResourceMapEdgeType                 `json:"type"`
	Source     dto.ResourceRelationshipSourceDTO   `json:"source"`
	Evidence   dto.ResourceRelationshipEvidenceDTO `json:"evidence,omitempty"`
	Confidence ResourceMapEdgeConfidence           `json:"confidence"`
	Resolved   bool                                `json:"resolved"`
}

type ResourceMapLimits struct {
	Depth          int `json:"depth"`
	MaxNodes       int `json:"maxNodes"`
	MaxEdges       int `json:"maxEdges"`
	MaxScanRecords int `json:"maxScanRecords"`
}

type ResourceMapCacheMetadata struct {
	// ObservedAt remains the newest consulted observation for JSON compatibility.
	ObservedAt       time.Time      `json:"observedAt,omitempty"`
	OldestObservedAt time.Time      `json:"oldestObservedAt,omitempty"`
	Freshness        FreshnessClass `json:"freshness"`
	SnapshotsPresent int            `json:"snapshotsPresent"`
	SnapshotsMissing int            `json:"snapshotsMissing"`
	ScannedRecords   int            `json:"scannedRecords"`
	TotalNodes       int            `json:"totalNodes"`
	ReturnedNodes    int            `json:"returnedNodes"`
	TotalEdges       int            `json:"totalEdges"`
	ReturnedEdges    int            `json:"returnedEdges"`
}

type ResourceMapCoverage struct {
	Coverage        dto.ResourceRelationshipCoverage                             `json:"coverage"`
	Completeness    dto.ResourceRelationshipCompleteness                         `json:"completeness"`
	Reasons         []string                                                     `json:"reasons,omitempty"`
	Families        map[dto.ResourceRelationshipFamily]ResourceMapFamilyCoverage `json:"families"`
	AmbiguousTarget bool                                                         `json:"ambiguousTarget,omitempty"`
}

type ResourceMapFamilyCoverage struct {
	Coverage     dto.ResourceRelationshipCoverage     `json:"coverage"`
	Completeness dto.ResourceRelationshipCompleteness `json:"completeness"`
	Reasons      []string                             `json:"reasons,omitempty"`
}

// ResourceMapTarget exposes the center of the projection without requiring
// clients to recover it from the bounded Nodes list. Identity is authoritative
// cached identity when Resolved is true and otherwise preserves Requested.
type ResourceMapTarget struct {
	ID           string                  `json:"id"`
	Requested    dto.ResourceIdentityDTO `json:"requested"`
	Identity     dto.ResourceIdentityDTO `json:"identity"`
	Resolved     bool                    `json:"resolved"`
	Availability ResourceMapAvailability `json:"availability"`
	Navigable    bool                    `json:"navigable"`
}

type ResourceMapResponse struct {
	Active            string                   `json:"active"`
	TargetID          string                   `json:"targetId"`
	Target            ResourceMapTarget        `json:"target"`
	Nodes             []ResourceMapNode        `json:"nodes"`
	Edges             []ResourceMapEdge        `json:"edges"`
	Coverage          ResourceMapCoverage      `json:"coverage"`
	Truncated         bool                     `json:"truncated"`
	TruncationReasons []string                 `json:"truncationReasons,omitempty"`
	Limits            ResourceMapLimits        `json:"limits"`
	Cache             ResourceMapCacheMetadata `json:"cache"`
}

type resourceMapRecord struct {
	record              *dto.ResourceRelationshipRecord
	store               string
	validEnvelopeFamily map[dto.ResourceRelationshipFamily]bool
}

type resourceMapCollector struct {
	records      []resourceMapRecord
	meta         ResourceMapCacheMetadata
	reasons      map[string]struct{}
	families     map[dto.ResourceRelationshipFamily]*resourceMapFamilyState
	truncated    bool
	freshnessSet bool
}

type resourceMapFamilyState struct {
	declared     bool
	coverage     dto.ResourceRelationshipCoverage
	completeness dto.ResourceRelationshipCompleteness
	reasons      map[string]struct{}
}

type resourceMapNamespaceScope struct {
	namespace string
	required  bool
}

func (c *resourceMapCollector) snapshot(store string, visibleItems, relationshipSourceItems int, relationships []dto.ResourceRelationshipRecord, relationshipMetadata *dto.ResourceRelationshipSnapshotMetadata, meta SnapshotMetadata, ok bool) {
	c.snapshotFiltered(store, visibleItems, relationshipSourceItems, relationships, relationshipMetadata, meta, ok, "", false)
}

func (c *resourceMapCollector) snapshotFiltered(store string, visibleItems, relationshipSourceItems int, relationships []dto.ResourceRelationshipRecord, relationshipMetadata *dto.ResourceRelationshipSnapshotMetadata, meta SnapshotMetadata, ok bool, namespace string, filter bool) {
	if !ok {
		c.missing("missing snapshot: " + store)
		return
	}
	c.meta.SnapshotsPresent++
	c.addFreshness(meta.Freshness)
	if meta.ObservedAt.After(c.meta.ObservedAt) {
		c.meta.ObservedAt = meta.ObservedAt
	}
	if c.meta.OldestObservedAt.IsZero() || meta.ObservedAt.Before(c.meta.OldestObservedAt) {
		c.meta.OldestObservedAt = meta.ObservedAt
	}
	if meta.Coverage != CoverageClassFull || meta.Completeness != CompletenessClassComplete {
		c.reasons["inexact snapshot: "+store] = struct{}{}
	}
	if relationshipSourceItems > 0 && len(relationships) == 0 {
		c.reasons["legacy snapshot without relationship sidecar: "+store] = struct{}{}
	}
	validEnvelopeFamily := make(map[dto.ResourceRelationshipFamily]bool)
	metadataValid := false
	countsValid := false
	if relationshipMetadata == nil {
		c.reasons["missing relationship metadata: "+store] = struct{}{}
		c.degradeFamily(dto.ResourceRelationshipFamilyOwner, "missing relationship metadata: "+store)
	} else if relationshipMetadata.Version != dto.ResourceRelationshipSnapshotMetadataVersion {
		c.reasons["unsupported relationship metadata version: "+store] = struct{}{}
		c.degradeFamily(dto.ResourceRelationshipFamilyOwner, "unsupported relationship metadata version: "+store)
	} else {
		metadataValid = true
		countsValid = visibleItems >= 0 && relationshipSourceItems >= 0 && relationshipMetadata.SourceItems >= 0 && relationshipMetadata.EvidenceRecords >= 0 && relationshipMetadata.SourceItems == relationshipSourceItems && relationshipMetadata.EvidenceRecords == len(relationships) && (relationshipSourceItems > 0 || len(relationships) == 0)
		ownerCoverage := relationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]
		if ownerCoverage.Coverage != dto.ResourceRelationshipCoverageFull || ownerCoverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
			c.reasons["inexact owner relationship metadata: "+store] = struct{}{}
		}
		for _, family := range indexedResourceMapFamilies() {
			coverage, declared := relationshipMetadata.FamilyCoverage[family]
			if !declared {
				continue
			}
			c.observeFamily(family, coverage, "inexact "+string(family)+" relationship metadata: "+store)
			validEnvelopeFamily[family] = countsValid && exactResourceMapSnapshot(meta) && fullCompleteRelationshipCoverage(coverage)
			if !exactResourceMapSnapshot(meta) {
				c.degradeFamily(family, "inexact snapshot: "+store)
			}
		}
		c.observeFamily(dto.ResourceRelationshipFamilyOwner, ownerCoverage, "inexact owner relationship metadata: "+store)
		if !countsValid {
			c.reasons["inconsistent relationship metadata: "+store] = struct{}{}
			for family := range validEnvelopeFamily {
				validEnvelopeFamily[family] = false
				c.degradeFamily(family, "inconsistent relationship metadata: "+store)
			}
		}
	}
	for i := range relationships {
		// ScannedRecords is a hard work bound: every examined sidecar record
		// counts, including records rejected by an all-namespaces filter.
		if c.meta.ScannedRecords >= ResourceMapMaxScannedRecords {
			c.truncated = true
			c.reasons["relationship scan limit"] = struct{}{}
			if metadataValid {
				for family := range relationshipMetadata.FamilyCoverage {
					if family == dto.ResourceRelationshipFamilyOwner || isIndexedResourceMapFamily(family) {
						c.degradeFamily(family, "relationship scan limit: "+store)
					}
				}
			}
			return
		}
		c.meta.ScannedRecords++
		if filter && relationships[i].Resource.Namespace != namespace {
			continue
		}
		c.records = append(c.records, resourceMapRecord{record: &relationships[i], store: store, validEnvelopeFamily: validEnvelopeFamily})
	}
}

func explicitResourceMapFamilies() []dto.ResourceRelationshipFamily {
	return []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyKindDefinition}
}

func indexedResourceMapFamilies() []dto.ResourceRelationshipFamily {
	return []dto.ResourceRelationshipFamily{
		dto.ResourceRelationshipFamilyObjectReference,
		dto.ResourceRelationshipFamilyKindDefinition,
		dto.ResourceRelationshipFamilySelector,
		dto.ResourceRelationshipFamilyLabels,
	}
}

func isExplicitResourceMapFamily(family dto.ResourceRelationshipFamily) bool {
	return family == dto.ResourceRelationshipFamilyObjectReference || family == dto.ResourceRelationshipFamilyKindDefinition
}

func isIndexedResourceMapFamily(family dto.ResourceRelationshipFamily) bool {
	return isExplicitResourceMapFamily(family) || family == dto.ResourceRelationshipFamilySelector || family == dto.ResourceRelationshipFamilyLabels
}

func fullCompleteRelationshipCoverage(coverage dto.ResourceRelationshipCoverageDTO) bool {
	return coverage.Coverage == dto.ResourceRelationshipCoverageFull && coverage.Completeness == dto.ResourceRelationshipCompletenessComplete
}

func (c *resourceMapCollector) family(family dto.ResourceRelationshipFamily) *resourceMapFamilyState {
	if c.families == nil {
		c.families = make(map[dto.ResourceRelationshipFamily]*resourceMapFamilyState)
	}
	state := c.families[family]
	if state == nil {
		state = &resourceMapFamilyState{coverage: dto.ResourceRelationshipCoverageUnknown, completeness: dto.ResourceRelationshipCompletenessUnknown, reasons: make(map[string]struct{})}
		c.families[family] = state
	}
	return state
}

func (c *resourceMapCollector) observeFamily(family dto.ResourceRelationshipFamily, coverage dto.ResourceRelationshipCoverageDTO, reason string) {
	state := c.family(family)
	if !state.declared {
		state.declared = true
		state.coverage = coverage.Coverage
		state.completeness = coverage.Completeness
	} else {
		state.coverage = worstRelationshipCoverage(state.coverage, coverage.Coverage)
		state.completeness = worstRelationshipCompleteness(state.completeness, coverage.Completeness)
	}
	if !fullCompleteRelationshipCoverage(coverage) && reason != "" {
		state.reasons[reason] = struct{}{}
	}
}

func (c *resourceMapCollector) degradeFamily(family dto.ResourceRelationshipFamily, reason string) {
	state := c.family(family)
	if !state.declared {
		state.declared = true
		state.coverage = dto.ResourceRelationshipCoveragePartial
		state.completeness = dto.ResourceRelationshipCompletenessPartial
	} else {
		state.coverage = worstRelationshipCoverage(state.coverage, dto.ResourceRelationshipCoveragePartial)
		state.completeness = worstRelationshipCompleteness(state.completeness, dto.ResourceRelationshipCompletenessPartial)
	}
	state.reasons[reason] = struct{}{}
}

func worstRelationshipCoverage(a, b dto.ResourceRelationshipCoverage) dto.ResourceRelationshipCoverage {
	if a == dto.ResourceRelationshipCoverageUnknown || b == dto.ResourceRelationshipCoverageUnknown {
		return dto.ResourceRelationshipCoverageUnknown
	}
	if a == dto.ResourceRelationshipCoveragePartial || b == dto.ResourceRelationshipCoveragePartial {
		return dto.ResourceRelationshipCoveragePartial
	}
	return dto.ResourceRelationshipCoverageFull
}

func worstRelationshipCompleteness(a, b dto.ResourceRelationshipCompleteness) dto.ResourceRelationshipCompleteness {
	if a == dto.ResourceRelationshipCompletenessUnknown || b == dto.ResourceRelationshipCompletenessUnknown {
		return dto.ResourceRelationshipCompletenessUnknown
	}
	if a == dto.ResourceRelationshipCompletenessPartial || b == dto.ResourceRelationshipCompletenessPartial {
		return dto.ResourceRelationshipCompletenessPartial
	}
	return dto.ResourceRelationshipCompletenessComplete
}

func (c *resourceMapCollector) missing(reason string) {
	c.meta.SnapshotsMissing++
	c.addFreshness(FreshnessClassUnknown)
	c.reasons[reason] = struct{}{}
}

func (c *resourceMapCollector) addFreshness(value FreshnessClass) {
	switch value {
	case FreshnessClassHot, FreshnessClassWarm, FreshnessClassCold, FreshnessClassStale, FreshnessClassUnknown:
	default:
		value = FreshnessClassUnknown
	}
	if !c.freshnessSet {
		c.meta.Freshness = value
		c.freshnessSet = true
		return
	}
	c.meta.Freshness = WorstFreshness(c.meta.Freshness, value)
}

func collectClusterResourceMap[I any](c *resourceMapCollector, name string, store *snapshotStore[Snapshot[I]]) {
	s, ok := peekClusterSnapshot(store)
	c.snapshot(name, len(s.Items), len(s.Items), s.Relationships, s.RelationshipMetadata, s.Meta, ok)
}

func collectNamespacedResourceMap[I any](c *resourceMapCollector, name string, store *namespacedSnapshotStore[Snapshot[I]], scope resourceMapNamespaceScope) {
	if !scope.required {
		return
	}
	if s, ok := peekNamespacedSnapshot(store, scope.namespace); ok {
		// Exact namespace cells are already scoped, so consume their relationship
		// sidecar directly without allocating a filtered copy.
		c.snapshot(name+"/"+scope.namespace, len(s.Items), len(s.Items), s.Relationships, s.RelationshipMetadata, s.Meta, true)
		return
	}
	if s, ok := peekNamespacedSnapshot(store, ""); ok && exactResourceMapSnapshot(s.Meta) {
		// Empty-key cells are complete all-namespace inventories. Filter without
		// allocating a copy. Every examined relationship still consumes the hard
		// scan budget, including records from unrelated namespaces.
		c.snapshotFiltered(name+"/", len(s.Items), len(s.Items), s.Relationships, s.RelationshipMetadata, s.Meta, true, scope.namespace, true)
		return
	}
	c.missing("missing target namespace snapshot: " + name + "/" + scope.namespace)
}

func customResourceRelationshipSourceItems(snapshot CustomResourcesSnapshot) int {
	if snapshot.RelationshipSourceItems != nil {
		return *snapshot.RelationshipSourceItems
	}
	// Live snapshots still have hidden carriers. Older persisted snapshots do
	// not, so they safely fall back to zero and cannot claim complete coverage.
	return customResourceRelationshipSourceItemCount(snapshot.Items)
}

func collectClusterCustomResourceMap(c *resourceMapCollector, name string, store *snapshotStore[CustomResourcesSnapshot]) {
	s, ok := peekClusterSnapshot(store)
	c.snapshot(name, len(s.Items), customResourceRelationshipSourceItems(s), s.Relationships, s.RelationshipMetadata, s.Meta, ok)
}

func collectNamespacedCustomResourceMap(c *resourceMapCollector, name string, store *namespacedSnapshotStore[CustomResourcesSnapshot], scope resourceMapNamespaceScope) {
	if !scope.required {
		return
	}
	if s, ok := peekNamespacedSnapshot(store, scope.namespace); ok {
		c.snapshot(name+"/"+scope.namespace, len(s.Items), customResourceRelationshipSourceItems(s), s.Relationships, s.RelationshipMetadata, s.Meta, true)
		return
	}
	if s, ok := peekNamespacedSnapshot(store, ""); ok && exactResourceMapSnapshot(s.Meta) {
		// Validate the complete all-namespace cell's source/evidence totals before
		// filtering retained relationship records to the target namespace.
		c.snapshotFiltered(name+"/", len(s.Items), customResourceRelationshipSourceItems(s), s.Relationships, s.RelationshipMetadata, s.Meta, true, scope.namespace, true)
		return
	}
	c.missing("missing target namespace snapshot: " + name + "/" + scope.namespace)
}

func exactResourceMapSnapshot(meta SnapshotMetadata) bool {
	return meta.Coverage == CoverageClassFull && meta.Completeness == CompletenessClassComplete
}

func resourceMapTargetNamespace(target dto.ResourceIdentityDTO) resourceMapNamespaceScope {
	if target.Scope == dto.ResourceScopeNamespaced {
		return resourceMapNamespaceScope{namespace: target.Namespace, required: true}
	}
	if target.Scope == dto.ResourceScopeCluster && target.Group == "" && target.Version == "v1" && target.Resource == "namespaces" {
		return resourceMapNamespaceScope{namespace: target.Name, required: true}
	}
	return resourceMapNamespaceScope{}
}

type resourceIdentityKey struct {
	group, version, resource, kind string
	scope                          dto.ResourceScope
	namespace, name, uid           string
}

type resourceCompatibilityKey struct {
	kind, namespace, name string
	scope                 dto.ResourceScope
}

type resourceMapOwnerKey struct {
	group, version, kind string
	scope                dto.ResourceScope
	namespace, name      string
}

type compactResourceRecord struct {
	identity   int
	owners     []dto.ResourceOwnerReferenceDTO
	references []compactResourceReference
}

type compactResourceReference struct {
	typeValue ResourceMapEdgeType
	target    dto.ResourceIdentityDTO
	source    dto.ResourceRelationshipSourceDTO
	evidence  dto.ResourceRelationshipEvidenceDTO
}

type reverseReferenceRelation struct {
	source    int
	reference compactResourceReference
}

type reverseOwnerRelation struct {
	child int
	owner dto.ResourceOwnerReferenceDTO
}

type resourceMapLabelKey struct {
	namespace, key, value string
}

type compactResourceSelector struct {
	matchLabels map[string]string
	source      dto.ResourceRelationshipSourceDTO
}

type reverseSelectorRelation struct {
	service  int
	selector compactResourceSelector
}

type resourceMapIndex struct {
	identities                []dto.ResourceIdentityDTO
	records                   []compactResourceRecord
	recordsByIdentity         [][]int
	byUID                     map[string][]int
	byCanonicalNoUID          map[resourceIdentityKey][]int
	byCompat                  map[resourceCompatibilityKey][]int
	byOwner                   map[resourceMapOwnerKey][]int
	reverseUID                map[string][]reverseOwnerRelation
	reverseFallback           map[resourceMapOwnerKey][]reverseOwnerRelation
	reverseReferenceUID       map[string][]reverseReferenceRelation
	reverseReferenceCanonical map[resourceIdentityKey][]reverseReferenceRelation
	byNamespace               map[string][]int
	podLabels                 map[int]map[string]string
	podsByLabel               map[resourceMapLabelKey][]int
	selectorsByService        map[int][]compactResourceSelector
	reverseSelector           map[resourceMapLabelKey][]reverseSelectorRelation
}

func identityKey(identity dto.ResourceIdentityDTO) resourceIdentityKey {
	return resourceIdentityKey{identity.Group, identity.Version, identity.Resource, identity.Kind, identity.Scope, identity.Namespace, identity.Name, identity.UID}
}

func canonicalNoUIDKey(identity dto.ResourceIdentityDTO) resourceIdentityKey {
	key := identityKey(identity)
	key.uid = ""
	return key
}

func compatibilityIdentityKey(identity dto.ResourceIdentityDTO) resourceCompatibilityKey {
	return resourceCompatibilityKey{kind: strings.ToLower(identity.Kind), scope: identity.Scope, namespace: identity.Namespace, name: identity.Name}
}

func ownerKeyForIdentity(identity dto.ResourceIdentityDTO) resourceMapOwnerKey {
	return resourceMapOwnerKey{group: identity.Group, version: identity.Version, kind: identity.Kind, scope: identity.Scope, namespace: identity.Namespace, name: identity.Name}
}

func newResourceMapIndex(c *resourceMapCollector) *resourceMapIndex {
	idx := &resourceMapIndex{
		byUID:                     make(map[string][]int),
		byCanonicalNoUID:          make(map[resourceIdentityKey][]int),
		byCompat:                  make(map[resourceCompatibilityKey][]int),
		byOwner:                   make(map[resourceMapOwnerKey][]int),
		reverseUID:                make(map[string][]reverseOwnerRelation),
		reverseFallback:           make(map[resourceMapOwnerKey][]reverseOwnerRelation),
		reverseReferenceUID:       make(map[string][]reverseReferenceRelation),
		reverseReferenceCanonical: make(map[resourceIdentityKey][]reverseReferenceRelation),
		byNamespace:               make(map[string][]int),
	}
	byIdentity := make(map[resourceIdentityKey]int, len(c.records))
	var canonicalPods map[resourceIdentityKey]int
	var pendingPodLabels map[int]map[string]string
	var pendingSelectors map[int][]compactResourceSelector
	var pendingSelectorSemantics map[int]string
	selectorEvidenceExact := true
	labelEvidenceExact := true
	if c.truncated {
		selectorEvidenceExact = false
		labelEvidenceExact = false
		c.degradeFamily(dto.ResourceRelationshipFamilySelector, "relationship scan limit prevents exact selector projection")
		c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "relationship scan limit prevents exact Pod labels projection")
	}
	sawNonEmptySelector := false
	for i := range c.records {
		wrapped := &c.records[i]
		r := wrapped.record
		if r.Version != dto.ResourceRelationshipRecordVersion {
			c.reasons["unsupported relationship record version: "+wrapped.store] = struct{}{}
			c.degradeDeclaredExplicitFamilies(wrapped, "unsupported relationship record version: "+wrapped.store)
			continue
		}
		if r.Resource.Validate() != nil {
			c.reasons["malformed relationship record: "+wrapped.store] = struct{}{}
			c.degradeDeclaredExplicitFamilies(wrapped, "malformed relationship record: "+wrapped.store)
			continue
		}
		key := identityKey(r.Resource)
		identityID, exists := byIdentity[key]
		if !exists {
			identityID = len(idx.identities)
			byIdentity[key] = identityID
			idx.identities = append(idx.identities, r.Resource)
			idx.recordsByIdentity = append(idx.recordsByIdentity, nil)
			if r.Resource.UID != "" {
				idx.byUID[r.Resource.UID] = append(idx.byUID[r.Resource.UID], identityID)
			}
			canonicalKey := key
			canonicalKey.uid = ""
			compatKey := compatibilityIdentityKey(r.Resource)
			ownerKey := ownerKeyForIdentity(r.Resource)
			idx.byCanonicalNoUID[canonicalKey] = append(idx.byCanonicalNoUID[canonicalKey], identityID)
			idx.byCompat[compatKey] = append(idx.byCompat[compatKey], identityID)
			idx.byOwner[ownerKey] = append(idx.byOwner[ownerKey], identityID)
			if r.Resource.Scope == dto.ResourceScopeNamespaced {
				idx.byNamespace[r.Resource.Namespace] = append(idx.byNamespace[r.Resource.Namespace], identityID)
			}
		}
		compact := compactResourceRecord{identity: identityID, owners: r.Owners}
		isPod := isCoreV1NamespacedResource(r.Resource, "pods", "Pod")
		isService := isCoreV1NamespacedResource(r.Resource, "services", "Service")
		if isPod {
			envelopeExact := wrapped.validEnvelopeFamily[dto.ResourceRelationshipFamilyLabels]
			recordExact := fullCompleteRelationshipCoverage(r.FamilyCoverage[dto.ResourceRelationshipFamilyLabels])
			if envelopeExact && recordExact {
				if canonicalPods == nil {
					canonicalPods = make(map[resourceIdentityKey]int)
				}
				canonicalKey := canonicalNoUIDKey(r.Resource)
				if previousIdentity, exists := canonicalPods[canonicalKey]; exists && previousIdentity != identityID {
					labelEvidenceExact = false
					selectorEvidenceExact = false
					c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "ambiguous canonical Pod identity: "+wrapped.store)
					c.degradeFamily(dto.ResourceRelationshipFamilySelector, "ambiguous canonical Pod identity prevents exact selector projection: "+wrapped.store)
				} else if !exists {
					canonicalPods[canonicalKey] = identityID
				}
			}
			if !envelopeExact {
				labelEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "missing or inexact Pod labels snapshot evidence: "+wrapped.store)
			}
			if !recordExact {
				labelEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "missing or inexact Pod labels record evidence: "+wrapped.store)
			}
			if !validResourceMapLabelMap(r.Labels, dto.ResourceRelationshipMaxLabels, dto.ResourceRelationshipMaxLabelBytes) {
				labelEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "malformed or unbounded Pod labels: "+wrapped.store)
			} else if previous, exists := pendingPodLabels[identityID]; envelopeExact && recordExact && exists && !equalResourceMapLabelMap(previous, r.Labels) {
				labelEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilyLabels, "conflicting Pod label evidence: "+wrapped.store)
			} else if envelopeExact && recordExact && !exists {
				if pendingPodLabels == nil {
					pendingPodLabels = make(map[int]map[string]string)
				}
				pendingPodLabels[identityID] = r.Labels
			}
		}
		if !isService && len(r.Selectors) > 0 {
			selectorEvidenceExact = false
			c.degradeFamily(dto.ResourceRelationshipFamilySelector, "unsupported selector source resource: "+wrapped.store)
		}
		if isService {
			selectorsBounded := validResourceMapSelectorSlice(r.Selectors)
			if !selectorsBounded {
				selectorEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilySelector, "unbounded Service selector evidence: "+wrapped.store)
			} else {
				semantics := serviceSelectorSemanticSignature(r.Selectors)
				if previous, exists := pendingSelectorSemantics[identityID]; exists && previous != semantics {
					selectorEvidenceExact = false
					c.degradeFamily(dto.ResourceRelationshipFamilySelector, "conflicting Service selector evidence: "+wrapped.store)
				} else if !exists {
					if pendingSelectorSemantics == nil {
						pendingSelectorSemantics = make(map[int]string)
					}
					pendingSelectorSemantics[identityID] = semantics
				}
			}
			if !wrapped.validEnvelopeFamily[dto.ResourceRelationshipFamilySelector] {
				selectorEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilySelector, "missing or inexact selector snapshot evidence: "+wrapped.store)
			}
			if !fullCompleteRelationshipCoverage(r.FamilyCoverage[dto.ResourceRelationshipFamilySelector]) {
				selectorEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilySelector, "missing or inexact selector record evidence: "+wrapped.store)
			}
			if selectorsBounded {
				for _, selector := range r.Selectors {
					if !fullCompleteRelationshipCoverage(selector.Coverage) || !validServicePodSelector(selector) {
						selectorEvidenceExact = false
						c.degradeFamily(dto.ResourceRelationshipFamilySelector, "malformed or inexact Service selector evidence: "+wrapped.store)
						continue
					}
					if len(selector.MatchLabels) == 0 {
						// Kubernetes Services with an empty selector select nothing. The
						// mapper normally emits zero structured selectors for this case.
						continue
					}
					sawNonEmptySelector = true
					if pendingSelectors == nil {
						pendingSelectors = make(map[int][]compactResourceSelector)
					}
					pendingSelectors[identityID] = append(pendingSelectors[identityID], compactResourceSelector{matchLabels: cloneResourceMapStringMap(selector.MatchLabels), source: selector.Source})
				}
			}
		}
		for _, reference := range r.References {
			if reference.Type == dto.ResourceRelationshipTypeSelector {
				selectorEvidenceExact = false
				c.degradeFamily(dto.ResourceRelationshipFamilySelector, "unsupported legacy selector evidence: "+wrapped.store)
			}
		}
		for _, reference := range r.References {
			family, edgeType, recognized := explicitResourceMapReferenceType(reference.Type)
			if !recognized {
				continue
			}
			if !wrapped.validEnvelopeFamily[family] {
				c.degradeFamily(family, "missing or inexact "+string(family)+" snapshot evidence: "+wrapped.store)
				continue
			}
			if !fullCompleteRelationshipCoverage(r.FamilyCoverage[family]) {
				c.degradeFamily(family, "missing or inexact "+string(family)+" record evidence: "+wrapped.store)
				continue
			}
			if !fullCompleteRelationshipCoverage(reference.Coverage) {
				c.degradeFamily(family, "inexact "+string(family)+" edge evidence: "+wrapped.store)
				continue
			}
			if reference.Target.Validate() != nil {
				c.degradeFamily(family, "malformed "+string(family)+" target: "+wrapped.store)
				continue
			}
			compact.references = append(compact.references, compactResourceReference{typeValue: edgeType, target: reference.Target, source: reference.Source, evidence: reference.Evidence})
		}
		recordID := len(idx.records)
		idx.records = append(idx.records, compact)
		idx.recordsByIdentity[identityID] = append(idx.recordsByIdentity[identityID], recordID)
		if r.Coverage.Coverage != dto.ResourceRelationshipCoverageFull || r.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
			c.reasons["partial relationship record"] = struct{}{}
		}
		for _, owner := range r.Owners {
			if !validOwnerReference(owner) {
				c.reasons["malformed owner reference"] = struct{}{}
				continue
			}
			relation := reverseOwnerRelation{child: identityID, owner: owner}
			if owner.UID != "" {
				idx.reverseUID[owner.UID] = append(idx.reverseUID[owner.UID], relation)
				continue
			}
			group, version, _ := parseAPIVersion(owner.APIVersion)
			if r.Resource.Namespace != "" {
				key := resourceMapOwnerKey{group: group, version: version, kind: owner.Kind, scope: dto.ResourceScopeNamespaced, namespace: r.Resource.Namespace, name: owner.Name}
				idx.reverseFallback[key] = append(idx.reverseFallback[key], relation)
			}
			key := resourceMapOwnerKey{group: group, version: version, kind: owner.Kind, scope: dto.ResourceScopeCluster, name: owner.Name}
			idx.reverseFallback[key] = append(idx.reverseFallback[key], relation)
		}
		for _, reference := range compact.references {
			relation := reverseReferenceRelation{source: identityID, reference: reference}
			if reference.target.UID != "" {
				idx.reverseReferenceUID[reference.target.UID] = append(idx.reverseReferenceUID[reference.target.UID], relation)
			} else {
				idx.reverseReferenceCanonical[canonicalNoUIDKey(reference.target)] = append(idx.reverseReferenceCanonical[canonicalNoUIDKey(reference.target)], relation)
			}
		}
	}
	selectorState := c.families[dto.ResourceRelationshipFamilySelector]
	labelsState := c.families[dto.ResourceRelationshipFamilyLabels]
	selectorReady := selectorState != nil && selectorState.declared && selectorState.coverage == dto.ResourceRelationshipCoverageFull && selectorState.completeness == dto.ResourceRelationshipCompletenessComplete
	labelsReady := labelsState != nil && labelsState.declared && labelsState.coverage == dto.ResourceRelationshipCoverageFull && labelsState.completeness == dto.ResourceRelationshipCompletenessComplete
	if sawNonEmptySelector && (!labelsReady || !labelEvidenceExact) {
		c.degradeFamily(dto.ResourceRelationshipFamilySelector, "missing or inexact Pod labels projection evidence")
		selectorReady = false
	}
	if sawNonEmptySelector && selectorReady && labelsReady && selectorEvidenceExact && labelEvidenceExact {
		idx.buildSelectorIndexes(pendingPodLabels, pendingSelectors)
	}
	return idx
}

func isCoreV1NamespacedResource(identity dto.ResourceIdentityDTO, resource, kind string) bool {
	return identity.Group == "" && identity.Version == "v1" && identity.Resource == resource && identity.Kind == kind && identity.Scope == dto.ResourceScopeNamespaced && identity.Namespace != ""
}

func validServicePodSelector(selector dto.ResourceRelationshipSelectorDTO) bool {
	target := selector.Target
	if target.Group != "" || target.Version != "v1" || target.Resource != "pods" || target.Kind != "Pod" || target.Scope != dto.ResourceScopeNamespaced {
		return false
	}
	if selector.Source.Type != dto.ResourceRelationshipSourceKubernetes && selector.Source.Type != dto.ResourceRelationshipSourceProduct {
		return false
	}
	return validResourceMapLabelMap(selector.MatchLabels, dto.ResourceRelationshipMaxSelectorMatchLabels, dto.ResourceRelationshipMaxSelectorBytes)
}

func validResourceMapSelectorSlice(selectors []dto.ResourceRelationshipSelectorDTO) bool {
	if len(selectors) > dto.ResourceRelationshipMaxSelectors {
		return false
	}
	total := 0
	for _, selector := range selectors {
		if len(selector.MatchLabels) > dto.ResourceRelationshipMaxSelectorMatchLabels {
			return false
		}
		total += len(selector.Target.Group) + len(selector.Target.Version) + len(selector.Target.Resource) + len(selector.Target.Kind) + len(selector.Target.Scope) + len(selector.Source.Type) + len(selector.Source.FieldPath)
		for key, value := range selector.MatchLabels {
			total += len(key) + len(value)
		}
		if total > dto.ResourceRelationshipMaxSelectorsBytes {
			return false
		}
	}
	return true
}

func validResourceMapLabelMap(values map[string]string, maxEntries, maxBytes int) bool {
	if len(values) > maxEntries {
		return false
	}
	total := 0
	for key, value := range values {
		if !utf8.ValidString(key) || !utf8.ValidString(value) || len(validation.IsQualifiedName(key)) != 0 || len(validation.IsValidLabelValue(value)) != 0 {
			return false
		}
		total += len(key) + len(value)
		if total > maxBytes {
			return false
		}
	}
	return true
}

func serviceSelectorSemanticSignature(selectors []dto.ResourceRelationshipSelectorDTO) string {
	semanticSet := make(map[string]struct{}, len(selectors))
	for _, selector := range selectors {
		keys := make([]string, 0, len(selector.MatchLabels))
		for key := range selector.MatchLabels {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := []string{
			selector.Target.Group,
			selector.Target.Version,
			selector.Target.Resource,
			selector.Target.Kind,
			string(selector.Target.Scope),
		}
		for _, key := range keys {
			parts = append(parts, key, selector.MatchLabels[key])
		}
		semanticSet[stableParts(parts...)] = struct{}{}
	}
	signatures := make([]string, 0, len(semanticSet))
	for signature := range semanticSet {
		signatures = append(signatures, signature)
	}
	sort.Strings(signatures)
	return stableParts(signatures...)
}

func equalResourceMapLabelMap(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for key, value := range a {
		if b[key] != value {
			return false
		}
	}
	return true
}

func cloneResourceMapStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func (idx *resourceMapIndex) buildSelectorIndexes(podLabels map[int]map[string]string, selectorsByService map[int][]compactResourceSelector) {
	idx.podLabels = podLabels
	idx.podsByLabel = make(map[resourceMapLabelKey][]int)
	for pod, labels := range podLabels {
		namespace := idx.identities[pod].Namespace
		for key, value := range labels {
			posting := resourceMapLabelKey{namespace: namespace, key: key, value: value}
			idx.podsByLabel[posting] = append(idx.podsByLabel[posting], pod)
		}
	}
	idx.selectorsByService = selectorsByService
	idx.reverseSelector = make(map[resourceMapLabelKey][]reverseSelectorRelation)
	for service, selectors := range selectorsByService {
		namespace := idx.identities[service].Namespace
		for _, selector := range selectors {
			anchor, candidates := idx.smallestSelectorPosting(namespace, selector.matchLabels)
			if len(candidates) == 0 {
				continue
			}
			idx.reverseSelector[anchor] = append(idx.reverseSelector[anchor], reverseSelectorRelation{service: service, selector: selector})
		}
	}
}

func (idx *resourceMapIndex) smallestSelectorPosting(namespace string, matchLabels map[string]string) (resourceMapLabelKey, []int) {
	var anchor resourceMapLabelKey
	var smallest []int
	first := true
	for key, value := range matchLabels {
		postingKey := resourceMapLabelKey{namespace: namespace, key: key, value: value}
		posting := idx.podsByLabel[postingKey]
		if first || len(posting) < len(smallest) || (len(posting) == len(smallest) && resourceMapLabelKeyLess(postingKey, anchor)) {
			anchor, smallest, first = postingKey, posting, false
		}
	}
	return anchor, smallest
}

func resourceMapLabelKeyLess(a, b resourceMapLabelKey) bool {
	if a.namespace != b.namespace {
		return a.namespace < b.namespace
	}
	if a.key != b.key {
		return a.key < b.key
	}
	return a.value < b.value
}

func (idx *resourceMapIndex) selectorMatchesPod(selector compactResourceSelector, pod int) bool {
	labels, ok := idx.podLabels[pod]
	if !ok {
		return false
	}
	for key, value := range selector.matchLabels {
		if labels[key] != value {
			return false
		}
	}
	return true
}

func selectorIncidentEdge(selector compactResourceSelector, fromCurrent bool) incidentEdge {
	evidence := dto.ResourceRelationshipEvidenceDTO{Description: "label selector", Selector: selector.matchLabels}
	return incidentEdge{fromCurrent: fromCurrent, typeValue: ResourceMapEdgeSelector, source: selector.source, evidence: evidence, evidenceKey: resourceMapEvidenceKey(selector.source, evidence), confidence: ResourceMapEdgeConfidenceExact, resolved: true}
}

func (c *resourceMapCollector) degradeDeclaredExplicitFamilies(record *resourceMapRecord, reason string) {
	for family := range record.validEnvelopeFamily {
		c.degradeFamily(family, reason)
	}
}

func explicitResourceMapReferenceType(referenceType dto.ResourceRelationshipType) (dto.ResourceRelationshipFamily, ResourceMapEdgeType, bool) {
	switch referenceType {
	case dto.ResourceRelationshipTypeObjectReference:
		return dto.ResourceRelationshipFamilyObjectReference, ResourceMapEdgeObjectReference, true
	case dto.ResourceRelationshipTypeKindDefinition:
		return dto.ResourceRelationshipFamilyKindDefinition, ResourceMapEdgeKindDefinition, true
	default:
		return "", "", false
	}
}

// ResourceMap projects a bounded relationship graph exclusively from snapshot
// cache cells. It never schedules work, reads persistence, or invokes clients.
func (p *clusterPlane) ResourceMap(req ResourceMapRequest) (ResourceMapResponse, error) {
	if err := req.Target.Validate(); err != nil {
		return ResourceMapResponse{}, fmt.Errorf("invalid resource map target: %w", err)
	}
	depth := req.Depth
	if depth == 0 {
		depth = 1
	}
	if depth < 1 || depth > ResourceMapMaxDepth {
		return ResourceMapResponse{}, errors.New("resource map depth must be between 1 and 2")
	}
	out := ResourceMapResponse{Active: p.name, Limits: ResourceMapLimits{Depth: depth, MaxNodes: ResourceMapMaxNodes, MaxEdges: ResourceMapMaxEdges, MaxScanRecords: ResourceMapMaxScannedRecords}}
	c := resourceMapCollector{reasons: map[string]struct{}{}, families: map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{}}
	namespaceScope := resourceMapTargetNamespace(req.Target)
	collectClusterResourceMap(&c, "namespaces", &p.nsStore)
	collectClusterResourceMap(&c, "nodes", &p.nodesStore)
	collectClusterResourceMap(&c, "persistentvolumes", &p.persistentVolumesStore)
	collectClusterResourceMap(&c, "clusterroles", &p.clusterRolesStore)
	collectClusterResourceMap(&c, "clusterrolebindings", &p.clusterRoleBindingsStore)
	collectClusterResourceMap(&c, "customresourcedefinitions", &p.crdsStore)
	collectClusterCustomResourceMap(&c, "clusterresources", &p.clusterCustomResourcesStore)
	collectNamespacedResourceMap(&c, "pods", &p.podsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "deployments", &p.depsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "services", &p.svcsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "ingresses", &p.ingStore, namespaceScope)
	collectNamespacedResourceMap(&c, "networkpolicies", &p.networkPoliciesStore, namespaceScope)
	collectNamespacedResourceMap(&c, "persistentvolumeclaims", &p.pvcsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "configmaps", &p.cmsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "secrets", &p.secsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "serviceaccounts", &p.saStore, namespaceScope)
	collectNamespacedResourceMap(&c, "roles", &p.rolesStore, namespaceScope)
	collectNamespacedResourceMap(&c, "rolebindings", &p.roleBindingsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "daemonsets", &p.dsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "statefulsets", &p.stsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "replicasets", &p.rsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "jobs", &p.jobsStore, namespaceScope)
	collectNamespacedResourceMap(&c, "cronjobs", &p.cjStore, namespaceScope)
	collectNamespacedResourceMap(&c, "horizontalpodautoscalers", &p.hpaStore, namespaceScope)
	collectNamespacedResourceMap(&c, "resourcequotas", &p.rqStore, namespaceScope)
	collectNamespacedResourceMap(&c, "limitranges", &p.lrStore, namespaceScope)
	collectNamespacedCustomResourceMap(&c, "customresources", &p.customResourcesStore, namespaceScope)
	out.Cache = c.meta

	idx := newResourceMapIndex(&c)
	authoritativeTargetAbsence := !c.truncated && len(c.reasons) == 0
	targetRecord, ambiguous := idx.resolveTarget(req.Target)
	targetResolved := targetRecord >= 0
	targetIdentity := req.Target
	targetAvailability := ResourceMapAvailabilityUnknown
	if targetResolved {
		targetIdentity = idx.identities[targetRecord]
		targetAvailability = ResourceMapAvailabilityPresent
	} else if authoritativeTargetAbsence && !ambiguous {
		targetAvailability = ResourceMapAvailabilityMissing
	}
	if !targetResolved && (!authoritativeTargetAbsence || ambiguous) {
		c.reasons["target not resolved from cache"] = struct{}{}
	}
	if ambiguous {
		c.reasons["ambiguous target"] = struct{}{}
	}
	out.Coverage.AmbiguousTarget = ambiguous

	graph := newCompactResourceGraph(p.name, idx)
	targetNode := graph.addTarget(targetRecord, req.Target, targetAvailability)
	out.TargetID = graph.nodeID(targetNode)
	out.Target = ResourceMapTarget{ID: out.TargetID, Requested: req.Target, Identity: targetIdentity, Resolved: targetResolved, Availability: targetAvailability, Navigable: targetResolved}
	out.Nodes, out.Edges, out.Cache.TotalNodes, out.Cache.TotalEdges, out.TruncationReasons = graph.traverse(targetNode, depth)
	out.Cache.ReturnedNodes, out.Cache.ReturnedEdges = len(out.Nodes), len(out.Edges)
	if c.truncated {
		out.TruncationReasons = append(out.TruncationReasons, "scan limit")
	}
	out.TruncationReasons = sortedUnique(out.TruncationReasons)
	out.Truncated = len(out.TruncationReasons) > 0
	for reason := range c.reasons {
		out.Coverage.Reasons = append(out.Coverage.Reasons, reason)
	}
	projectionFamilies := []dto.ResourceRelationshipFamily{
		dto.ResourceRelationshipFamilyOwner,
		dto.ResourceRelationshipFamilyObjectReference,
		dto.ResourceRelationshipFamilyKindDefinition,
		dto.ResourceRelationshipFamilySelector,
		dto.ResourceRelationshipFamilyLabels,
	}
	out.Coverage.Families = make(map[dto.ResourceRelationshipFamily]ResourceMapFamilyCoverage, len(projectionFamilies))
	for _, family := range projectionFamilies {
		state := c.families[family]
		status := ResourceMapFamilyCoverage{Coverage: dto.ResourceRelationshipCoverageUnknown, Completeness: dto.ResourceRelationshipCompletenessUnknown}
		if state != nil && state.declared {
			status.Coverage = state.coverage
			status.Completeness = state.completeness
			for reason := range state.reasons {
				status.Reasons = append(status.Reasons, reason)
				out.Coverage.Reasons = append(out.Coverage.Reasons, reason)
			}
			sort.Strings(status.Reasons)
		}
		out.Coverage.Families[family] = status
	}
	out.Coverage.Reasons = sortedUnique(out.Coverage.Reasons)
	if len(out.Coverage.Reasons) == 0 && !out.Truncated {
		out.Coverage.Coverage = dto.ResourceRelationshipCoverageFull
		out.Coverage.Completeness = dto.ResourceRelationshipCompletenessComplete
	} else {
		out.Coverage.Coverage = dto.ResourceRelationshipCoveragePartial
		out.Coverage.Completeness = dto.ResourceRelationshipCompletenessPartial
		if c.meta.SnapshotsPresent == 0 || ambiguous {
			out.Coverage.Coverage = dto.ResourceRelationshipCoverageUnknown
			out.Coverage.Completeness = dto.ResourceRelationshipCompletenessUnknown
		}
	}
	for _, family := range projectionFamilies {
		state := c.families[family]
		if state == nil || !state.declared {
			continue
		}
		out.Coverage.Coverage = worstRelationshipCoverage(out.Coverage.Coverage, state.coverage)
		out.Coverage.Completeness = worstRelationshipCompleteness(out.Coverage.Completeness, state.completeness)
	}
	return out, nil
}

func (idx *resourceMapIndex) resolveTarget(target dto.ResourceIdentityDTO) (int, bool) {
	if target.UID != "" {
		matches := 0
		match := -1
		for _, id := range idx.byCanonicalNoUID[canonicalNoUIDKey(target)] {
			if idx.identities[id].UID == target.UID {
				matches++
				match = id
			}
		}
		if matches == 1 {
			return match, false
		}
		return -1, matches > 1
	}
	if ids := idx.byCanonicalNoUID[canonicalNoUIDKey(target)]; len(ids) == 1 {
		return ids[0], false
	} else if len(ids) > 1 {
		return -1, true
	}
	ids := idx.byCompat[compatibilityIdentityKey(target)]
	if len(ids) == 1 {
		return ids[0], false
	}
	return -1, len(ids) > 1
}

func validOwnerReference(owner dto.ResourceOwnerReferenceDTO) bool {
	if strings.TrimSpace(owner.APIVersion) == "" || strings.TrimSpace(owner.Kind) == "" || strings.TrimSpace(owner.Name) == "" {
		return false
	}
	_, _, ok := parseAPIVersion(owner.APIVersion)
	return ok
}

func (idx *resourceMapIndex) resolveOwner(owner dto.ResourceOwnerReferenceDTO, namespace string) (int, bool) {
	if owner.UID != "" {
		ids := idx.byUID[owner.UID]
		if len(ids) == 1 {
			return ids[0], true
		}
		return -1, false
	}
	group, version, ok := parseAPIVersion(owner.APIVersion)
	if !ok {
		return -1, false
	}
	if namespace != "" {
		key := resourceMapOwnerKey{group: group, version: version, kind: owner.Kind, scope: dto.ResourceScopeNamespaced, namespace: namespace, name: owner.Name}
		ids := idx.byOwner[key]
		if len(ids) == 1 {
			return ids[0], true
		}
		if len(ids) > 1 {
			return -1, false
		}
	}
	key := resourceMapOwnerKey{group: group, version: version, kind: owner.Kind, scope: dto.ResourceScopeCluster, name: owner.Name}
	ids := idx.byOwner[key]
	if len(ids) == 1 {
		return ids[0], true
	}
	return -1, false
}

func (idx *resourceMapIndex) resolveReference(target dto.ResourceIdentityDTO) (int, bool) {
	if target.UID != "" {
		match := -1
		for _, id := range idx.byCanonicalNoUID[canonicalNoUIDKey(target)] {
			if idx.identities[id].UID != target.UID {
				continue
			}
			if match >= 0 {
				return -1, false
			}
			match = id
		}
		return match, match >= 0
	}
	ids := idx.byCanonicalNoUID[canonicalNoUIDKey(target)]
	if len(ids) == 1 {
		return ids[0], true
	}
	return -1, false
}

func ownerEdgeConfidence(owner dto.ResourceOwnerReferenceDTO, resolved dto.ResourceIdentityDTO, found bool) ResourceMapEdgeConfidence {
	if found && owner.UID != "" && resolved.UID == owner.UID {
		return ResourceMapEdgeConfidenceExact
	}
	return ResourceMapEdgeConfidenceHigh
}

func ownerIdentityFromReference(owner dto.ResourceOwnerReferenceDTO, namespace string) dto.ResourceIdentityDTO {
	group, version, _ := parseAPIVersion(owner.APIVersion)
	scope := dto.ResourceScopeNamespaced
	if namespace == "" {
		scope = dto.ResourceScopeCluster
	}
	return dto.ResourceIdentityDTO{Group: group, Version: version, Kind: owner.Kind, Scope: scope, Namespace: namespace, Name: owner.Name, UID: owner.UID}
}

func parseAPIVersion(value string) (string, string, bool) {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, "/")
	if len(parts) == 1 && parts[0] != "" && strings.TrimSpace(parts[0]) == parts[0] {
		return "", parts[0], true
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] != "" && strings.TrimSpace(parts[0]) == parts[0] && strings.TrimSpace(parts[1]) == parts[1] {
		return parts[0], parts[1], true
	}
	return "", "", false
}

func unresolvedOwnerNodeID(context string, owner dto.ResourceOwnerReferenceDTO, namespace string) string {
	return stableParts(context, strings.TrimSpace(owner.APIVersion), strings.TrimSpace(owner.Kind), namespace, strings.TrimSpace(owner.Name), owner.UID)
}

type compactGraphNode struct {
	id           string
	identity     *dto.ResourceIdentityDTO
	record       int
	availability ResourceMapAvailability
}

type compactGraphEdge struct {
	from, to    int
	typeValue   ResourceMapEdgeType
	source      dto.ResourceRelationshipSourceDTO
	evidence    dto.ResourceRelationshipEvidenceDTO
	evidenceKey string
	confidence  ResourceMapEdgeConfidence
	resolved    bool
}

type compactGraphEdgeKey struct {
	from, to    int
	typeValue   ResourceMapEdgeType
	evidenceKey string
}

type incidentCandidate struct {
	record       int
	id           string
	identity     dto.ResourceIdentityDTO
	availability ResourceMapAvailability
}

type incidentEdge struct {
	fromCurrent bool
	typeValue   ResourceMapEdgeType
	source      dto.ResourceRelationshipSourceDTO
	evidence    dto.ResourceRelationshipEvidenceDTO
	evidenceKey string
	confidence  ResourceMapEdgeConfidence
	resolved    bool
}

type compactResourceGraph struct {
	context string
	index   *resourceMapIndex
	nodes   []compactGraphNode
	present map[int]int
	missing map[string]int
	edges   map[compactGraphEdgeKey]compactGraphEdge
}

func newCompactResourceGraph(context string, index *resourceMapIndex) *compactResourceGraph {
	return &compactResourceGraph{context: context, index: index, present: make(map[int]int), missing: make(map[string]int), edges: make(map[compactGraphEdgeKey]compactGraphEdge)}
}

func (g *compactResourceGraph) addTarget(record int, requested dto.ResourceIdentityDTO, availability ResourceMapAvailability) int {
	if record >= 0 {
		return g.ensurePresent(record)
	}
	return g.ensureMissing(resourceMapNodeID(g.context, requested), requested, availability)
}

func (g *compactResourceGraph) ensurePresent(record int) int {
	if node, ok := g.present[record]; ok {
		return node
	}
	node := len(g.nodes)
	g.nodes = append(g.nodes, compactGraphNode{record: record, availability: ResourceMapAvailabilityPresent})
	g.present[record] = node
	return node
}

func (g *compactResourceGraph) nodeIdentity(node int) dto.ResourceIdentityDTO {
	if record := g.nodes[node].record; record >= 0 {
		return g.index.identities[record]
	}
	return *g.nodes[node].identity
}

func (g *compactResourceGraph) nodeID(node int) string {
	if g.nodes[node].id == "" {
		g.nodes[node].id = resourceMapNodeID(g.context, g.nodeIdentity(node))
	}
	return g.nodes[node].id
}

func (g *compactResourceGraph) ensureMissing(id string, identity dto.ResourceIdentityDTO, availability ResourceMapAvailability) int {
	if node, ok := g.missing[id]; ok {
		return node
	}
	node := len(g.nodes)
	g.nodes = append(g.nodes, compactGraphNode{id: id, identity: &identity, record: -1, availability: availability})
	g.missing[id] = node
	return node
}

func (g *compactResourceGraph) known(candidate incidentCandidate) (int, bool) {
	if candidate.record >= 0 {
		node, ok := g.present[candidate.record]
		return node, ok
	}
	node, ok := g.missing[candidate.id]
	return node, ok
}

func (g *compactResourceGraph) ensure(candidate incidentCandidate) int {
	if candidate.record >= 0 {
		return g.ensurePresent(candidate.record)
	}
	return g.ensureMissing(candidate.id, candidate.identity, candidate.availability)
}

func (g *compactResourceGraph) addEdge(current, other int, edge incidentEdge) {
	from, to := other, current
	if edge.fromCurrent {
		from, to = current, other
	}
	key := compactGraphEdgeKey{from: from, to: to, typeValue: edge.typeValue, evidenceKey: edge.evidenceKey}
	g.edges[key] = compactGraphEdge{from: from, to: to, typeValue: edge.typeValue, source: edge.source, evidence: edge.evidence, evidenceKey: edge.evidenceKey, confidence: edge.confidence, resolved: edge.resolved}
}

func explicitIncidentEdge(reference compactResourceReference, fromCurrent bool, resolved bool, confidence ResourceMapEdgeConfidence) incidentEdge {
	return incidentEdge{fromCurrent: fromCurrent, typeValue: reference.typeValue, source: reference.source, evidence: reference.evidence, evidenceKey: resourceMapEvidenceKey(reference.source, reference.evidence), confidence: confidence, resolved: resolved}
}

func resourceMapEvidenceKey(source dto.ResourceRelationshipSourceDTO, evidence dto.ResourceRelationshipEvidenceDTO) string {
	parts := []string{string(source.Type), source.FieldPath, evidence.Description}
	keys := make([]string, 0, len(evidence.Selector))
	for key := range evidence.Selector {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		parts = append(parts, key, evidence.Selector[key])
	}
	return stableParts(parts...)
}

func (g *compactResourceGraph) incident(node int, visit func(incidentCandidate, incidentEdge)) {
	current := g.nodes[node]
	if current.record < 0 {
		return
	}
	identity := g.nodeIdentity(node)
	for _, recordID := range g.index.recordsByIdentity[current.record] {
		record := g.index.records[recordID]
		for _, owner := range record.owners {
			if !validOwnerReference(owner) {
				continue
			}
			ownerRecord, found := g.index.resolveOwner(owner, identity.Namespace)
			if found {
				resolved := g.index.identities[ownerRecord]
				visit(incidentCandidate{record: ownerRecord}, incidentEdge{typeValue: ResourceMapEdgeOwner, confidence: ownerEdgeConfidence(owner, resolved, true), resolved: true})
			} else {
				ownerIdentity := ownerIdentityFromReference(owner, identity.Namespace)
				visit(incidentCandidate{record: -1, id: unresolvedOwnerNodeID(g.context, owner, identity.Namespace), identity: ownerIdentity, availability: ResourceMapAvailabilityMissing}, incidentEdge{typeValue: ResourceMapEdgeOwner, confidence: ResourceMapEdgeConfidenceHigh})
			}
		}
		for _, reference := range record.references {
			targetRecord, found := g.index.resolveReference(reference.target)
			if found {
				confidence := ResourceMapEdgeConfidenceHigh
				if reference.target.UID != "" {
					confidence = ResourceMapEdgeConfidenceExact
				}
				visit(incidentCandidate{record: targetRecord}, explicitIncidentEdge(reference, false, true, confidence))
			} else {
				visit(incidentCandidate{record: -1, id: resourceMapNodeID(g.context, reference.target), identity: reference.target, availability: ResourceMapAvailabilityUnknown}, explicitIncidentEdge(reference, false, false, ResourceMapEdgeConfidenceHigh))
			}
		}
	}
	if isCoreV1NamespacedResource(identity, "services", "Service") {
		for _, selector := range g.index.selectorsByService[current.record] {
			_, candidates := g.index.smallestSelectorPosting(identity.Namespace, selector.matchLabels)
			for _, pod := range candidates {
				if g.index.selectorMatchesPod(selector, pod) {
					visit(incidentCandidate{record: pod}, selectorIncidentEdge(selector, true))
				}
			}
		}
	}
	if isCoreV1NamespacedResource(identity, "pods", "Pod") {
		for key, value := range g.index.podLabels[current.record] {
			posting := resourceMapLabelKey{namespace: identity.Namespace, key: key, value: value}
			for _, relation := range g.index.reverseSelector[posting] {
				if g.index.selectorMatchesPod(relation.selector, current.record) {
					visit(incidentCandidate{record: relation.service}, selectorIncidentEdge(relation.selector, false))
				}
			}
		}
	}
	if identity.Scope == dto.ResourceScopeNamespaced {
		nsIdentity := dto.ResourceIdentityDTO{Version: "v1", Resource: "namespaces", Kind: "Namespace", Scope: dto.ResourceScopeCluster, Name: identity.Namespace}
		ids := g.index.byCompat[compatibilityIdentityKey(nsIdentity)]
		if len(ids) == 1 {
			visit(incidentCandidate{record: ids[0]}, incidentEdge{typeValue: ResourceMapEdgeNamespace, confidence: ResourceMapEdgeConfidenceHigh, resolved: true})
		} else {
			visit(incidentCandidate{record: -1, id: resourceMapNodeID(g.context, nsIdentity), identity: nsIdentity, availability: ResourceMapAvailabilityMissing}, incidentEdge{typeValue: ResourceMapEdgeNamespace, confidence: ResourceMapEdgeConfidenceHigh})
		}
	}
	if identity.UID != "" && len(g.index.byUID[identity.UID]) == 1 {
		for _, relation := range g.index.reverseUID[identity.UID] {
			ownerRecord, found := g.index.resolveOwner(relation.owner, g.index.identities[relation.child].Namespace)
			if found && ownerRecord == current.record {
				visit(incidentCandidate{record: relation.child}, incidentEdge{fromCurrent: true, typeValue: ResourceMapEdgeOwner, confidence: ResourceMapEdgeConfidenceExact, resolved: true})
			}
		}
	}
	for _, relation := range g.index.reverseFallback[ownerKeyForIdentity(identity)] {
		ownerRecord, found := g.index.resolveOwner(relation.owner, g.index.identities[relation.child].Namespace)
		if found && ownerRecord == current.record {
			visit(incidentCandidate{record: relation.child}, incidentEdge{fromCurrent: true, typeValue: ResourceMapEdgeOwner, confidence: ResourceMapEdgeConfidenceHigh, resolved: true})
		}
	}
	if identity.UID != "" && len(g.index.byUID[identity.UID]) == 1 {
		for _, relation := range g.index.reverseReferenceUID[identity.UID] {
			targetRecord, found := g.index.resolveReference(relation.reference.target)
			if found && targetRecord == current.record {
				visit(incidentCandidate{record: relation.source}, explicitIncidentEdge(relation.reference, true, true, ResourceMapEdgeConfidenceExact))
			}
		}
	}
	for _, relation := range g.index.reverseReferenceCanonical[canonicalNoUIDKey(identity)] {
		targetRecord, found := g.index.resolveReference(relation.reference.target)
		if found && targetRecord == current.record {
			visit(incidentCandidate{record: relation.source}, explicitIncidentEdge(relation.reference, true, true, ResourceMapEdgeConfidenceHigh))
		}
	}
	if identity.Scope == dto.ResourceScopeCluster && identity.Group == "" && identity.Version == "v1" && identity.Resource == "namespaces" {
		for _, child := range g.index.byNamespace[identity.Name] {
			visit(incidentCandidate{record: child}, incidentEdge{fromCurrent: true, typeValue: ResourceMapEdgeNamespace, confidence: ResourceMapEdgeConfidenceHigh, resolved: true})
		}
	}
}

func (g *compactResourceGraph) traverse(target, maxDepth int) ([]ResourceMapNode, []ResourceMapEdge, int, int, []string) {
	depths := map[int]int{target: 0}
	directions := map[int]ResourceMapDirection{target: ResourceMapDirectionCurrent}
	continuesPath := func(current int, candidate incidentCandidate, edge incidentEdge) bool {
		if current == target {
			return true
		}
		edgeDirection := ResourceMapDirectionParent
		if edge.fromCurrent {
			edgeDirection = ResourceMapDirectionChild
		}
		switch directions[current] {
		case edgeDirection:
			return true
		case ResourceMapDirectionBoth:
			// Preserve cycle edges between already discovered nodes without using a
			// bidirectional node as a bridge into another fan-out.
			_, known := g.known(candidate)
			return known
		default:
			return false
		}
	}
	queue := []int{target}
	for head := 0; head < len(queue); head++ {
		current := queue[head]
		d := depths[current]
		if d >= maxDepth {
			continue
		}
		// Namespace containment is useful context for the requested resource, but a
		// Namespace is a very broad container rather than a dependency hop. Walking
		// through it would pull every cached sibling in the namespace into an
		// otherwise focused depth-2 map.
		if current != target {
			identity := g.nodeIdentity(current)
			if identity.Scope == dto.ResourceScopeCluster && identity.Group == "" && identity.Version == "v1" && identity.Resource == "namespaces" {
				continue
			}
		}
		g.incident(current, func(candidate incidentCandidate, edge incidentEdge) {
			// The target's namespace edge is enough to establish containment. Repeating
			// it for every discovered namespaced neighbour adds no new topology.
			if current != target && edge.typeValue == ResourceMapEdgeNamespace {
				return
			}
			if !continuesPath(current, candidate, edge) {
				return
			}
			other := g.ensure(candidate)
			g.addEdge(current, other, edge)
			direction := ResourceMapDirectionParent
			if edge.fromCurrent {
				direction = ResourceMapDirectionChild
			}
			if old, seen := depths[other]; !seen {
				depths[other] = d + 1
				directions[other] = direction
				queue = append(queue, other)
			} else if old == d+1 && directions[other] != direction {
				directions[other] = ResourceMapDirectionBoth
			}
		})
	}
	depthLimited := false
	for node, d := range depths {
		if d != maxDepth {
			continue
		}
		if node != target {
			identity := g.nodeIdentity(node)
			if identity.Scope == dto.ResourceScopeCluster && identity.Group == "" && identity.Version == "v1" && identity.Resource == "namespaces" {
				continue
			}
		}
		g.incident(node, func(candidate incidentCandidate, edge incidentEdge) {
			if node != target && edge.typeValue == ResourceMapEdgeNamespace {
				return
			}
			if !continuesPath(node, candidate, edge) {
				return
			}
			if other, ok := g.known(candidate); ok {
				if _, discovered := depths[other]; discovered {
					g.addEdge(node, other, edge)
				}
			} else {
				depthLimited = true
			}
		})
	}
	ids := make([]int, 0, len(depths))
	for node := range depths {
		ids = append(ids, node)
	}
	sort.Slice(ids, func(i, j int) bool { return g.nodeLess(ids[i], ids[j], depths, directions) })
	totalNodes := len(ids)
	reasons := []string{}
	if depthLimited {
		reasons = append(reasons, "depth_limit")
	}
	if len(ids) > ResourceMapMaxNodes {
		ids = ids[:ResourceMapMaxNodes]
		reasons = append(reasons, "node limit")
	}
	allowed := make(map[int]bool, len(ids))
	nodes := make([]ResourceMapNode, 0, len(ids))
	for _, node := range ids {
		allowed[node] = true
		n := g.nodes[node]
		nodes = append(nodes, ResourceMapNode{ID: g.nodeID(node), Identity: g.nodeIdentity(node), Depth: depths[node], Direction: directions[node], Availability: n.availability, Navigable: n.availability == ResourceMapAvailabilityPresent, Current: node == target})
	}
	totalEdges := len(g.edges)
	edgeIndexes := make([]compactGraphEdge, 0, min(totalEdges, ResourceMapMaxEdges+1))
	for _, edge := range g.edges {
		if allowed[edge.from] && allowed[edge.to] {
			edgeIndexes = append(edgeIndexes, edge)
		}
	}
	sort.Slice(edgeIndexes, func(i, j int) bool {
		a, b := edgeIndexes[i], edgeIndexes[j]
		if a.typeValue != b.typeValue {
			return a.typeValue < b.typeValue
		}
		if g.nodeID(a.from) != g.nodeID(b.from) {
			return g.nodeID(a.from) < g.nodeID(b.from)
		}
		if g.nodeID(a.to) != g.nodeID(b.to) {
			return g.nodeID(a.to) < g.nodeID(b.to)
		}
		return a.evidenceKey < b.evidenceKey
	})
	if len(edgeIndexes) > ResourceMapMaxEdges {
		edgeIndexes = edgeIndexes[:ResourceMapMaxEdges]
		reasons = append(reasons, "edge limit")
	}
	edges := make([]ResourceMapEdge, 0, len(edgeIndexes))
	for _, edge := range edgeIndexes {
		from, to := g.nodeID(edge.from), g.nodeID(edge.to)
		typeValue := edge.typeValue
		source, evidence := edge.source, cloneResourceMapEvidence(edge.evidence)
		if typeValue == ResourceMapEdgeOwner {
			source = dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: "metadata.ownerReferences"}
			evidence = dto.ResourceRelationshipEvidenceDTO{Description: "ownerReference"}
		} else if typeValue == ResourceMapEdgeNamespace {
			source = dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceProduct, FieldPath: "metadata.namespace"}
			evidence = dto.ResourceRelationshipEvidenceDTO{Description: "namespace containment"}
		}
		e := ResourceMapEdge{From: from, To: to, Type: typeValue, Source: source, Evidence: evidence, Confidence: edge.confidence, Resolved: edge.resolved}
		e.ID = stableParts(g.context, string(e.Type), e.From, e.To, resourceMapEvidenceKey(e.Source, e.Evidence))
		edges = append(edges, e)
	}
	return nodes, edges, totalNodes, totalEdges, reasons
}

func cloneResourceMapEvidence(evidence dto.ResourceRelationshipEvidenceDTO) dto.ResourceRelationshipEvidenceDTO {
	cloned := evidence
	if evidence.Selector != nil {
		cloned.Selector = make(map[string]string, len(evidence.Selector))
		for key, value := range evidence.Selector {
			cloned.Selector[key] = value
		}
	}
	return cloned
}

func (g *compactResourceGraph) nodeLess(a, b int, depths map[int]int, directions map[int]ResourceMapDirection) bool {
	if depths[a] != depths[b] {
		return depths[a] < depths[b]
	}
	if directions[a] != directions[b] {
		return directions[a] < directions[b]
	}
	x, y := g.nodeIdentity(a), g.nodeIdentity(b)
	if cmp := compareEncodedLowerPart(x.Kind, y.Kind); cmp != 0 {
		return cmp < 0
	}
	if cmp := compareEncodedPart(x.Namespace, y.Namespace); cmp != 0 {
		return cmp < 0
	}
	if cmp := compareEncodedPart(x.Name, y.Name); cmp != 0 {
		return cmp < 0
	}
	if g.nodes[a].record < 0 || g.nodes[b].record < 0 {
		return compareEncodedPart(g.nodeID(a), g.nodeID(b)) < 0
	}
	return comparePresentNodeID(g.context, x, y) < 0
}

func comparePresentNodeID(context string, a, b dto.ResourceIdentityDTO) int {
	aLen := resourceMapCanonicalLen(a)
	bLen := resourceMapCanonicalLen(b)
	aTotal := decimalDigits(len(context)) + 1 + len(context) + decimalDigits(aLen) + 1 + aLen
	bTotal := decimalDigits(len(context)) + 1 + len(context) + decimalDigits(bLen) + 1 + bLen
	if cmp := compareDecimalLex(aTotal, bTotal); cmp != 0 {
		return cmp
	}
	if cmp := compareDecimalLex(aLen, bLen); cmp != 0 {
		return cmp
	}
	aParts := [...]string{a.Group, a.Version, a.Resource, a.Kind, string(a.Scope), a.Namespace, a.Name, a.UID}
	bParts := [...]string{b.Group, b.Version, b.Resource, b.Kind, string(b.Scope), b.Namespace, b.Name, b.UID}
	for i := range aParts {
		if cmp := compareEncodedPart(aParts[i], bParts[i]); cmp != 0 {
			return cmp
		}
	}
	return 0
}

func resourceMapCanonicalLen(identity dto.ResourceIdentityDTO) int {
	length := 0
	parts := [...]string{identity.Group, identity.Version, identity.Resource, identity.Kind, string(identity.Scope), identity.Namespace, identity.Name, identity.UID}
	for _, part := range parts {
		length += decimalDigits(len(part)) + 1 + len(part)
	}
	return length
}

func compareEncodedPart(a, b string) int {
	if a == b {
		return 0
	}
	if len(a) != len(b) {
		if cmp := compareDecimalLex(len(a), len(b)); cmp != 0 {
			return cmp
		}
	}
	return strings.Compare(a, b)
}

func compareEncodedLowerPart(a, b string) int {
	if a == b {
		return 0
	}
	if len(a) != len(b) {
		if cmp := compareDecimalLex(len(a), len(b)); cmp != 0 {
			return cmp
		}
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		x, y := asciiLower(a[i]), asciiLower(b[i])
		if x < y {
			return -1
		}
		if x > y {
			return 1
		}
	}
	return 0
}

func asciiLower(value byte) byte {
	if value >= 'A' && value <= 'Z' {
		return value + ('a' - 'A')
	}
	return value
}

func compareDecimalLex(a, b int) int {
	ad, bd := decimalDivisor(a), decimalDivisor(b)
	for ad > 0 && bd > 0 {
		x, y := (a/ad)%10, (b/bd)%10
		if x < y {
			return -1
		}
		if x > y {
			return 1
		}
		ad /= 10
		bd /= 10
	}
	if ad > 0 {
		return 1
	}
	if bd > 0 {
		return -1
	}
	return 0
}

func decimalDivisor(value int) int {
	divisor := 1
	for value >= 10 {
		value /= 10
		divisor *= 10
	}
	return divisor
}

func resourceMapNodeID(context string, identity dto.ResourceIdentityDTO) string {
	canonicalLen := resourceMapCanonicalLen(identity)
	parts := [...]string{identity.Group, identity.Version, identity.Resource, identity.Kind, string(identity.Scope), identity.Namespace, identity.Name, identity.UID}
	var b strings.Builder
	b.Grow(decimalDigits(len(context)) + 1 + len(context) + decimalDigits(canonicalLen) + 1 + canonicalLen)
	writeStablePart(&b, context)
	b.WriteString(strconv.Itoa(canonicalLen))
	b.WriteByte(':')
	for _, part := range parts {
		writeStablePart(&b, part)
	}
	return b.String()
}

func writeStablePart(b *strings.Builder, value string) {
	b.WriteString(strconv.Itoa(len(value)))
	b.WriteByte(':')
	b.WriteString(value)
}

func decimalDigits(value int) int {
	digits := 1
	for value >= 10 {
		value /= 10
		digits++
	}
	return digits
}

func stableParts(parts ...string) string {
	var b strings.Builder
	for _, part := range parts {
		writeStablePart(&b, part)
	}
	return b.String()
}

func sortedUnique(values []string) []string {
	m := map[string]bool{}
	for _, value := range values {
		m[value] = true
	}
	out := make([]string, 0, len(m))
	for value := range m {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
