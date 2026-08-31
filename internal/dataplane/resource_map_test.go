package dataplane

import (
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func resourceMapIdentity(group, version, resource, kind, namespace, name, uid string) dto.ResourceIdentityDTO {
	scope := dto.ResourceScopeNamespaced
	if namespace == "" {
		scope = dto.ResourceScopeCluster
	}
	return dto.ResourceIdentityDTO{Group: group, Version: version, Resource: resource, Kind: kind, Scope: scope, Namespace: namespace, Name: name, UID: uid}
}

func testResourceMapRecord(identity dto.ResourceIdentityDTO, owners ...dto.ResourceOwnerReferenceDTO) dto.ResourceRelationshipRecord {
	return dto.ResourceRelationshipRecord{Version: 1, Resource: identity, Owners: owners, Coverage: dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}}
}

func resourceMapMeta() SnapshotMetadata {
	return SnapshotMetadata{ObservedAt: time.Unix(100, 0).UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Completeness: CompletenessClassComplete}
}

func completeEmptyResourceMapRelationshipMetadata() *dto.ResourceRelationshipSnapshotMetadata {
	return completeResourceMapRelationshipMetadata(0, 0)
}

func completeResourceMapRelationshipMetadata(sourceItems, evidenceRecords int) *dto.ResourceRelationshipSnapshotMetadata {
	return &dto.ResourceRelationshipSnapshotMetadata{
		Version:         dto.ResourceRelationshipSnapshotMetadataVersion,
		SourceItems:     sourceItems,
		EvidenceRecords: evidenceRecords,
		FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
			dto.ResourceRelationshipFamilyOwner: {Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
		},
	}
}

func completeResourceMapRelationshipMetadataFor(sourceItems, evidenceRecords int, families ...dto.ResourceRelationshipFamily) *dto.ResourceRelationshipSnapshotMetadata {
	metadata := completeResourceMapRelationshipMetadata(sourceItems, evidenceRecords)
	for _, family := range families {
		metadata.FamilyCoverage[family] = dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	}
	return metadata
}

func testExplicitResourceMapReference(referenceType dto.ResourceRelationshipType, target dto.ResourceIdentityDTO, fieldPath, description string) dto.ResourceReferenceDTO {
	return dto.ResourceReferenceDTO{
		Type:     referenceType,
		Target:   target,
		Source:   dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: fieldPath},
		Evidence: dto.ResourceRelationshipEvidenceDTO{Description: description},
		Coverage: dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
	}
}

func testExplicitResourceMapRecord(identity dto.ResourceIdentityDTO, references ...dto.ResourceReferenceDTO) dto.ResourceRelationshipRecord {
	record := testResourceMapRecord(identity)
	record.References = references
	record.FamilyCoverage = map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{}
	for _, reference := range references {
		family, _, ok := explicitResourceMapReferenceType(reference.Type)
		if ok {
			record.FamilyCoverage[family] = dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
		}
	}
	return record
}

func testSelectorResourceMapRecord(identity dto.ResourceIdentityDTO, labels map[string]string, selectors ...dto.ResourceRelationshipSelectorDTO) dto.ResourceRelationshipRecord {
	record := testResourceMapRecord(identity)
	record.Labels = labels
	record.Selectors = selectors
	record.FamilyCoverage = map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{}
	if identity.Group == "" && identity.Version == "v1" && identity.Resource == "pods" && identity.Kind == "Pod" {
		record.FamilyCoverage[dto.ResourceRelationshipFamilyLabels] = dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	}
	if identity.Group == "" && identity.Version == "v1" && identity.Resource == "services" && identity.Kind == "Service" {
		record.FamilyCoverage[dto.ResourceRelationshipFamilySelector] = dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	}
	return record
}

func testServicePodSelector(matchLabels map[string]string, fieldPath string) dto.ResourceRelationshipSelectorDTO {
	return dto.ResourceRelationshipSelectorDTO{
		Target:      dto.ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced},
		Source:      dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: fieldPath},
		MatchLabels: matchLabels,
		Coverage:    dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
	}
}

func testResourceMapLabelMap(entries int, large bool) map[string]string {
	labels := make(map[string]string, entries)
	for i := 0; i < entries; i++ {
		key := fmt.Sprintf("key-%02d", i)
		value := "value"
		if large {
			key = fmt.Sprintf("%s-%02d/name-%02d", strings.Repeat("a", 240), i, i)
			value = strings.Repeat("v", 63)
		}
		labels[key] = value
	}
	return labels
}

func TestResourceMapServicePodSelectorProjectionBothDirections(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	service := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
	matching := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-1", "pod-1")
	nonmatching := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-2", "pod-2")
	selector := testServicePodSelector(map[string]string{"app": "api", "tier": "backend"}, "spec.selector")
	setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{
		Items:                make([]dto.ServiceListItemDTO, 1),
		Meta:                 resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(service, nil, selector)},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilySelector),
	})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{
		Items: make([]dto.PodListItemDTO, 2), Meta: resourceMapMeta(),
		Relationships: []dto.ResourceRelationshipRecord{
			testSelectorResourceMapRecord(matching, map[string]string{"app": "api", "tier": "backend", "extra": "kept-internal"}),
			testSelectorResourceMapRecord(nonmatching, map[string]string{"app": "api", "tier": "frontend"}),
		},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2, dto.ResourceRelationshipFamilyLabels),
	})

	for _, check := range []struct {
		name          string
		target        dto.ResourceIdentityDTO
		other         dto.ResourceIdentityDTO
		wantDirection ResourceMapDirection
	}{
		{name: "service child", target: service, other: matching, wantDirection: ResourceMapDirectionChild},
		{name: "pod parent", target: matching, other: service, wantDirection: ResourceMapDirectionParent},
	} {
		t.Run(check.name, func(t *testing.T) {
			got, err := plane.ResourceMap(ResourceMapRequest{Target: check.target})
			if err != nil {
				t.Fatal(err)
			}
			edge := findResourceMapEdge(got, ResourceMapEdgeSelector, resourceMapNodeID("ctx", service), resourceMapNodeID("ctx", matching))
			node := findResourceMapNode(got, check.other)
			if edge == nil || !edge.Resolved || edge.Confidence != ResourceMapEdgeConfidenceExact || edge.Source.Type != dto.ResourceRelationshipSourceKubernetes || edge.Source.FieldPath != "spec.selector" || edge.Evidence.Description != "label selector" || edge.Evidence.Selector["app"] != "api" || edge.Evidence.Selector["tier"] != "backend" {
				t.Fatalf("selector edge = %+v; edges=%+v coverage=%+v", edge, got.Edges, got.Coverage)
			}
			if node == nil || node.Direction != check.wantDirection || responseHasNode(got, resourceMapNodeID("ctx", nonmatching)) {
				t.Fatalf("selector nodes = %+v", got.Nodes)
			}
			for _, projected := range got.Nodes {
				encoded, marshalErr := json.Marshal(projected)
				if marshalErr != nil || strings.Contains(string(encoded), "kept-internal") || strings.Contains(string(encoded), "labels") {
					t.Fatalf("labels leaked through node JSON: %s (%v)", encoded, marshalErr)
				}
			}
		})
	}
}

func TestResourceMapTargetScopedFreshnessAndObservationRange(t *testing.T) {
	tests := []struct {
		name           string
		setup          func(*clusterPlane)
		wantFreshness  FreshnessClass
		wantOldestUnix int64
		wantNewestUnix int64
	}{
		{
			name: "all hot",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
			},
			wantFreshness: FreshnessClassHot, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "hot and warm",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = FreshnessClassWarm
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassWarm, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "hot and cold",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = FreshnessClassCold
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassCold, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "persisted stale is worst known",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = FreshnessClassStale
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassStale, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "missing required snapshot",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				clearNamespacedSnapshot(&plane.podsStore, "b")
			},
			wantFreshness: FreshnessClassUnknown, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "unknown outranks persisted stale",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				stale := resourceMapMeta()
				stale.Freshness = FreshnessClassStale
				setClusterSnapshot(&plane.nodesStore, NodesSnapshot{Meta: stale, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
				clearNamespacedSnapshot(&plane.podsStore, "b")
			},
			wantFreshness: FreshnessClassUnknown, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "zero freshness is unknown",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = ""
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassUnknown, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "explicit unknown is worst",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = FreshnessClassUnknown
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassUnknown, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "unrelated stale namespace ignored",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				meta := resourceMapMeta()
				meta.Freshness = FreshnessClassStale
				meta.ObservedAt = time.Unix(1, 0).UTC()
				setNamespacedSnapshot(&plane.podsStore, "a", PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassHot, wantOldestUnix: 100, wantNewestUnix: 100,
		},
		{
			name: "oldest and newest observation range",
			setup: func(plane *clusterPlane) {
				seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
				oldest := resourceMapMeta()
				oldest.ObservedAt = time.Unix(50, 0).UTC()
				setClusterSnapshot(&plane.nodesStore, NodesSnapshot{Meta: oldest, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
				newest := resourceMapMeta()
				newest.ObservedAt = time.Unix(150, 0).UTC()
				setNamespacedSnapshot(&plane.podsStore, "b", PodsSnapshot{Meta: newest, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
			},
			wantFreshness: FreshnessClassHot, wantOldestUnix: 50, wantNewestUnix: 150,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			tt.setup(plane)
			got, err := plane.ResourceMap(ResourceMapRequest{Target: resourceMapIdentity("", "v1", "pods", "Pod", "b", "missing", "")})
			if err != nil {
				t.Fatal(err)
			}
			if got.Cache.Freshness != tt.wantFreshness || got.Cache.OldestObservedAt.Unix() != tt.wantOldestUnix || got.Cache.ObservedAt.Unix() != tt.wantNewestUnix {
				t.Fatalf("cache metadata = %+v, want freshness=%q range=%d..%d", got.Cache, tt.wantFreshness, tt.wantOldestUnix, tt.wantNewestUnix)
			}
			missingEvidence := tt.name == "missing required snapshot" || tt.name == "unknown outranks persisted stale"
			if missingEvidence {
				if got.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete || got.Target.Availability != ResourceMapAvailabilityUnknown {
					t.Fatalf("missing evidence did not remain partial/unknown: target=%+v coverage=%+v", got.Target, got.Coverage)
				}
			} else if got.Coverage.Coverage != dto.ResourceRelationshipCoverageFull || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
				t.Fatalf("freshness degraded independent full/complete coverage: freshness=%q coverage=%+v", got.Cache.Freshness, got.Coverage)
			}
			encoded, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(encoded, &body); err != nil {
				t.Fatal(err)
			}
			cache, ok := body["cache"].(map[string]any)
			if !ok || cache["freshness"] != string(tt.wantFreshness) || cache["observedAt"] == nil || cache["oldestObservedAt"] == nil {
				t.Fatalf("cache JSON fields missing or incorrect: %s", encoded)
			}
		})
	}
}

func TestResourceMapOwnerChainDepthDirectionAndDeterminism(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	deployment := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "dep")
	replicaSet := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "api-abc", "rs")
	pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-abc-1", "pod")
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(deployment)}})
	setNamespacedSnapshot(&plane.rsStore, "apps", ReplicaSetsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(replicaSet, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api", UID: "dep"})}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(pod, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-abc", UID: "rs"})}})

	first, err := plane.ResourceMap(ResourceMapRequest{Target: deployment, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	second, err := plane.ResourceMap(ResourceMapRequest{Target: deployment, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Nodes) != 4 || len(first.Edges) != 3 {
		t.Fatalf("graph = %d nodes, %d edges; want 4, 3: %+v", len(first.Nodes), len(first.Edges), first)
	}
	if first.Nodes[0].Identity.UID != "dep" || first.Nodes[0].Depth != 0 || !first.Nodes[0].Current {
		t.Fatalf("center = %+v", first.Nodes[0])
	}
	byUID := map[string]ResourceMapNode{}
	for _, node := range first.Nodes {
		byUID[node.Identity.UID] = node
	}
	if byUID["rs"].Depth != 1 || byUID["rs"].Direction != ResourceMapDirectionChild {
		t.Fatalf("depth-one child = %+v", byUID["rs"])
	}
	if byUID["pod"].Depth != 2 {
		t.Fatalf("depth-two child = %+v", byUID["pod"])
	}
	owners := 0
	for _, edge := range first.Edges {
		if edge.Type == ResourceMapEdgeOwner {
			owners++
		}
	}
	if owners != 2 {
		t.Fatalf("owner edge count = %d, want 2", owners)
	}
	if resourceMapSignature(first) != resourceMapSignature(second) {
		t.Fatalf("projection is nondeterministic")
	}
}

func TestResourceMapNamespaceContainmentReverseChildrenAndMissingNamespace(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	namespace := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "ns")
	pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api", "pod")
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(namespace)}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(pod)}})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: namespace})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 2 || len(got.Edges) != 1 || got.Edges[0].Type != ResourceMapEdgeNamespace || !got.Edges[0].Resolved {
		t.Fatalf("namespace graph = %+v", got)
	}

	missingPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	setNamespacedSnapshot(&missingPlane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(pod)}})
	got, err = missingPlane.ResourceMap(ResourceMapRequest{Target: pod})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 2 || got.Nodes[1].Availability != ResourceMapAvailabilityMissing || got.Nodes[1].Navigable {
		t.Fatalf("missing namespace node = %+v", got.Nodes)
	}
}

func TestResourceMapNamespaceContainmentDoesNotExpandPodToSiblings(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	namespace := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "ns")
	target := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "target", "target-pod")
	sibling := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "sibling", "sibling-pod")
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(namespace)}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(target), testResourceMapRecord(sibling)}})

	got, err := plane.ResourceMap(ResourceMapRequest{Target: target, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 2 || len(got.Edges) != 1 || got.Edges[0].Type != ResourceMapEdgeNamespace {
		t.Fatalf("pod graph expanded through namespace containment: %+v", got)
	}
	for _, node := range got.Nodes {
		if node.Identity.UID == sibling.UID {
			t.Fatalf("namespace sibling leaked into focused pod graph: %+v", got)
		}
	}
}

func TestResourceMapDependencyDoesNotExpandToOtherConsumers(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	target := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "target", "target-pod")
	configMap := resourceMapIdentity("", "v1", "configmaps", "ConfigMap", "apps", "shared", "shared-config")
	otherConsumer := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "other", "other-rs")
	configReference := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, configMap, "spec.volumes[0].configMap.name", "configMap volume")
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(target, configReference)}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.cmsStore, "apps", ConfigMapsSnapshot{Items: make([]dto.ConfigMapDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(configMap)}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.rsStore, "apps", ReplicaSetsSnapshot{Items: make([]dto.ReplicaSetDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(otherConsumer, configReference)}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})

	got, err := plane.ResourceMap(ResourceMapRequest{Target: target, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range got.Nodes {
		if node.Identity.UID == otherConsumer.UID {
			t.Fatalf("shared dependency expanded to unrelated consumer: %+v", got)
		}
	}
	if len(got.Nodes) != 3 || len(got.Edges) != 2 {
		t.Fatalf("focused dependency graph = %+v", got)
	}
}

func TestResourceMapUIDCollisionAPIVersionAndMissingOwner(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	oldDep := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "old")
	newDep := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "new")
	rs := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "api-rs", "rs")
	orphan := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "orphan", "pod")
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(oldDep), testResourceMapRecord(newDep)}})
	setNamespacedSnapshot(&plane.rsStore, "apps", ReplicaSetsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(rs, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api", UID: "old"})}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(orphan, dto.ResourceOwnerReferenceDTO{APIVersion: "batch/v1", Kind: "Job", Name: "gone", UID: "gone"})}})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: oldDep})
	if err != nil {
		t.Fatal(err)
	}
	ownerEdges := 0
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeOwner {
			ownerEdges++
		}
	}
	if ownerEdges != 1 {
		t.Fatalf("UID-specific owner resolution = %+v", got)
	}
	got, err = plane.ResourceMap(ResourceMapRequest{Target: orphan})
	if err != nil {
		t.Fatal(err)
	}
	var missing *ResourceMapNode
	for i := range got.Nodes {
		if got.Nodes[i].Identity.Kind == "Job" {
			missing = &got.Nodes[i]
		}
	}
	if missing == nil || missing.Identity.Group != "batch" || missing.Identity.Version != "v1" || missing.Availability != ResourceMapAvailabilityMissing || missing.Navigable {
		t.Fatalf("missing owner = %+v", got.Nodes)
	}
}

func TestResourceMapCacheMissAmbiguousFallbackAndCycle(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	miss := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "missing", "")
	got, err := plane.ResourceMap(ResourceMapRequest{Target: miss})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 1 || got.Nodes[0].Availability != ResourceMapAvailabilityUnknown || got.Nodes[0].Navigable || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessUnknown {
		t.Fatalf("cache miss = %+v", got)
	}

	a := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "same", "a")
	b := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "same", "b")
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(a), testResourceMapRecord(b)}})
	ambiguousTarget := a
	ambiguousTarget.UID = ""
	got, err = plane.ResourceMap(ResourceMapRequest{Target: ambiguousTarget})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Coverage.AmbiguousTarget || got.Nodes[0].Availability != ResourceMapAvailabilityUnknown {
		t.Fatalf("ambiguous fallback = %+v", got)
	}

	cyclePlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	x := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "x", "x")
	y := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "y", "y")
	setNamespacedSnapshot(&cyclePlane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(x, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "y", UID: "y"})}})
	setNamespacedSnapshot(&cyclePlane.rsStore, "apps", ReplicaSetsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(y, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "x", UID: "x"})}})
	got, err = cyclePlane.ResourceMap(ResourceMapRequest{Target: x, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 3 || len(got.Edges) != 3 {
		t.Fatalf("cycle graph = %+v", got)
	}
}

func TestResourceMapNodeAndScanCapsAndCompletenessEvidence(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	ns := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "ns")
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(ns)}})
	records := make([]dto.ResourceRelationshipRecord, ResourceMapMaxNodes+5)
	for i := range records {
		records[i] = testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "apps", "pod-"+string(rune(1000+i)), "uid-"+string(rune(1000+i))))
	}
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: records})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: ns})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != ResourceMapMaxNodes || !got.Truncated || !containsString(got.TruncationReasons, "node limit") {
		t.Fatalf("node cap = %d, truncation=%v reasons=%v", len(got.Nodes), got.Truncated, got.TruncationReasons)
	}

	collector := resourceMapCollector{reasons: map[string]struct{}{}}
	collector.snapshot("pods/apps", ResourceMapMaxScannedRecords+1, ResourceMapMaxScannedRecords+1, make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords+1), nil, resourceMapMeta(), true)
	if collector.meta.ScannedRecords != ResourceMapMaxScannedRecords || !collector.truncated {
		t.Fatalf("scan cap = %+v", collector)
	}

	allNamespaces := make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords+1)
	for i := range allNamespaces {
		allNamespaces[i] = testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "unrelated", fmt.Sprintf("pod-%d", i), fmt.Sprintf("uid-%d", i)))
	}
	allNamespaces[len(allNamespaces)-1] = testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "target", "after-cap", "target-uid"))
	filtered := resourceMapCollector{reasons: map[string]struct{}{}}
	filtered.snapshotFiltered("pods/*", len(allNamespaces), len(allNamespaces), allNamespaces, nil, resourceMapMeta(), true, "target", true)
	if filtered.meta.ScannedRecords != ResourceMapMaxScannedRecords || !filtered.truncated || len(filtered.records) != 0 {
		t.Fatalf("all-namespace scan cap did not bound examined records: scanned=%d truncated=%v retained=%d", filtered.meta.ScannedRecords, filtered.truncated, len(filtered.records))
	}

	legacyPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	setNamespacedSnapshot(&legacyPlane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Items: make([]dto.PodListItemDTO, 1)})
	legacy, err := legacyPlane.ResourceMap(ResourceMapRequest{Target: resourceMapIdentity("", "v1", "pods", "Pod", "apps", "legacy", "")})
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete || !reasonContains(legacy.Coverage.Reasons, "legacy snapshot") {
		t.Fatalf("legacy coverage = %+v", legacy.Coverage)
	}

	partialPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	partial := resourceMapMeta()
	partial.Coverage = CoverageClassPartial
	partial.Completeness = CompletenessClassInexact
	setNamespacedSnapshot(&partialPlane.podsStore, "apps", PodsSnapshot{Meta: partial})
	partialGot, err := partialPlane.ResourceMap(ResourceMapRequest{Target: missIdentity()})
	if err != nil {
		t.Fatal(err)
	}
	if partialGot.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete || !reasonContains(partialGot.Coverage.Reasons, "inexact snapshot") {
		t.Fatalf("partial coverage = %+v", partialGot.Coverage)
	}
}

func TestResourceMapTargetNamespaceScopedInventory(t *testing.T) {
	targetB := resourceMapIdentity("", "v1", "pods", "Pod", "b", "missing", "")

	onlyA := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventoryForNamespace(onlyA, "a")
	got, err := onlyA.ResourceMap(ResourceMapRequest{Target: targetB})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Availability != ResourceMapAvailabilityUnknown || got.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete || !reasonContains(got.Coverage.Reasons, "missing target namespace snapshot: pods/b") {
		t.Fatalf("namespace A inventory proved namespace B absence: %+v", got)
	}

	withB := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventoryForNamespace(withB, "b")
	got, err = withB.ResourceMap(ResourceMapRequest{Target: targetB})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Availability != ResourceMapAvailabilityMissing || got.Coverage.Coverage != dto.ResourceRelationshipCoverageFull || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("complete namespace B inventory was not authoritative: %+v", got)
	}
}

func TestResourceMapAllNamespacesSnapshotFiltersToTargetNamespace(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyClusterResourceMapInventory(plane)
	seedCompleteEmptyResourceMapAllNamespacesInventory(plane)
	ownerB := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "b", "api", "dep-b")
	podB := resourceMapIdentity("", "v1", "pods", "Pod", "b", "api-1", "pod-b")
	podA := resourceMapIdentity("", "v1", "pods", "Pod", "a", "unrelated", "pod-a")
	setNamespacedSnapshot(&plane.depsStore, "", DeploymentsSnapshot{Items: make([]dto.DeploymentListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(ownerB)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.podsStore, "", PodsSnapshot{Items: make([]dto.PodListItemDTO, 2), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
		testSelectorResourceMapRecord(podA, nil),
		func() dto.ResourceRelationshipRecord {
			record := testSelectorResourceMapRecord(podB, nil)
			record.Owners = []dto.ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "Deployment", Name: "api", UID: "dep-b"}}
			return record
		}(),
	}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2, dto.ResourceRelationshipFamilyLabels)})

	got, err := plane.ResourceMap(ResourceMapRequest{Target: podB})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Target.Resolved || got.Cache.ScannedRecords != 3 || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("all-namespaces target filtering metadata = %+v", got)
	}
	for _, node := range got.Nodes {
		if node.Identity.Namespace == "a" {
			t.Fatalf("unrelated namespace node leaked from all-namespaces cell: %+v", node)
		}
	}
	ownerResolved := false
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeOwner && edge.Resolved {
			ownerResolved = true
		}
	}
	if !ownerResolved {
		t.Fatalf("same-namespace owner was discarded: %+v", got)
	}
}

func TestResourceMapNamespaceAndClusterTargetInventoryScope(t *testing.T) {
	namespaceB := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "b", "")
	onlyA := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventoryForNamespace(onlyA, "a")
	got, err := onlyA.ResourceMap(ResourceMapRequest{Target: namespaceB})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Availability != ResourceMapAvailabilityUnknown || !reasonContains(got.Coverage.Reasons, "missing target namespace snapshot: pods/b") {
		t.Fatalf("namespace target did not require child inventory for its namespace: %+v", got)
	}

	clusterOnly := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyClusterResourceMapInventory(clusterOnly)
	missingNode := resourceMapIdentity("", "v1", "nodes", "Node", "", "missing", "")
	got, err = clusterOnly.ResourceMap(ResourceMapRequest{Target: missingNode})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Availability != ResourceMapAvailabilityMissing || got.Coverage.Coverage != dto.ResourceRelationshipCoverageFull || got.Cache.SnapshotsMissing != 0 {
		t.Fatalf("non-Namespace cluster target required arbitrary namespace inventory: %+v", got)
	}
}

func TestResourceMapIgnoresUnrelatedNamespaceFanout(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventoryForNamespace(plane, "b")
	fanout := make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords+1)
	for i := range fanout {
		fanout[i] = testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "a", fmt.Sprintf("pod-%05d", i), fmt.Sprintf("a-%05d", i)))
	}
	setNamespacedSnapshot(&plane.podsStore, "a", PodsSnapshot{Meta: resourceMapMeta(), Relationships: fanout})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: resourceMapIdentity("", "v1", "pods", "Pod", "b", "missing", "")})
	if err != nil {
		t.Fatal(err)
	}
	if got.Truncated || got.Cache.ScannedRecords != 0 || got.Target.Availability != ResourceMapAvailabilityMissing || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("unrelated namespace consumed scan budget or degraded coverage: %+v", got)
	}
}

func TestResourceMapStoreInventoryAndExclusions(t *testing.T) {
	fset := token.NewFileSet()
	resourceMapFile := parseResourceMapFile(t, fset, "resource_map.go")
	managerFile := parseResourceMapFile(t, fset, "manager.go")

	included := map[string]bool{}
	ast.Inspect(resourceMapFile, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		fun, ok := call.Fun.(*ast.Ident)
		if !ok {
			return true
		}
		wantArgs := 0
		switch fun.Name {
		case "collectClusterResourceMap", "collectClusterCustomResourceMap":
			wantArgs = 3
		case "collectNamespacedResourceMap", "collectNamespacedCustomResourceMap":
			wantArgs = 4
		default:
			return true
		}
		if len(call.Args) != wantArgs {
			t.Errorf("%s has %d arguments, want %d", fun.Name, len(call.Args), wantArgs)
			return true
		}
		unary, ok := call.Args[2].(*ast.UnaryExpr)
		if !ok || unary.Op != token.AND {
			t.Errorf("%s store argument is not an addressable cache field", fun.Name)
			return true
		}
		selector, ok := unary.X.(*ast.SelectorExpr)
		if !ok {
			t.Errorf("%s store argument is not a selector", fun.Name)
			return true
		}
		if included[selector.Sel.Name] {
			t.Errorf("store %s included more than once", selector.Sel.Name)
		}
		included[selector.Sel.Name] = true
		return true
	})

	snapshotFields := clusterPlaneSnapshotFields(t, managerFile)
	excluded := map[string]bool{
		"helmReleasesStore": true, // product/Helm inventory, not a real Kubernetes list DTO
		"nodeMetricsStore":  true, // optional short-TTL metrics, never persisted
		"podMetricsStore":   true, // optional short-TTL metrics, never persisted
	}
	expectedIncluded := []string{"clusterCustomResourcesStore", "clusterRoleBindingsStore", "clusterRolesStore", "cmsStore", "crdsStore", "customResourcesStore", "depsStore", "dsStore", "hpaStore", "ingStore", "jobsStore", "lrStore", "networkPoliciesStore", "nodesStore", "nsStore", "persistentVolumesStore", "podsStore", "pvcsStore", "roleBindingsStore", "rolesStore", "rqStore", "rsStore", "saStore", "secsStore", "stsStore", "svcsStore", "cjStore"}
	sort.Strings(expectedIncluded)
	actualIncluded := sortedMapKeys(included)
	if strings.Join(actualIncluded, ",") != strings.Join(expectedIncluded, ",") {
		t.Fatalf("real-resource store inventory mismatch\n got: %v\nwant: %v", actualIncluded, expectedIncluded)
	}
	classified := map[string]bool{}
	for field := range included {
		classified[field] = true
	}
	for field := range excluded {
		classified[field] = true
	}
	if got, want := sortedMapKeys(classified), sortedMapKeys(snapshotFields); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("clusterPlane snapshot fields must all be explicitly included or excluded\nclassified: %v\n    fields: %v", got, want)
	}
	for field := range excluded {
		if included[field] {
			t.Errorf("excluded store %s included", field)
		}
	}
}

func TestResourceMapDepthBoundaryAndCycleTruncation(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	records := make([]dto.ResourceRelationshipRecord, 4)
	for i := range records {
		identity := resourceMapIdentity("example.io", "v1", fmt.Sprintf("things%d", i), fmt.Sprintf("Thing%d", i), "", fmt.Sprintf("n%d", i), fmt.Sprintf("u%d", i))
		if i == 0 {
			records[i] = testResourceMapRecord(identity)
		} else {
			records[i] = testResourceMapRecord(identity, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: fmt.Sprintf("Thing%d", i-1), Name: fmt.Sprintf("n%d", i-1), UID: fmt.Sprintf("u%d", i-1)})
		}
	}
	setClusterSnapshot(&plane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: records})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: records[0].Resource, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 3 || len(got.Edges) != 2 || !containsString(got.TruncationReasons, "depth_limit") {
		t.Fatalf("depth-bounded chain = %+v", got)
	}
	for _, node := range got.Nodes {
		if node.Identity.UID == "u3" {
			t.Fatalf("beyond-depth node leaked: %+v", node)
		}
	}

	cyclePlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	a, b, c := records[0].Resource, records[1].Resource, records[2].Resource
	cycle := []dto.ResourceRelationshipRecord{
		testResourceMapRecord(a, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: c.Kind, Name: c.Name, UID: c.UID}),
		testResourceMapRecord(b, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: a.Kind, Name: a.Name, UID: a.UID}),
		testResourceMapRecord(c, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: b.Kind, Name: b.Name, UID: b.UID}),
	}
	setClusterSnapshot(&cyclePlane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: cycle})
	got, err = cyclePlane.ResourceMap(ResourceMapRequest{Target: a, Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if containsString(got.TruncationReasons, "depth_limit") {
		t.Fatalf("closed cycle falsely depth-truncated: %+v", got)
	}
}

func TestResourceMapExactPreCapTotalsAndEdgeCap(t *testing.T) {
	fanoutPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	ns := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "ns")
	setClusterSnapshot(&fanoutPlane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(ns)}})
	fanout := make([]dto.ResourceRelationshipRecord, ResourceMapMaxNodes+5)
	for i := range fanout {
		fanout[i] = testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "apps", fmt.Sprintf("pod-%03d", i), fmt.Sprintf("pod-%03d", i)))
	}
	setNamespacedSnapshot(&fanoutPlane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: fanout})
	got, err := fanoutPlane.ResourceMap(ResourceMapRequest{Target: ns})
	if err != nil {
		t.Fatal(err)
	}
	if got.Cache.TotalNodes != len(fanout)+1 || got.Cache.TotalEdges != len(fanout) || got.Cache.ReturnedNodes != ResourceMapMaxNodes || got.Cache.ReturnedEdges != ResourceMapMaxNodes-1 {
		t.Fatalf("fan-out totals = %+v", got.Cache)
	}
	if !containsString(got.TruncationReasons, "node limit") {
		t.Fatalf("fan-out truncation reasons = %v", got.TruncationReasons)
	}
	for _, edge := range got.Edges {
		if !responseHasNode(got, edge.From) || !responseHasNode(got, edge.To) {
			t.Fatalf("output edge references omitted node: %+v", edge)
		}
	}

	densePlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	const denseNodes = 21
	denseIDs := make([]dto.ResourceIdentityDTO, denseNodes)
	for i := range denseIDs {
		denseIDs[i] = resourceMapIdentity("example.io", "v1", "things", "Thing", "", fmt.Sprintf("n%02d", i), fmt.Sprintf("u%02d", i))
	}
	denseRecords := make([]dto.ResourceRelationshipRecord, denseNodes)
	for i, identity := range denseIDs {
		owners := make([]dto.ResourceOwnerReferenceDTO, 0, denseNodes-1)
		for j, owner := range denseIDs {
			if i != j {
				owners = append(owners, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: owner.Kind, Name: owner.Name, UID: owner.UID})
			}
		}
		denseRecords[i] = testResourceMapRecord(identity, owners...)
	}
	setClusterSnapshot(&densePlane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: denseRecords})
	got, err = densePlane.ResourceMap(ResourceMapRequest{Target: denseIDs[0], Depth: 2})
	if err != nil {
		t.Fatal(err)
	}
	wantEdges := denseNodes * (denseNodes - 1)
	if got.Cache.TotalNodes != denseNodes || got.Cache.TotalEdges != wantEdges || got.Cache.ReturnedEdges != ResourceMapMaxEdges {
		t.Fatalf("dense graph totals = %+v, want edges=%d", got.Cache, wantEdges)
	}
	if !containsString(got.TruncationReasons, "edge limit") {
		t.Fatalf("dense graph truncation reasons = %v", got.TruncationReasons)
	}
}

func TestResourceMapCanonicalTargetAndFallbacks(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	cached := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "authoritative")
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(cached)}})

	for name, requested := range map[string]dto.ResourceIdentityDTO{
		"exact canonical":      func() dto.ResourceIdentityDTO { r := cached; r.UID = ""; return r }(),
		"unique compatibility": resourceMapIdentity("legacy.example", "v9", "workloads", "Deployment", "apps", "api", ""),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := plane.ResourceMap(ResourceMapRequest{Target: requested})
			if err != nil {
				t.Fatal(err)
			}
			if got.TargetID == "" || got.Target.ID != got.TargetID || !got.Target.Resolved || got.Target.Identity.CanonicalIdentity() != cached.CanonicalIdentity() || got.Target.Requested.CanonicalIdentity() != requested.CanonicalIdentity() || got.Target.Availability != ResourceMapAvailabilityPresent || !got.Target.Navigable {
				t.Fatalf("canonical target = %+v", got.Target)
			}
		})
	}

	other := newClusterPlane("other", "", "", ObservationScope{}, nil, nil, nil)
	setNamespacedSnapshot(&other.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(cached)}})
	first, _ := plane.ResourceMap(ResourceMapRequest{Target: cached})
	second, _ := other.ResourceMap(ResourceMapRequest{Target: cached})
	if first.TargetID == second.TargetID {
		t.Fatalf("resource-map node IDs are not context-bound: %q", first.TargetID)
	}
}

func TestResourceMapOwnerValidationResolutionAndRecordVersion(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "")
	child := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "api-rs", "rs")
	badRecord := testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "apps", "zero", "zero"))
	badRecord.Version = 0
	unsupported := testResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "apps", "future", "future"))
	unsupported.Version = dto.ResourceRelationshipRecordVersion + 1
	malformed := testResourceMapRecord(resourceMapIdentity("", "v1", "", "Pod", "apps", "malformed", "malformed"))
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)}})
	setNamespacedSnapshot(&plane.rsStore, "apps", ReplicaSetsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(child,
		dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api"},
		dto.ResourceOwnerReferenceDTO{Kind: "Deployment", Name: "missing-api-version"},
		dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1/extra", Kind: "Deployment", Name: "malformed-api-version"},
	)}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{badRecord, unsupported, malformed}})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
	if err != nil {
		t.Fatal(err)
	}
	ownerEdges := 0
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeOwner {
			ownerEdges++
			if !edge.Resolved {
				t.Fatalf("valid no-UID owner did not resolve: %+v", edge)
			}
			if edge.Confidence != ResourceMapEdgeConfidenceHigh {
				t.Fatalf("valid no-UID owner confidence = %q, want %q", edge.Confidence, ResourceMapEdgeConfidenceHigh)
			}
		}
	}
	if ownerEdges != 1 || !reasonContains(got.Coverage.Reasons, "malformed owner reference") || !reasonContains(got.Coverage.Reasons, "unsupported relationship record version") || !reasonContains(got.Coverage.Reasons, "malformed relationship record") {
		t.Fatalf("owner/record validation = %+v", got)
	}
	for _, node := range got.Nodes {
		if node.Identity.Name == "zero" || node.Identity.Name == "future" || node.Identity.Name == "malformed" {
			t.Fatalf("unsupported record leaked into graph: %+v", node)
		}
	}

	unresolvedPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	orphan := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "orphan", "orphan")
	setNamespacedSnapshot(&unresolvedPlane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(orphan, dto.ResourceOwnerReferenceDTO{APIVersion: "batch/v1", Kind: "Job", Name: "gone"})}})
	got, err = unresolvedPlane.ResourceMap(ResourceMapRequest{Target: orphan})
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range got.Nodes {
		if node.Identity.Kind == "Job" && (node.Identity.Resource != "" || node.Availability != ResourceMapAvailabilityMissing) {
			t.Fatalf("unresolved owner fabricated canonical resource: %+v", node)
		}
	}
}

func TestResourceMapNoUIDOwnerResolutionScopeAndAmbiguity(t *testing.T) {
	t.Run("ambiguous same-namespace candidates do not fall back to cluster candidate", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		ownerA := resourceMapIdentity("example.io", "v1", "widgets", "Widget", "apps", "api", "owner-a")
		ownerB := resourceMapIdentity("example.io", "v1", "legacywidgets", "Widget", "apps", "api", "owner-b")
		clusterOwner := resourceMapIdentity("example.io", "v1", "clusterwidgets", "Widget", "", "api", "owner-cluster")
		child := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "child", "child")
		setNamespacedSnapshot(&plane.customResourcesStore, "apps", CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
			testResourceMapRecord(ownerA),
			testResourceMapRecord(ownerB),
		}})
		setClusterSnapshot(&plane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(clusterOwner)}})
		setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
			testResourceMapRecord(child, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: "Widget", Name: "api"}),
		}})

		got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
		if err != nil {
			t.Fatal(err)
		}
		for _, edge := range got.Edges {
			if edge.Type == ResourceMapEdgeOwner && edge.Resolved {
				t.Fatalf("ambiguous no-UID owner resolved arbitrarily: %+v", edge)
			}
		}
	})

	t.Run("same namespace candidate is preferred over cluster candidate", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		namespacedOwner := resourceMapIdentity("example.io", "v1", "widgets", "Widget", "apps", "api", "owner-ns")
		clusterOwner := resourceMapIdentity("example.io", "v1", "clusterwidgets", "Widget", "", "api", "owner-cluster")
		child := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "child", "child")
		setNamespacedSnapshot(&plane.customResourcesStore, "apps", CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(namespacedOwner)}})
		setClusterSnapshot(&plane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(clusterOwner)}})
		setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
			testResourceMapRecord(child, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: "Widget", Name: "api"}),
		}})

		got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
		if err != nil {
			t.Fatal(err)
		}
		resolved := false
		for _, edge := range got.Edges {
			if edge.Type == ResourceMapEdgeOwner && edge.Resolved {
				resolved = true
				if edge.From != resourceMapNodeID("ctx", namespacedOwner) {
					t.Fatalf("owner resolved to %q, want same-namespace candidate %q", edge.From, resourceMapNodeID("ctx", namespacedOwner))
				}
			}
		}
		if !resolved {
			t.Fatalf("same-namespace owner did not resolve: %+v", got)
		}
	})

	t.Run("unique cluster owner resolves when same namespace candidate is absent", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		owner := resourceMapIdentity("example.io", "v1", "clusterwidgets", "Widget", "", "global", "owner-cluster")
		child := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "child", "child")
		setClusterSnapshot(&plane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)}})
		setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
			testResourceMapRecord(child, dto.ResourceOwnerReferenceDTO{APIVersion: "example.io/v1", Kind: "Widget", Name: "global"}),
		}})

		got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
		if err != nil {
			t.Fatal(err)
		}
		for _, edge := range got.Edges {
			if edge.Type == ResourceMapEdgeOwner && edge.Resolved && edge.From == resourceMapNodeID("ctx", owner) {
				return
			}
		}
		t.Fatalf("cluster owner did not resolve: %+v", got)
	})
}

func TestResourceMapNamespaceIndexAmbiguityRemainsUnresolved(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	namespaceA := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "ns-a")
	namespaceB := resourceMapIdentity("legacy.example", "v9", "projectnamespaces", "Namespace", "", "apps", "ns-b")
	pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "pod", "pod")
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{
		testResourceMapRecord(namespaceA),
		testResourceMapRecord(namespaceB),
	}})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(pod)}})

	got, err := plane.ResourceMap(ResourceMapRequest{Target: pod})
	if err != nil {
		t.Fatal(err)
	}
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeNamespace {
			if edge.Resolved {
				t.Fatalf("ambiguous Namespace compatibility candidates resolved arbitrarily: %+v", edge)
			}
			return
		}
	}
	t.Fatalf("namespace edge not found: %+v", got)
}

func TestResourceMapOwnerEdgeConfidence(t *testing.T) {
	tests := []struct {
		name           string
		owner          dto.ResourceOwnerReferenceDTO
		includeTarget  bool
		wantEdge       bool
		wantResolved   bool
		wantConfidence ResourceMapEdgeConfidence
	}{
		{
			name:           "UID match resolved exact",
			owner:          dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api", UID: "dep"},
			includeTarget:  true,
			wantEdge:       true,
			wantResolved:   true,
			wantConfidence: ResourceMapEdgeConfidenceExact,
		},
		{
			name:           "no UID unique fallback resolved high",
			owner:          dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api"},
			includeTarget:  true,
			wantEdge:       true,
			wantResolved:   true,
			wantConfidence: ResourceMapEdgeConfidenceHigh,
		},
		{
			name:           "UID target absent unresolved high",
			owner:          dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api", UID: "dep"},
			wantEdge:       true,
			wantConfidence: ResourceMapEdgeConfidenceHigh,
		},
		{
			name:           "no UID target absent unresolved high",
			owner:          dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: "api"},
			wantEdge:       true,
			wantConfidence: ResourceMapEdgeConfidenceHigh,
		},
		{
			name:  "malformed owner skipped",
			owner: dto.ResourceOwnerReferenceDTO{Kind: "Deployment", Name: "api", UID: "dep"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "dep")
			child := resourceMapIdentity("apps", "v1", "replicasets", "ReplicaSet", "apps", "api-rs", "rs")
			if tt.includeTarget {
				setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)}})
			}
			setNamespacedSnapshot(&plane.rsStore, "apps", ReplicaSetsSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(child, tt.owner)}})

			got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
			if err != nil {
				t.Fatal(err)
			}
			var ownerEdges []ResourceMapEdge
			for _, edge := range got.Edges {
				if edge.Type != ResourceMapEdgeOwner {
					continue
				}
				ownerEdges = append(ownerEdges, edge)
				if !edge.Resolved && edge.Confidence == ResourceMapEdgeConfidenceExact {
					t.Fatalf("unresolved owner edge has exact confidence: %+v", edge)
				}
			}
			if !tt.wantEdge {
				if len(ownerEdges) != 0 {
					t.Fatalf("malformed owner produced edges: %+v", ownerEdges)
				}
				return
			}
			if len(ownerEdges) != 1 {
				t.Fatalf("owner edges = %+v, want one", ownerEdges)
			}
			edge := ownerEdges[0]
			if edge.Resolved != tt.wantResolved || edge.Confidence != tt.wantConfidence {
				t.Fatalf("owner edge = %+v, want resolved=%v confidence=%q", edge, tt.wantResolved, tt.wantConfidence)
			}
		})
	}
}

func TestResourceMapCompleteAndPartialEmptyInventory(t *testing.T) {
	completePlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(completePlane)
	requested := missIdentity()
	got, err := completePlane.ResourceMap(ResourceMapRequest{Target: requested})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Resolved || got.Target.Identity.CanonicalIdentity() != requested.CanonicalIdentity() || got.Target.Availability != ResourceMapAvailabilityMissing || got.Target.Navigable || got.Nodes[0].Availability != ResourceMapAvailabilityMissing || got.Coverage.Coverage != dto.ResourceRelationshipCoverageFull || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("complete empty inventory = %+v", got)
	}

	partialPlane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	setNamespacedSnapshot(&partialPlane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta()})
	got, err = partialPlane.ResourceMap(ResourceMapRequest{Target: requested})
	if err != nil {
		t.Fatal(err)
	}
	if got.Target.Availability != ResourceMapAvailabilityUnknown || got.Target.Navigable || got.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("partial empty inventory = %+v", got)
	}
}

func TestResourceMapEmptyRelationshipEnvelopeAuthority(t *testing.T) {
	tests := []struct {
		name         string
		metadata     *dto.ResourceRelationshipSnapshotMetadata
		persist      bool
		want         ResourceMapAvailability
		wantCoverage dto.ResourceRelationshipCoverage
		wantReason   string
	}{
		{name: "peeked legacy empty", want: ResourceMapAvailabilityUnknown, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "missing relationship metadata: pods/apps"},
		{name: "persisted legacy empty", persist: true, want: ResourceMapAvailabilityUnknown, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "missing relationship metadata: pods/apps"},
		{name: "unsupported envelope", metadata: &dto.ResourceRelationshipSnapshotMetadata{Version: dto.ResourceRelationshipSnapshotMetadataVersion + 1}, want: ResourceMapAvailabilityUnknown, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "unsupported relationship metadata version: pods/apps"},
		{name: "valid owner envelope", metadata: completeResourceMapRelationshipMetadataFor(0, 0, dto.ResourceRelationshipFamilyLabels), want: ResourceMapAvailabilityMissing, wantCoverage: dto.ResourceRelationshipCoverageFull},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			snapshot := PodsSnapshot{Meta: resourceMapMeta(), RelationshipMetadata: test.metadata}
			if test.persist {
				store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = store.Close() })
				if err := store.Save("ctx", ResourceKindPods, "apps", snapshot); err != nil {
					t.Fatal(err)
				}
				var loaded PodsSnapshot
				ok, err := store.Load("ctx", ResourceKindPods, "apps", &loaded)
				if err != nil || !ok {
					t.Fatalf("load persisted legacy snapshot: ok=%v err=%v", ok, err)
				}
				snapshot = loaded
			}
			setNamespacedSnapshot(&plane.podsStore, "apps", snapshot)
			got, err := plane.ResourceMap(ResourceMapRequest{Target: missIdentity()})
			if err != nil {
				t.Fatal(err)
			}
			if got.Target.Availability != test.want || got.Coverage.Coverage != test.wantCoverage {
				t.Fatalf("empty snapshot authority = target=%+v coverage=%+v", got.Target, got.Coverage)
			}
			if test.wantReason != "" && !containsString(got.Coverage.Reasons, test.wantReason) {
				t.Fatalf("coverage reasons = %v, want %q", got.Coverage.Reasons, test.wantReason)
			}
		})
	}
}

func TestResourceMapRelationshipEnvelopeValidationAllSnapshotShapes(t *testing.T) {
	unsupported := completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels)
	unsupported.Version++
	tests := []struct {
		name         string
		items        int
		relationship bool
		metadata     *dto.ResourceRelationshipSnapshotMetadata
		persist      bool
		wantResolved bool
		wantCoverage dto.ResourceRelationshipCoverage
		wantReason   string
	}{
		{name: "nonempty nil envelope", items: 1, relationship: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "missing relationship metadata: pods/apps"},
		{name: "persisted nonempty nil envelope", items: 1, relationship: true, persist: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "missing relationship metadata: pods/apps"},
		{name: "zero visible ghost relationship nil envelope", relationship: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "missing relationship metadata: pods/apps"},
		{name: "unsupported nonempty envelope", items: 1, relationship: true, metadata: unsupported, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "unsupported relationship metadata version: pods/apps"},
		{name: "persisted unsupported nonempty envelope", items: 1, relationship: true, metadata: unsupported, persist: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "unsupported relationship metadata version: pods/apps"},
		{name: "valid modern nonempty", items: 1, relationship: true, metadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels), wantResolved: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "persisted valid modern nonempty", items: 1, relationship: true, metadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels), persist: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "valid modern empty", metadata: completeResourceMapRelationshipMetadataFor(0, 0, dto.ResourceRelationshipFamilyLabels), wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "persisted valid modern empty", metadata: completeResourceMapRelationshipMetadataFor(0, 0, dto.ResourceRelationshipFamilyLabels), persist: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "valid envelope cannot bless ghost relationship", relationship: true, metadata: completeResourceMapRelationshipMetadata(0, 1), wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "inconsistent relationship metadata: pods/apps"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "dep-uid")
			child := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-0", "pod-uid")
			setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{
				Items:                make([]dto.DeploymentListItemDTO, 1),
				Meta:                 resourceMapMeta(),
				Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)},
				RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
			})
			snapshot := PodsSnapshot{Items: make([]dto.PodListItemDTO, test.items), Meta: resourceMapMeta(), RelationshipMetadata: test.metadata}
			if test.relationship {
				record := testSelectorResourceMapRecord(child, nil)
				record.Owners = []dto.ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "Deployment", Name: owner.Name, UID: owner.UID}}
				snapshot.Relationships = []dto.ResourceRelationshipRecord{record}
			}
			if test.persist {
				store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = store.Close() })
				if err := store.Save("ctx", ResourceKindPods, "apps", snapshot); err != nil {
					t.Fatal(err)
				}
				var loaded PodsSnapshot
				ok, err := store.Load("ctx", ResourceKindPods, "apps", &loaded)
				if err != nil || !ok {
					t.Fatalf("load persisted snapshot: ok=%v err=%v", ok, err)
				}
				snapshot = loaded
			}
			setNamespacedSnapshot(&plane.podsStore, "apps", snapshot)
			got, err := plane.ResourceMap(ResourceMapRequest{Target: child})
			if err != nil {
				t.Fatal(err)
			}
			if got.Target.Resolved != test.wantResolved || got.Coverage.Coverage != test.wantCoverage {
				t.Fatalf("target/coverage = target=%+v coverage=%+v", got.Target, got.Coverage)
			}
			if test.wantResolved {
				ownerEdge := false
				for _, edge := range got.Edges {
					ownerEdge = ownerEdge || (edge.Type == ResourceMapEdgeOwner && edge.Resolved)
				}
				if !ownerEdge {
					t.Fatalf("legacy relationship record did not render resolved owner edge: %+v", got.Edges)
				}
			}
			if test.wantReason != "" && !containsString(got.Coverage.Reasons, test.wantReason) {
				t.Fatalf("coverage reasons = %v, want %q", got.Coverage.Reasons, test.wantReason)
			}
			if test.wantCoverage == dto.ResourceRelationshipCoverageFull && len(got.Coverage.Reasons) != 0 {
				t.Fatalf("valid envelope produced reasons: %v", got.Coverage.Reasons)
			}
		})
	}
}

func TestResourceMapExplicitReferenceProjectionMatrix(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	full := func(family dto.ResourceRelationshipFamily) *dto.ResourceRelationshipSnapshotMetadata {
		return completeResourceMapRelationshipMetadataFor(1, 1, family)
	}

	ingress := resourceMapIdentity("networking.k8s.io", "v1", "ingresses", "Ingress", "apps", "web", "ing")
	service := resourceMapIdentity("", "v1", "services", "Service", "apps", "web", "svc")
	secret := resourceMapIdentity("", "v1", "secrets", "Secret", "apps", "tls", "secret")
	pvc := resourceMapIdentity("", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", "apps", "data", "pvc")
	pv := resourceMapIdentity("", "v1", "persistentvolumes", "PersistentVolume", "", "pv-data", "pv")
	hpa := resourceMapIdentity("autoscaling", "v2", "horizontalpodautoscalers", "HorizontalPodAutoscaler", "apps", "api", "hpa")
	deployment := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "dep")
	binding := resourceMapIdentity("rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", "apps", "readers", "rb")
	role := resourceMapIdentity("rbac.authorization.k8s.io", "v1", "roles", "Role", "apps", "reader", "role")
	clusterRole := resourceMapIdentity("rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", "", "view", "cr")
	serviceAccount := resourceMapIdentity("", "v1", "serviceaccounts", "ServiceAccount", "apps", "reader", "sa")
	custom := resourceMapIdentity("example.io", "v1", "widgets", "Widget", "apps", "sample", "widget")
	crd := resourceMapIdentity("apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", "", "widgets.example.io", "crd")

	setNamespacedSnapshot(&plane.ingStore, "apps", IngressesSnapshot{Items: make([]dto.IngressListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(ingress,
		testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, service, "spec.rules[0].http.paths[0].backend.service.name", "ingress backend"),
		testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, secret, "spec.tls[0].secretName", "ingress TLS secret"),
	)}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(service)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.secsStore, "apps", SecretsSnapshot{Items: make([]dto.SecretDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(secret)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.pvcsStore, "apps", PVCsSnapshot{Items: make([]dto.PersistentVolumeClaimDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(pvc, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, pv, "spec.volumeName", "bound volume"))}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyObjectReference)})
	setClusterSnapshot(&plane.persistentVolumesStore, PersistentVolumesSnapshot{Items: make([]dto.PersistentVolumeDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(pv, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, pvc, "spec.claimRef.name", "bound claim"))}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.hpaStore, "apps", HPAsSnapshot{Items: make([]dto.HorizontalPodAutoscalerDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(hpa, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, deployment, "spec.scaleTargetRef.name", "scale target"))}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Items: make([]dto.DeploymentListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(deployment)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.roleBindingsStore, "apps", RoleBindingsSnapshot{Items: make([]dto.RoleBindingListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(binding,
		testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, role, "roleRef.name", "bound Role"),
		testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, clusterRole, "roleRef.name", "bound ClusterRole"),
		testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, serviceAccount, "subjects[0].name", "ServiceAccount subject"),
	)}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.rolesStore, "apps", RolesSnapshot{Items: make([]dto.RoleListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(role)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setClusterSnapshot(&plane.clusterRolesStore, ClusterRolesSnapshot{Items: make([]dto.ClusterRoleListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(clusterRole)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.saStore, "apps", ServiceAccountsSnapshot{Items: make([]dto.ServiceAccountListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(serviceAccount)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	one := 1
	setNamespacedSnapshot(&plane.customResourcesStore, "apps", CustomResourcesSnapshot{Items: make([]dto.CustomResourceInstanceDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(custom, testExplicitResourceMapReference(dto.ResourceRelationshipTypeKindDefinition, crd, "apiVersion/kind", "custom resource definition"))}, RelationshipMetadata: full(dto.ResourceRelationshipFamilyKindDefinition), RelationshipSourceItems: &one})
	setClusterSnapshot(&plane.crdsStore, CRDsSnapshot{Items: make([]dto.CRDListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(crd)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})

	checks := []struct {
		name, fieldPath, description string
		source, target               dto.ResourceIdentityDTO
		typeValue                    ResourceMapEdgeType
		resolved                     bool
	}{
		{"Ingress service", "spec.rules[0].http.paths[0].backend.service.name", "ingress backend", ingress, service, ResourceMapEdgeObjectReference, true},
		{"Ingress TLS", "spec.tls[0].secretName", "ingress TLS secret", ingress, secret, ResourceMapEdgeObjectReference, true},
		{"PVC to PV", "spec.volumeName", "bound volume", pvc, pv, ResourceMapEdgeObjectReference, true},
		// A cluster-scoped PV projection does not scan arbitrary namespace cells;
		// its explicit claim identity remains a truthful unknown placeholder.
		{"PV to PVC", "spec.claimRef.name", "bound claim", pv, pvc, ResourceMapEdgeObjectReference, false},
		{"HPA target", "spec.scaleTargetRef.name", "scale target", hpa, deployment, ResourceMapEdgeObjectReference, true},
		{"RBAC Role", "roleRef.name", "bound Role", binding, role, ResourceMapEdgeObjectReference, true},
		{"RBAC ClusterRole", "roleRef.name", "bound ClusterRole", binding, clusterRole, ResourceMapEdgeObjectReference, true},
		{"RBAC subject", "subjects[0].name", "ServiceAccount subject", binding, serviceAccount, ResourceMapEdgeObjectReference, true},
		{"CRD definition", "apiVersion/kind", "custom resource definition", custom, crd, ResourceMapEdgeKindDefinition, true},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			got, err := plane.ResourceMap(ResourceMapRequest{Target: check.source})
			if err != nil {
				t.Fatal(err)
			}
			edge := findResourceMapEdge(got, check.typeValue, resourceMapNodeID("ctx", check.target), resourceMapNodeID("ctx", check.source))
			if edge == nil || edge.Source.Type != dto.ResourceRelationshipSourceKubernetes || edge.Source.FieldPath != check.fieldPath || edge.Evidence.Description != check.description || edge.Resolved != check.resolved {
				t.Fatalf("explicit edge not projected with carried evidence: %+v", got.Edges)
			}
			wantConfidence := ResourceMapEdgeConfidenceExact
			if !check.resolved || check.target.UID == "" {
				wantConfidence = ResourceMapEdgeConfidenceHigh
			}
			if edge.Confidence != wantConfidence {
				t.Fatalf("confidence = %q, want %q: %+v", edge.Confidence, wantConfidence, edge)
			}
		})
	}

	fromSource, _ := plane.ResourceMap(ResourceMapRequest{Target: hpa})
	fromTarget, _ := plane.ResourceMap(ResourceMapRequest{Target: deployment})
	if node := findResourceMapNode(fromSource, deployment); node == nil || node.Direction != ResourceMapDirectionParent {
		t.Fatalf("dependency from source perspective = %+v", fromSource.Nodes)
	}
	if node := findResourceMapNode(fromTarget, hpa); node == nil || node.Direction != ResourceMapDirectionChild {
		t.Fatalf("dependant from reverse perspective = %+v", fromTarget.Nodes)
	}
}

func TestResourceMapExplicitResolutionNamespaceUIDAndEvidenceIdentity(t *testing.T) {
	t.Run("namespace collision resolves canonical target", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		seedCompleteEmptyClusterResourceMapInventory(plane)
		seedCompleteEmptyResourceMapAllNamespacesInventory(plane)
		source := resourceMapIdentity("", "v1", "pods", "Pod", "b", "consumer", "pod")
		targetB := resourceMapIdentity("", "v1", "services", "Service", "b", "api", "svc-b")
		targetA := resourceMapIdentity("", "v1", "services", "Service", "a", "api", "svc-a")
		setNamespacedSnapshot(&plane.podsStore, "", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, targetB, "spec.target", "target"))}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
		setNamespacedSnapshot(&plane.svcsStore, "", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 2), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(targetA), testResourceMapRecord(targetB)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(2, 2)})
		got, err := plane.ResourceMap(ResourceMapRequest{Target: source})
		if err != nil {
			t.Fatal(err)
		}
		if edge := findResourceMapEdge(got, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", targetB), resourceMapNodeID("ctx", source)); edge == nil || !edge.Resolved || responseHasNode(got, resourceMapNodeID("ctx", targetA)) {
			t.Fatalf("namespace-isolated explicit resolution = %+v", got)
		}
	})

	t.Run("UID cannot override canonical identity and unresolved stays unknown", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		seedCompleteEmptyResourceMapInventory(plane)
		source := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "consumer", "pod")
		requested := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "shared")
		wrong := resourceMapIdentity("", "v1", "secrets", "Secret", "apps", "api", "shared")
		setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, requested, "spec.target", "target"))}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
		setNamespacedSnapshot(&plane.secsStore, "apps", SecretsSnapshot{Items: make([]dto.SecretDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(wrong)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
		got, err := plane.ResourceMap(ResourceMapRequest{Target: source})
		if err != nil {
			t.Fatal(err)
		}
		edge := findResourceMapEdge(got, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", requested), resourceMapNodeID("ctx", source))
		node := findResourceMapNode(got, requested)
		if edge == nil || edge.Resolved || edge.Confidence != ResourceMapEdgeConfidenceHigh || node == nil || node.Availability != ResourceMapAvailabilityUnknown || node.Navigable {
			t.Fatalf("canonical UID mismatch resolved or claimed missing: edge=%+v node=%+v", edge, node)
		}
	})

	t.Run("evidence variants survive exact duplicate collapse with deterministic IDs", func(t *testing.T) {
		plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
		seedCompleteEmptyResourceMapInventory(plane)
		source := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "consumer", "pod")
		target := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
		one := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.first", "target")
		two := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.second", "target")
		setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, one, one, two)}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
		setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(target)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
		first, err := plane.ResourceMap(ResourceMapRequest{Target: source})
		if err != nil {
			t.Fatal(err)
		}
		second, _ := plane.ResourceMap(ResourceMapRequest{Target: source})
		var edges []ResourceMapEdge
		for _, edge := range first.Edges {
			if edge.Type == ResourceMapEdgeObjectReference {
				edges = append(edges, edge)
			}
		}
		if len(edges) != 2 || edges[0].ID == edges[1].ID || edges[0].Source.FieldPath == edges[1].Source.FieldPath || resourceMapSignature(first) != resourceMapSignature(second) {
			t.Fatalf("evidence dedup/identity/determinism = %+v", edges)
		}
	})
}

func TestResourceMapResponseEvidenceSelectorIsIsolatedFromCachedSidecar(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	source := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "consumer", "pod")
	target := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
	reference := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.selector", "selected service")
	reference.Evidence.Selector = map[string]string{"app": "api"}
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{
		Items:                make([]dto.PodListItemDTO, 1),
		Meta:                 resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, reference)},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference),
	})
	setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{
		Items:                make([]dto.ServiceListItemDTO, 1),
		Meta:                 resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(target)},
		RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
	})

	first, err := plane.ResourceMap(ResourceMapRequest{Target: source})
	if err != nil {
		t.Fatal(err)
	}
	firstEdge := findResourceMapEdge(first, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", target), resourceMapNodeID("ctx", source))
	if firstEdge == nil || firstEdge.Evidence.Selector["app"] != "api" {
		t.Fatalf("first response explicit evidence = %+v", firstEdge)
	}
	firstID := firstEdge.ID
	firstEdge.Evidence.Selector["app"] = "mutated"
	firstEdge.Evidence.Selector["new"] = "value"

	cached, ok := peekNamespacedSnapshot(&plane.podsStore, "apps")
	if !ok || cached.Relationships[0].References[0].Evidence.Selector["app"] != "api" || len(cached.Relationships[0].References[0].Evidence.Selector) != 1 {
		t.Fatalf("response mutation reached cached relationship sidecar: %+v", cached.Relationships)
	}
	second, err := plane.ResourceMap(ResourceMapRequest{Target: source})
	if err != nil {
		t.Fatal(err)
	}
	secondEdge := findResourceMapEdge(second, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", target), resourceMapNodeID("ctx", source))
	if secondEdge == nil || secondEdge.ID != firstID || secondEdge.Evidence.Selector["app"] != "api" || len(secondEdge.Evidence.Selector) != 1 {
		t.Fatalf("next response changed after prior selector mutation: firstID=%q edge=%+v", firstID, secondEdge)
	}
}

func TestResourceMapRejectedRecordsDegradeDeclaredExplicitFamilies(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*dto.ResourceRelationshipRecord)
	}{
		{
			name: "unsupported version",
			mutate: func(record *dto.ResourceRelationshipRecord) {
				record.Version = dto.ResourceRelationshipRecordVersion + 1
			},
		},
		{
			name: "malformed identity",
			mutate: func(record *dto.ResourceRelationshipRecord) {
				record.Resource.Resource = ""
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "owner", "dep")
			child := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "child", "pod")
			rejectedSource := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "rejected", "rejected")
			objectTarget := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
			kindTarget := resourceMapIdentity("apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", "", "widgets.example.io", "crd")
			rejected := testExplicitResourceMapRecord(rejectedSource,
				testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, objectTarget, "spec.target", "object target"),
				testExplicitResourceMapReference(dto.ResourceRelationshipTypeKindDefinition, kindTarget, "apiVersion/kind", "kind target"),
			)
			test.mutate(&rejected)
			validChild := testResourceMapRecord(child, dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: owner.Kind, Name: owner.Name, UID: owner.UID})
			setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{
				Items:         make([]dto.PodListItemDTO, 2),
				Meta:          resourceMapMeta(),
				Relationships: []dto.ResourceRelationshipRecord{rejected, validChild},
				RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2,
					dto.ResourceRelationshipFamilyObjectReference,
					dto.ResourceRelationshipFamilyKindDefinition,
				),
			})
			setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{
				Items:                make([]dto.DeploymentListItemDTO, 1),
				Meta:                 resourceMapMeta(),
				Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)},
				RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
			})

			got, err := plane.ResourceMap(ResourceMapRequest{Target: owner})
			if err != nil {
				t.Fatal(err)
			}
			if edge := findResourceMapEdge(got, ResourceMapEdgeOwner, resourceMapNodeID("ctx", owner), resourceMapNodeID("ctx", child)); edge == nil || !edge.Resolved {
				t.Fatalf("valid owner record/edge was discarded with rejected record: %+v", got.Edges)
			}
			for _, edge := range got.Edges {
				if edge.Type == ResourceMapEdgeObjectReference || edge.Type == ResourceMapEdgeKindDefinition {
					t.Fatalf("rejected record emitted explicit edge: %+v", edge)
				}
			}
			for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyKindDefinition} {
				status := got.Coverage.Families[family]
				if status.Coverage != dto.ResourceRelationshipCoveragePartial || status.Completeness != dto.ResourceRelationshipCompletenessPartial {
					t.Errorf("rejected record family %q = %+v, want partial/partial", family, status)
				}
			}
		})
	}
}

func TestResourceMapNegativeRelationshipCountsCannotProveAbsence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CustomResourcesSnapshot)
	}{
		{
			name: "negative relationship source items",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				negative := -1
				snapshot.RelationshipSourceItems = &negative
			},
		},
		{
			name: "negative metadata source items",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				snapshot.RelationshipMetadata.SourceItems = -1
			},
		},
		{
			name: "negative metadata evidence records",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				snapshot.RelationshipMetadata.EvidenceRecords = -1
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			zero := 0
			snapshot := CustomResourcesSnapshot{
				Meta:                    resourceMapMeta(),
				RelationshipMetadata:    completeResourceMapRelationshipMetadataFor(0, 0, dto.ResourceRelationshipFamilyKindDefinition),
				RelationshipSourceItems: &zero,
			}
			test.mutate(&snapshot)
			setNamespacedSnapshot(&plane.customResourcesStore, "apps", snapshot)
			missing := resourceMapIdentity("example.io", "v1", "widgets", "Widget", "apps", "missing", "")
			got, err := plane.ResourceMap(ResourceMapRequest{Target: missing})
			if err != nil {
				t.Fatal(err)
			}
			if got.Target.Availability == ResourceMapAvailabilityMissing || got.Coverage.Coverage != dto.ResourceRelationshipCoveragePartial || got.Coverage.Completeness != dto.ResourceRelationshipCompletenessPartial {
				t.Fatalf("negative count proved authoritative absence: target=%+v coverage=%+v", got.Target, got.Coverage)
			}
			if !reasonContains(got.Coverage.Reasons, "inconsistent relationship metadata: customresources/apps") {
				t.Fatalf("negative count reason missing: %+v", got.Coverage)
			}
		})
	}
}

func TestResourceMapKindDefinitionGateMatrix(t *testing.T) {
	partial := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}
	tests := []struct {
		name     string
		mutate   func(*CustomResourcesSnapshot)
		wantEdge bool
	}{
		{
			name: "record family partial",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				snapshot.Relationships[0].FamilyCoverage[dto.ResourceRelationshipFamilyKindDefinition] = partial
			},
		},
		{
			name: "edge partial",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				snapshot.Relationships[0].References[0].Coverage = partial
			},
		},
		{
			name: "envelope family partial",
			mutate: func(snapshot *CustomResourcesSnapshot) {
				snapshot.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyKindDefinition] = partial
			},
		},
		{name: "positive full", wantEdge: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			source := resourceMapIdentity("example.io", "v1", "widgets", "Widget", "apps", "sample", "widget")
			target := resourceMapIdentity("apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", "", "widgets.example.io", "crd")
			one := 1
			snapshot := CustomResourcesSnapshot{
				Items: make([]dto.CustomResourceInstanceDTO, 1), Meta: resourceMapMeta(),
				Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source,
					testExplicitResourceMapReference(dto.ResourceRelationshipTypeKindDefinition, target, "apiVersion/kind", "kind definition"),
				)},
				RelationshipMetadata:    completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyKindDefinition),
				RelationshipSourceItems: &one,
			}
			if test.mutate != nil {
				test.mutate(&snapshot)
			}
			setNamespacedSnapshot(&plane.customResourcesStore, "apps", snapshot)
			setClusterSnapshot(&plane.crdsStore, CRDsSnapshot{
				Items:                make([]dto.CRDListItemDTO, 1),
				Meta:                 resourceMapMeta(),
				Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(target)},
				RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
			})
			got, err := plane.ResourceMap(ResourceMapRequest{Target: source})
			if err != nil {
				t.Fatal(err)
			}
			edge := findResourceMapEdge(got, ResourceMapEdgeKindDefinition, resourceMapNodeID("ctx", target), resourceMapNodeID("ctx", source))
			if (edge != nil) != test.wantEdge {
				t.Fatalf("kindDefinition edge present=%v, want %v: %+v", edge != nil, test.wantEdge, got.Edges)
			}
			status := got.Coverage.Families[dto.ResourceRelationshipFamilyKindDefinition]
			if test.wantEdge {
				if status.Coverage != dto.ResourceRelationshipCoverageFull || status.Completeness != dto.ResourceRelationshipCompletenessComplete {
					t.Fatalf("positive kindDefinition family = %+v", status)
				}
			} else if status.Coverage != dto.ResourceRelationshipCoveragePartial || status.Completeness != dto.ResourceRelationshipCompletenessPartial {
				t.Fatalf("failed kindDefinition gate = %+v, want partial/partial", status)
			}
		})
	}
}

func TestResourceMapReverseExplicitEvidenceDeduplicatesAcrossRecordsAndStores(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	source := resourceMapIdentity("example.io", "v1", "consumers", "Consumer", "apps", "consumer", "consumer")
	target := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
	exact := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.target", "selected service")
	variant := testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.fallback", "selected service")
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{
		Items:         make([]dto.PodListItemDTO, 2),
		Meta:          resourceMapMeta(),
		Relationships: []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, exact), testExplicitResourceMapRecord(source, exact)},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2,
			dto.ResourceRelationshipFamilyObjectReference,
		),
	})
	one := 1
	setNamespacedSnapshot(&plane.customResourcesStore, "apps", CustomResourcesSnapshot{
		Items:                   make([]dto.CustomResourceInstanceDTO, 1),
		Meta:                    resourceMapMeta(),
		Relationships:           []dto.ResourceRelationshipRecord{testExplicitResourceMapRecord(source, exact, variant)},
		RelationshipMetadata:    completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference),
		RelationshipSourceItems: &one,
	})
	setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{
		Items:                make([]dto.ServiceListItemDTO, 1),
		Meta:                 resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(target)},
		RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
	})

	got, err := plane.ResourceMap(ResourceMapRequest{Target: target})
	if err != nil {
		t.Fatal(err)
	}
	var reverse []ResourceMapEdge
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeObjectReference && edge.From == resourceMapNodeID("ctx", target) && edge.To == resourceMapNodeID("ctx", source) {
			reverse = append(reverse, edge)
		}
	}
	if len(reverse) != 2 || reverse[0].ID == reverse[1].ID || reverse[0].Source.FieldPath == reverse[1].Source.FieldPath {
		t.Fatalf("reverse exact duplicate collapse/variant preservation = %+v", reverse)
	}
}

func TestResourceMapExplicitFamilyGatesAndCompleteEmptyStatus(t *testing.T) {
	fullCoverage := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	partialCoverage := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}
	tests := []struct {
		name   string
		mutate func(*PodsSnapshot)
	}{
		{"inexact snapshot", func(snapshot *PodsSnapshot) { snapshot.Meta.Coverage = CoverageClassPartial }},
		{"missing envelope", func(snapshot *PodsSnapshot) { snapshot.RelationshipMetadata = nil }},
		{"unsupported envelope", func(snapshot *PodsSnapshot) { snapshot.RelationshipMetadata.Version++ }},
		{"inconsistent envelope counts", func(snapshot *PodsSnapshot) { snapshot.RelationshipMetadata.SourceItems++ }},
		{"undeclared envelope family", func(snapshot *PodsSnapshot) {
			delete(snapshot.RelationshipMetadata.FamilyCoverage, dto.ResourceRelationshipFamilyObjectReference)
		}},
		{"inexact envelope family", func(snapshot *PodsSnapshot) {
			snapshot.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] = partialCoverage
		}},
		{"missing record family", func(snapshot *PodsSnapshot) {
			delete(snapshot.Relationships[0].FamilyCoverage, dto.ResourceRelationshipFamilyObjectReference)
		}},
		{"inexact record family", func(snapshot *PodsSnapshot) {
			snapshot.Relationships[0].FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference] = partialCoverage
		}},
		{"inexact edge", func(snapshot *PodsSnapshot) { snapshot.Relationships[0].References[0].Coverage = partialCoverage }},
		{"malformed target", func(snapshot *PodsSnapshot) { snapshot.Relationships[0].References[0].Target.Resource = "" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "owner", "dep")
			source := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "consumer", "pod")
			target := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
			record := testExplicitResourceMapRecord(source, testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "spec.target", "target"))
			record.Owners = []dto.ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "Deployment", Name: owner.Name, UID: owner.UID}}
			snapshot := PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{record}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)}
			test.mutate(&snapshot)
			setNamespacedSnapshot(&plane.podsStore, "apps", snapshot)
			setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Items: make([]dto.DeploymentListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
			setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(target)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
			got, err := plane.ResourceMap(ResourceMapRequest{Target: source})
			if err != nil {
				t.Fatal(err)
			}
			if edge := findResourceMapEdge(got, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", target), resourceMapNodeID("ctx", source)); edge != nil {
				t.Fatalf("explicit edge escaped failed family gate: %+v", edge)
			}
			ownerEdge := findResourceMapEdge(got, ResourceMapEdgeOwner, resourceMapNodeID("ctx", owner), resourceMapNodeID("ctx", source))
			if ownerEdge == nil || ownerEdge.Source.FieldPath != "metadata.ownerReferences" || ownerEdge.Evidence.Description != "ownerReference" {
				t.Fatalf("owner projection changed with explicit gate failure: %+v", got.Edges)
			}
			family := got.Coverage.Families[dto.ResourceRelationshipFamilyObjectReference]
			if family.Coverage == dto.ResourceRelationshipCoverageFull && family.Completeness == dto.ResourceRelationshipCompletenessComplete {
				t.Fatalf("failed explicit gate reported full/complete: %+v", family)
			}
		})
	}

	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), RelationshipMetadata: completeResourceMapRelationshipMetadataFor(0, 0, dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyKindDefinition)})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: missIdentity()})
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyKindDefinition} {
		status := got.Coverage.Families[family]
		if status.Coverage != fullCoverage.Coverage || status.Completeness != fullCoverage.Completeness || len(status.Reasons) != 0 {
			t.Fatalf("complete-empty family %q = %+v", family, status)
		}
	}
}

func TestResourceMapExplicitFamilyScanTruncationUsesWorstStatus(t *testing.T) {
	records := make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords+1)
	collector := resourceMapCollector{reasons: map[string]struct{}{}}
	collector.snapshot("pods/apps", len(records), len(records), records, completeResourceMapRelationshipMetadataFor(len(records), len(records), dto.ResourceRelationshipFamilyObjectReference), resourceMapMeta(), true)
	state := collector.families[dto.ResourceRelationshipFamilyObjectReference]
	hasScanReason := false
	if state != nil {
		for reason := range state.reasons {
			hasScanReason = hasScanReason || strings.Contains(reason, "relationship scan limit")
		}
	}
	if !collector.truncated || state == nil || state.coverage != dto.ResourceRelationshipCoveragePartial || state.completeness != dto.ResourceRelationshipCompletenessPartial || !hasScanReason {
		t.Fatalf("scan-truncated explicit family = truncated=%v state=%+v", collector.truncated, state)
	}
}

func TestResourceMapIsCacheOnlyByConstruction(t *testing.T) {
	fset := token.NewFileSet()
	file := parseResourceMapFile(t, fset, "resource_map.go")
	for _, imp := range file.Imports {
		path := strings.Trim(imp.Path.Value, `"`)
		if strings.Contains(path, "client-go") || strings.Contains(path, "/internal/kube/cluster") {
			t.Errorf("resource_map.go imports Kubernetes client package %q", path)
		}
	}
	forbiddenCalls := map[string]bool{
		"GetClientsForContext": true, "Load": true, "Search": true, "SearchName": true, "ListSnapshots": true, "Run": true,
		"NamespacesSnapshot": true, "NodesSnapshot": true, "PersistentVolumesSnapshot": true, "ClusterRolesSnapshot": true,
		"ClusterRoleBindingsSnapshot": true, "CRDsSnapshot": true, "ClusterCustomResourcesSnapshot": true, "PodsSnapshot": true,
		"DeploymentsSnapshot": true, "ServicesSnapshot": true, "IngressesSnapshot": true, "NetworkPoliciesSnapshot": true,
		"PVCsSnapshot": true, "ConfigMapsSnapshot": true, "SecretsSnapshot": true, "ServiceAccountsSnapshot": true,
		"RolesSnapshot": true, "RoleBindingsSnapshot": true, "DaemonSetsSnapshot": true, "StatefulSetsSnapshot": true,
		"ReplicaSetsSnapshot": true, "JobsSnapshot": true, "CronJobsSnapshot": true, "HPAsSnapshot": true,
		"ResourceQuotasSnapshot": true, "LimitRangesSnapshot": true, "CustomResourcesSnapshot": true,
	}
	foundClusterMethod := false
	ast.Inspect(file, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.CallExpr:
			if selector, ok := n.Fun.(*ast.SelectorExpr); ok && forbiddenCalls[selector.Sel.Name] {
				t.Errorf("forbidden cache-miss/live-read entrypoint %s called", selector.Sel.Name)
			}
		case *ast.FuncDecl:
			if n.Name.Name != "ResourceMap" {
				break
			}
			receiver := methodReceiverType(n)
			switch receiver {
			case "clusterPlane":
				foundClusterMethod = true
				if n.Type.Params == nil || len(n.Type.Params.List) != 1 {
					t.Errorf("clusterPlane.ResourceMap must accept only ResourceMapRequest")
				} else if ident, ok := n.Type.Params.List[0].Type.(*ast.Ident); !ok || ident.Name != "ResourceMapRequest" {
					t.Errorf("clusterPlane.ResourceMap accepts forbidden dependency instead of only ResourceMapRequest")
				}
			case "manager":
				if n.Type.Params == nil || len(n.Type.Params.List) != 2 {
					t.Errorf("manager.ResourceMap must accept only context name and ResourceMapRequest")
				}
			default:
				t.Errorf("unexpected ResourceMap receiver %q", receiver)
			}
		}
		return true
	})
	if !foundClusterMethod {
		t.Fatal("clusterPlane.ResourceMap method not found")
	}
}

func TestCompactResourceGraphDefersPresentNodeIDsUntilOutput(t *testing.T) {
	identities := make([]dto.ResourceIdentityDTO, 1_000)
	for i := range identities {
		identities[i] = resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", fmt.Sprintf("workload-%05d", i), fmt.Sprintf("uid-%05d", i))
	}
	graph := newCompactResourceGraph("ctx", &resourceMapIndex{identities: identities})
	for i := range identities {
		graph.ensurePresent(i)
	}
	for i, node := range graph.nodes {
		if node.id != "" {
			t.Fatalf("present node %d materialized ID during discovery: %q", i, node.id)
		}
	}
	if got, want := graph.nodeID(7), resourceMapNodeID("ctx", identities[7]); got != want {
		t.Fatalf("lazy node ID = %q, want %q", got, want)
	}
	for i, node := range graph.nodes {
		if i == 7 {
			continue
		}
		if node.id != "" {
			t.Fatalf("materializing one node ID also materialized node %d: %q", i, node.id)
		}
	}
}

func TestResourceMapResolverAndEdgeLoopDoNotScanPresent(t *testing.T) {
	fset := token.NewFileSet()
	file := parseResourceMapFile(t, fset, "resource_map.go")
	foundResolvers := map[string]bool{}
	foundIncident := false
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		receiver := methodReceiverType(fn)
		switch {
		case receiver == "resourceMapIndex" && (fn.Name.Name == "resolveOwner" || fn.Name.Name == "resolveReference"):
			foundResolvers[fn.Name.Name] = true
			assertNoRangeOverSelector(t, fn.Body, "identities", fn.Name.Name)
			assertNoRangeOverSelector(t, fn.Body, "records", fn.Name.Name)
		case receiver == "compactResourceGraph" && fn.Name.Name == "incident":
			foundIncident = true
			assertNoRangeOverSelector(t, fn.Body, "nodes", "incident")
			assertNoRangeOverSelector(t, fn.Body, "present", "incident")
			assertNoRangeOverSelector(t, fn.Body, "records", "incident")
		}
	}
	if !foundResolvers["resolveOwner"] || !foundResolvers["resolveReference"] || !foundIncident {
		t.Fatalf("source invariant did not find resolvers=%v incident=%v", foundResolvers, foundIncident)
	}
}

func methodReceiverType(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) != 1 {
		return ""
	}
	expr := fn.Recv.List[0].Type
	if pointer, ok := expr.(*ast.StarExpr); ok {
		expr = pointer.X
	}
	if ident, ok := expr.(*ast.Ident); ok {
		return ident.Name
	}
	return ""
}

func assertNoRangeOverSelector(t *testing.T, node ast.Node, fieldName, location string) {
	t.Helper()
	ast.Inspect(node, func(node ast.Node) bool {
		rangeStmt, ok := node.(*ast.RangeStmt)
		if !ok {
			return true
		}
		selector, ok := rangeStmt.X.(*ast.SelectorExpr)
		if ok && selector.Sel.Name == fieldName {
			t.Errorf("%s must not range over a full %s collection", location, fieldName)
		}
		return true
	})
}

func TestResourceMapRejectsMalformedTargetAndDepth(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	if _, err := plane.ResourceMap(ResourceMapRequest{}); err == nil {
		t.Fatal("malformed target accepted")
	}
	if _, err := plane.ResourceMap(ResourceMapRequest{Target: missIdentity(), Depth: 3}); err == nil {
		t.Fatal("depth 3 accepted")
	}
}

func TestManagerResourceMapPeeksExistingPlaneWithoutCreatingOrHydrating(t *testing.T) {
	m := NewManager(ManagerConfig{}).(*manager)
	target := resourceMapIdentity("", "v1", "nodes", "Node", "", "worker", "")

	m.mu.RLock()
	before := len(m.planes)
	m.mu.RUnlock()
	if _, err := m.ResourceMap("absent", ResourceMapRequest{Target: target}); !errors.Is(err, ErrResourceMapPlaneUnavailable) {
		t.Fatalf("absent context error = %v", err)
	}
	m.mu.RLock()
	after := len(m.planes)
	_, created := m.planes["absent"]
	m.mu.RUnlock()
	if created || after != before {
		t.Fatalf("cache-only ResourceMap created context plane: before=%d after=%d created=%v", before, after, created)
	}

	loaded := newClusterPlane("loaded", "", "", ObservationScope{}, nil, nil, nil)
	m.mu.Lock()
	m.planes["loaded"] = loaded
	m.mu.Unlock()
	response, err := m.ResourceMap("loaded", ResourceMapRequest{Target: target})
	if err != nil || response.Active != "loaded" {
		t.Fatalf("existing context projection: active=%q err=%v", response.Active, err)
	}

	source, err := os.ReadFile("resource_map.go")
	if err != nil {
		t.Fatal(err)
	}
	wrapper := strings.SplitN(string(source), "const (", 2)[0]
	for _, forbidden := range []string{"m.PlaneForCluster(", ".hydratePersistedSnapshots(", ".EnsureObservers(", "m.clients"} {
		if strings.Contains(wrapper, forbidden) {
			t.Fatalf("manager ResourceMap wrapper contains hidden read path %q", forbidden)
		}
	}
}

func parseResourceMapFile(t *testing.T, fset *token.FileSet, path string) *ast.File {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	file, err := parser.ParseFile(fset, path, source, 0)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func clusterPlaneSnapshotFields(t *testing.T, file *ast.File) map[string]bool {
	t.Helper()
	fields := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		typeSpec, ok := node.(*ast.TypeSpec)
		if !ok || typeSpec.Name.Name != "clusterPlane" {
			return true
		}
		structType, ok := typeSpec.Type.(*ast.StructType)
		if !ok {
			t.Fatal("clusterPlane is not a struct")
		}
		for _, field := range structType.Fields.List {
			if !isSnapshotStoreType(field.Type) {
				continue
			}
			for _, name := range field.Names {
				fields[name.Name] = true
			}
		}
		return false
	})
	if len(fields) == 0 {
		t.Fatal("clusterPlane snapshot fields not found")
	}
	return fields
}

func isSnapshotStoreType(expr ast.Expr) bool {
	index, ok := expr.(*ast.IndexExpr)
	if !ok {
		return false
	}
	ident, ok := index.X.(*ast.Ident)
	return ok && (ident.Name == "snapshotStore" || ident.Name == "namespacedSnapshotStore")
}

func sortedMapKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func responseHasNode(response ResourceMapResponse, id string) bool {
	for _, node := range response.Nodes {
		if node.ID == id {
			return true
		}
	}
	return false
}

func findResourceMapNode(response ResourceMapResponse, identity dto.ResourceIdentityDTO) *ResourceMapNode {
	want := identity.CanonicalIdentity()
	for i := range response.Nodes {
		if response.Nodes[i].Identity.CanonicalIdentity() == want {
			return &response.Nodes[i]
		}
	}
	return nil
}

func findResourceMapEdge(response ResourceMapResponse, typeValue ResourceMapEdgeType, from, to string) *ResourceMapEdge {
	for i := range response.Edges {
		if response.Edges[i].Type == typeValue && response.Edges[i].From == from && response.Edges[i].To == to {
			return &response.Edges[i]
		}
	}
	return nil
}

func seedCompleteEmptyResourceMapInventory(plane *clusterPlane) {
	seedCompleteEmptyResourceMapInventoryForNamespace(plane, "apps")
}

func seedCompleteEmptyResourceMapInventoryForNamespace(plane *clusterPlane, namespace string) {
	seedCompleteEmptyClusterResourceMapInventory(plane)
	seedCompleteEmptyNamespacedResourceMapInventory(plane, namespace)
}

func seedCompleteEmptyClusterResourceMapInventory(plane *clusterPlane) {
	meta := resourceMapMeta()
	setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.nodesStore, NodesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.persistentVolumesStore, PersistentVolumesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.clusterRolesStore, ClusterRolesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.clusterRoleBindingsStore, ClusterRoleBindingsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.crdsStore, CRDsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setClusterSnapshot(&plane.clusterCustomResourcesStore, CustomResourcesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
}

func seedCompleteEmptyResourceMapAllNamespacesInventory(plane *clusterPlane) {
	seedCompleteEmptyNamespacedResourceMapInventory(plane, "")
}

func seedCompleteEmptyNamespacedResourceMapInventory(plane *clusterPlane, namespace string) {
	meta := resourceMapMeta()
	setNamespacedSnapshot(&plane.podsStore, namespace, PodsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.depsStore, namespace, DeploymentsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.svcsStore, namespace, ServicesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.ingStore, namespace, IngressesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.networkPoliciesStore, namespace, NetworkPoliciesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.pvcsStore, namespace, PVCsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.cmsStore, namespace, ConfigMapsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.secsStore, namespace, SecretsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.saStore, namespace, ServiceAccountsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.rolesStore, namespace, RolesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.roleBindingsStore, namespace, RoleBindingsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.dsStore, namespace, DaemonSetsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.stsStore, namespace, StatefulSetsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.rsStore, namespace, ReplicaSetsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.jobsStore, namespace, JobsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.cjStore, namespace, CronJobsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.hpaStore, namespace, HPAsSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.rqStore, namespace, ResourceQuotasSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.lrStore, namespace, LimitRangesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
	setNamespacedSnapshot(&plane.customResourcesStore, namespace, CustomResourcesSnapshot{Meta: meta, RelationshipMetadata: completeEmptyResourceMapRelationshipMetadata()})
}

func missIdentity() dto.ResourceIdentityDTO {
	return resourceMapIdentity("", "v1", "pods", "Pod", "apps", "missing", "")
}
func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
func reasonContains(values []string, want string) bool {
	for _, value := range values {
		if strings.Contains(value, want) {
			return true
		}
	}
	return false
}
func selectorGateFixture(t *testing.T) (*clusterPlane, dto.ResourceIdentityDTO, dto.ResourceIdentityDTO, dto.ResourceIdentityDTO, dto.ResourceIdentityDTO) {
	t.Helper()
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyResourceMapInventory(plane)
	service := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc-uid")
	pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-0", "pod-uid")
	owner := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "owner", "owner-uid")
	object := resourceMapIdentity("", "v1", "configmaps", "ConfigMap", "apps", "config", "config-uid")
	ownerRef := dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: owner.Kind, Name: owner.Name, UID: owner.UID}
	objectRef := func(target dto.ResourceIdentityDTO) dto.ResourceReferenceDTO {
		return testExplicitResourceMapReference(dto.ResourceRelationshipTypeObjectReference, target, "data.target", "target")
	}
	selector := testServicePodSelector(map[string]string{"app": "api", "tier": "backend"}, "spec.selector")
	serviceRecord := testSelectorResourceMapRecord(service, nil, selector)
	serviceRecord.Owners = []dto.ResourceOwnerReferenceDTO{ownerRef}
	podRecord := testSelectorResourceMapRecord(pod, map[string]string{"app": "api", "tier": "backend", "secret.example/token": "never-expose-me"})
	podRecord.Owners = []dto.ResourceOwnerReferenceDTO{ownerRef}
	objectRecord := testExplicitResourceMapRecord(object, objectRef(service), objectRef(pod))
	setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{serviceRecord}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{podRecord}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels, dto.ResourceRelationshipFamilyObjectReference)})
	setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Items: make([]dto.DeploymentListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(owner)}, RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1)})
	setNamespacedSnapshot(&plane.cmsStore, "apps", ConfigMapsSnapshot{Items: make([]dto.ConfigMapDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{objectRecord}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyObjectReference)})
	return plane, service, pod, owner, object
}

func assertSelectorGateSuppressed(t *testing.T, plane *clusterPlane, target, owner, object dto.ResourceIdentityDTO) ResourceMapResponse {
	t.Helper()
	got, err := plane.ResourceMap(ResourceMapRequest{Target: target})
	if err != nil {
		t.Fatal(err)
	}
	for _, edge := range got.Edges {
		if edge.Type == ResourceMapEdgeSelector {
			t.Fatalf("selector edge escaped failed gate: %+v", edge)
		}
	}
	if status := got.Coverage.Families[dto.ResourceRelationshipFamilySelector]; status.Coverage == dto.ResourceRelationshipCoverageFull && status.Completeness == dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("failed selector gate reported full/complete: %+v", status)
	}
	if findResourceMapEdge(got, ResourceMapEdgeOwner, resourceMapNodeID("ctx", owner), resourceMapNodeID("ctx", target)) == nil || findResourceMapEdge(got, ResourceMapEdgeObjectReference, resourceMapNodeID("ctx", target), resourceMapNodeID("ctx", object)) == nil {
		t.Fatalf("independent positive owner/objectReference edges were suppressed: %+v", got.Edges)
	}
	return got
}

func TestResourceMapSelectorStrictIndependentGateMatrix(t *testing.T) {
	partial := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}
	serviceCases := []struct {
		name   string
		mutate func(*ServicesSnapshot)
	}{
		{"snapshot meta partial", func(s *ServicesSnapshot) { s.Meta.Coverage = CoverageClassPartial }},
		{"selector envelope missing", func(s *ServicesSnapshot) {
			delete(s.RelationshipMetadata.FamilyCoverage, dto.ResourceRelationshipFamilySelector)
		}},
		{"selector envelope partial", func(s *ServicesSnapshot) {
			s.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilySelector] = partial
		}},
		{"selector envelope unsupported", func(s *ServicesSnapshot) { s.RelationshipMetadata.Version++ }},
		{"selector envelope inconsistent", func(s *ServicesSnapshot) { s.RelationshipMetadata.EvidenceRecords++ }},
		{"service record selector family missing", func(s *ServicesSnapshot) {
			delete(s.Relationships[0].FamilyCoverage, dto.ResourceRelationshipFamilySelector)
		}},
		{"service record selector family partial", func(s *ServicesSnapshot) {
			s.Relationships[0].FamilyCoverage[dto.ResourceRelationshipFamilySelector] = partial
		}},
		{"selector edge partial", func(s *ServicesSnapshot) { s.Relationships[0].Selectors[0].Coverage = partial }},
		{"selector target malformed", func(s *ServicesSnapshot) { s.Relationships[0].Selectors[0].Target.Resource = "" }},
		{"selector target unsupported", func(s *ServicesSnapshot) { s.Relationships[0].Selectors[0].Target.Resource = "deployments" }},
		{"selector source unsupported", func(s *ServicesSnapshot) { s.Relationships[0].Selectors[0].Source.Type = "unsupported" }},
		{"selector labels invalid UTF-8", func(s *ServicesSnapshot) {
			s.Relationships[0].Selectors[0].MatchLabels = map[string]string{"app": "\xff"}
		}},
		{"selector labels invalid syntax", func(s *ServicesSnapshot) {
			s.Relationships[0].Selectors[0].MatchLabels = map[string]string{"bad key": "value"}
		}},
		{"selector labels over count", func(s *ServicesSnapshot) {
			s.Relationships[0].Selectors[0].MatchLabels = testResourceMapLabelMap(dto.ResourceRelationshipMaxSelectorMatchLabels+1, false)
		}},
		{"selector labels over bytes", func(s *ServicesSnapshot) {
			s.Relationships[0].Selectors[0].MatchLabels = testResourceMapLabelMap(dto.ResourceRelationshipMaxSelectorMatchLabels, true)
		}},
	}
	for _, test := range serviceCases {
		t.Run("service/"+test.name, func(t *testing.T) {
			plane, service, _, owner, object := selectorGateFixture(t)
			snapshot, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
			test.mutate(&snapshot)
			setNamespacedSnapshot(&plane.svcsStore, "apps", snapshot)
			assertSelectorGateSuppressed(t, plane, service, owner, object)
		})
	}
	podCases := []struct {
		name   string
		mutate func(*PodsSnapshot)
	}{
		{"snapshot meta partial", func(s *PodsSnapshot) { s.Meta.Completeness = CompletenessClassInexact }},
		{"labels envelope missing", func(s *PodsSnapshot) {
			delete(s.RelationshipMetadata.FamilyCoverage, dto.ResourceRelationshipFamilyLabels)
		}},
		{"labels envelope partial", func(s *PodsSnapshot) {
			s.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyLabels] = partial
		}},
		{"labels envelope unsupported", func(s *PodsSnapshot) { s.RelationshipMetadata.Version++ }},
		{"labels envelope inconsistent", func(s *PodsSnapshot) { s.RelationshipMetadata.SourceItems++ }},
		{"pod record labels family missing", func(s *PodsSnapshot) { delete(s.Relationships[0].FamilyCoverage, dto.ResourceRelationshipFamilyLabels) }},
		{"pod record labels family partial", func(s *PodsSnapshot) {
			s.Relationships[0].FamilyCoverage[dto.ResourceRelationshipFamilyLabels] = partial
		}},
		{"Pod labels invalid UTF-8", func(s *PodsSnapshot) { s.Relationships[0].Labels = map[string]string{"app": "\xff"} }},
		{"Pod labels invalid syntax", func(s *PodsSnapshot) { s.Relationships[0].Labels = map[string]string{"bad key": "value"} }},
		{"Pod labels over count", func(s *PodsSnapshot) {
			s.Relationships[0].Labels = testResourceMapLabelMap(dto.ResourceRelationshipMaxLabels+1, false)
		}},
		{"Pod labels over bytes", func(s *PodsSnapshot) {
			s.Relationships[0].Labels = testResourceMapLabelMap(dto.ResourceRelationshipMaxLabels, true)
		}},
	}
	for _, test := range podCases {
		t.Run("pod/"+test.name, func(t *testing.T) {
			plane, _, pod, owner, object := selectorGateFixture(t)
			snapshot, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
			test.mutate(&snapshot)
			setNamespacedSnapshot(&plane.podsStore, "apps", snapshot)
			got := assertSelectorGateSuppressed(t, plane, pod, owner, object)
			if status := got.Coverage.Families[dto.ResourceRelationshipFamilyLabels]; status.Coverage == dto.ResourceRelationshipCoverageFull && status.Completeness == dto.ResourceRelationshipCompletenessComplete {
				t.Fatalf("failed labels gate reported full/complete: %+v", status)
			}
		})
	}
}

func TestResourceMapSelectorNamespaceEmptyLabelsAndFamilyReporting(t *testing.T) {
	plane, service, matching, _, _ := selectorGateFixture(t)
	otherNamespace := resourceMapIdentity("", "v1", "pods", "Pod", "other", "same-labels", "other-pod")
	seedCompleteEmptyNamespacedResourceMapInventory(plane, "other")
	setNamespacedSnapshot(&plane.podsStore, "other", PodsSnapshot{Items: make([]dto.PodListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(otherNamespace, map[string]string{"app": "api", "tier": "backend"})}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels)})
	got, err := plane.ResourceMap(ResourceMapRequest{Target: service})
	if err != nil {
		t.Fatal(err)
	}
	if findResourceMapNode(got, matching) == nil || findResourceMapNode(got, otherNamespace) != nil {
		t.Fatalf("selector namespace isolation failed: %+v", got.Nodes)
	}
	encoded, err := json.Marshal(got)
	if err != nil || strings.Contains(string(encoded), "never-expose-me") || strings.Contains(string(encoded), "secret.example/token") {
		t.Fatalf("Pod labels leaked in response JSON: %s (%v)", encoded, err)
	}
	for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels} {
		status := got.Coverage.Families[family]
		if status.Coverage != dto.ResourceRelationshipCoverageFull || status.Completeness != dto.ResourceRelationshipCompletenessComplete {
			t.Fatalf("positive family %q = %+v", family, status)
		}
	}

	for _, labels := range []map[string]string{nil, {}} {
		plane, service, pod, _, _ := selectorGateFixture(t)
		svc, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
		svc.Relationships[0].Selectors[0].MatchLabels = labels
		setNamespacedSnapshot(&plane.svcsStore, "apps", svc)
		pods, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
		pods.Relationships[0].Labels = labels
		setNamespacedSnapshot(&plane.podsStore, "apps", pods)
		empty, err := plane.ResourceMap(ResourceMapRequest{Target: service})
		if err != nil {
			t.Fatal(err)
		}
		if findResourceMapNode(empty, pod) != nil {
			t.Fatalf("empty selector/labels matched all Pods: %+v", empty.Edges)
		}
		for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels} {
			status := empty.Coverage.Families[family]
			if status.Coverage != dto.ResourceRelationshipCoverageFull || status.Completeness != dto.ResourceRelationshipCompletenessComplete {
				t.Fatalf("complete-empty family %q = %+v", family, status)
			}
		}
	}
}

func TestResourceMapSelectorMissingLegacyConflictAndTruncationFailSafe(t *testing.T) {
	t.Run("missing service snapshot", func(t *testing.T) {
		plane, _, pod, owner, object := selectorGateFixture(t)
		clearNamespacedSnapshot(&plane.svcsStore, "apps")
		assertSelectorGateSuppressed(t, plane, pod, owner, object)
	})
	t.Run("legacy Pod snapshot", func(t *testing.T) {
		plane, _, pod, owner, object := selectorGateFixture(t)
		s, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
		s.RelationshipMetadata = nil
		setNamespacedSnapshot(&plane.podsStore, "apps", s)
		assertSelectorGateSuppressed(t, plane, pod, owner, object)
	})
	t.Run("conflicting duplicate Pod identity", func(t *testing.T) {
		plane, _, pod, owner, object := selectorGateFixture(t)
		s, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
		conflict := s.Relationships[0]
		conflict.Labels = map[string]string{"app": "different", "tier": "backend"}
		s.Items = make([]dto.PodListItemDTO, 2)
		s.Relationships = append(s.Relationships, conflict)
		s.RelationshipMetadata.SourceItems, s.RelationshipMetadata.EvidenceRecords = 2, 2
		setNamespacedSnapshot(&plane.podsStore, "apps", s)
		assertSelectorGateSuppressed(t, plane, pod, owner, object)
	})
	t.Run("scan truncation before relation", func(t *testing.T) {
		filler := make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords)
		collector := resourceMapCollector{reasons: map[string]struct{}{}, families: map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{}}
		collector.snapshot("filler", len(filler), len(filler), filler, completeResourceMapRelationshipMetadataFor(len(filler), len(filler), dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels), resourceMapMeta(), true)
		service := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
		collector.snapshot("services/apps", 1, 1, []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(service, nil, testServicePodSelector(map[string]string{"app": "api"}, "spec.selector"))}, completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilySelector), resourceMapMeta(), true)
		idx := newResourceMapIndex(&collector)
		if !collector.truncated || len(idx.selectorsByService) != 0 || len(idx.reverseSelector) != 0 {
			t.Fatalf("scan-truncated selector projection was built: truncated=%v selectors=%v reverse=%v", collector.truncated, idx.selectorsByService, idx.reverseSelector)
		}
	})
	t.Run("scan truncation after valid selector evidence", func(t *testing.T) {
		collector := resourceMapCollector{reasons: map[string]struct{}{}, families: map[dto.ResourceRelationshipFamily]*resourceMapFamilyState{}}
		service := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc")
		pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-0", "pod")
		collector.snapshot("services/apps", 1, 1, []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(service, nil, testServicePodSelector(map[string]string{"app": "api"}, "spec.selector"))}, completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilySelector), resourceMapMeta(), true)
		collector.snapshot("pods/apps", 1, 1, []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(pod, map[string]string{"app": "api"})}, completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilyLabels), resourceMapMeta(), true)
		filler := make([]dto.ResourceRelationshipRecord, ResourceMapMaxScannedRecords)
		collector.snapshot("later-unrelated", len(filler), len(filler), filler, completeResourceMapRelationshipMetadata(len(filler), len(filler)), resourceMapMeta(), true)
		idx := newResourceMapIndex(&collector)
		if !collector.truncated || idx.podLabels != nil || idx.podsByLabel != nil || idx.selectorsByService != nil || idx.reverseSelector != nil {
			t.Fatalf("later truncation left selector indexes: truncated=%v podLabels=%v podsByLabel=%v selectors=%v reverse=%v", collector.truncated, idx.podLabels, idx.podsByLabel, idx.selectorsByService, idx.reverseSelector)
		}
		for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels} {
			state := collector.families[family]
			if state == nil || state.coverage == dto.ResourceRelationshipCoverageFull || state.completeness == dto.ResourceRelationshipCompletenessComplete {
				t.Fatalf("later truncation family %q remained exact: %+v", family, state)
			}
		}
	})
	t.Run("legacy selector reference", func(t *testing.T) {
		plane, service, _, owner, object := selectorGateFixture(t)
		s, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
		legacy := testExplicitResourceMapReference(dto.ResourceRelationshipTypeSelector, s.Relationships[0].Resource, "spec.selector", "legacy")
		s.Relationships[0].References = append(s.Relationships[0].References, legacy)
		setNamespacedSnapshot(&plane.svcsStore, "apps", s)
		assertSelectorGateSuppressed(t, plane, service, owner, object)
	})
	t.Run("selectors on non-Service source", func(t *testing.T) {
		plane, _, pod, owner, object := selectorGateFixture(t)
		s, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
		s.Relationships[0].Selectors = []dto.ResourceRelationshipSelectorDTO{testServicePodSelector(map[string]string{"app": "api"}, "metadata.selector")}
		setNamespacedSnapshot(&plane.podsStore, "apps", s)
		assertSelectorGateSuppressed(t, plane, pod, owner, object)
	})
	t.Run("selector slice bounds", func(t *testing.T) {
		for _, test := range []struct {
			name   string
			mutate func(*dto.ResourceRelationshipRecord)
		}{
			{name: "count", mutate: func(record *dto.ResourceRelationshipRecord) {
				selector := record.Selectors[0]
				record.Selectors = make([]dto.ResourceRelationshipSelectorDTO, dto.ResourceRelationshipMaxSelectors+1)
				for index := range record.Selectors {
					record.Selectors[index] = selector
				}
			}},
			{name: "aggregate bytes", mutate: func(record *dto.ResourceRelationshipRecord) {
				selector := record.Selectors[0]
				selector.Source.FieldPath = strings.Repeat("x", dto.ResourceRelationshipMaxSelectorsBytes/dto.ResourceRelationshipMaxSelectors+1)
				record.Selectors = make([]dto.ResourceRelationshipSelectorDTO, dto.ResourceRelationshipMaxSelectors)
				for index := range record.Selectors {
					record.Selectors[index] = selector
				}
			}},
		} {
			t.Run(test.name, func(t *testing.T) {
				plane, _, pod, owner, object := selectorGateFixture(t)
				snapshot, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
				test.mutate(&snapshot.Relationships[0])
				setNamespacedSnapshot(&plane.svcsStore, "apps", snapshot)
				assertSelectorGateSuppressed(t, plane, pod, owner, object)
			})
		}
	})
}

func TestResourceMapSelectorPodCanonicalCollisionFailSafe(t *testing.T) {
	for _, test := range []struct {
		name         string
		mutateLabels bool
		duplicateUID bool
		wantSelector bool
	}{
		{name: "exact duplicate full identity and labels remains exact", wantSelector: true},
		{name: "old and new UID with equal labels degrades", duplicateUID: true},
		{name: "old and new UID with differing labels degrades", duplicateUID: true, mutateLabels: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			plane, service, pod, owner, object := selectorGateFixture(t)
			s, _ := peekNamespacedSnapshot(&plane.podsStore, "apps")
			duplicate := s.Relationships[0]
			if test.duplicateUID {
				duplicate.Resource.UID = "replacement-pod-uid"
			}
			if test.mutateLabels {
				duplicate.Labels = map[string]string{"app": "replacement", "tier": "backend"}
			}
			s.Items = make([]dto.PodListItemDTO, 2)
			s.Relationships = append(s.Relationships, duplicate)
			s.RelationshipMetadata.SourceItems, s.RelationshipMetadata.EvidenceRecords = 2, 2
			setNamespacedSnapshot(&plane.podsStore, "apps", s)
			if !test.wantSelector {
				got := assertSelectorGateSuppressed(t, plane, pod, owner, object)
				if !reasonContains(got.Coverage.Families[dto.ResourceRelationshipFamilyLabels].Reasons, "ambiguous canonical Pod identity") {
					t.Fatalf("canonical Pod collision reason missing: %+v", got.Coverage.Families)
				}
				return
			}
			got, err := plane.ResourceMap(ResourceMapRequest{Target: service})
			if err != nil || findResourceMapEdge(got, ResourceMapEdgeSelector, resourceMapNodeID("ctx", service), resourceMapNodeID("ctx", pod)) == nil {
				t.Fatalf("exact duplicate suppressed selector: err=%v edges=%+v", err, got.Edges)
			}
		})
	}
}

func TestResourceMapDuplicateServiceSelectorSemantics(t *testing.T) {
	t.Run("equal semantic set preserves Source evidence variants", func(t *testing.T) {
		plane, service, pod, _, _ := selectorGateFixture(t)
		s, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
		duplicate := s.Relationships[0]
		variant := duplicate.Selectors[0]
		variant.Source = dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceProduct, FieldPath: "metadata.annotations[selector]"}
		duplicate.Selectors = []dto.ResourceRelationshipSelectorDTO{variant, variant, duplicate.Selectors[0]}
		s.Items = make([]dto.ServiceListItemDTO, 2)
		s.Relationships = append(s.Relationships, duplicate)
		s.RelationshipMetadata.SourceItems, s.RelationshipMetadata.EvidenceRecords = 2, 2
		setNamespacedSnapshot(&plane.svcsStore, "apps", s)
		got, err := plane.ResourceMap(ResourceMapRequest{Target: service})
		if err != nil {
			t.Fatal(err)
		}
		selectorEdges := 0
		for _, edge := range got.Edges {
			if edge.Type == ResourceMapEdgeSelector {
				selectorEdges++
			}
		}
		if selectorEdges != 2 || findResourceMapNode(got, pod) == nil {
			t.Fatalf("equal duplicate Service semantics lost evidence variants: edges=%+v", got.Edges)
		}
	})

	for _, test := range []struct {
		name   string
		mutate func(*dto.ResourceRelationshipRecord)
	}{
		{name: "different MatchLabels", mutate: func(r *dto.ResourceRelationshipRecord) {
			r.Selectors[0].MatchLabels = map[string]string{"app": "other"}
		}},
		{name: "empty versus nonempty", mutate: func(r *dto.ResourceRelationshipRecord) { r.Selectors[0].MatchLabels = map[string]string{} }},
		{name: "target disagreement", mutate: func(r *dto.ResourceRelationshipRecord) { r.Selectors[0].Target.Version = "v2" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			plane, service, _, owner, object := selectorGateFixture(t)
			s, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
			duplicate := s.Relationships[0]
			duplicate.Selectors = append([]dto.ResourceRelationshipSelectorDTO(nil), duplicate.Selectors...)
			test.mutate(&duplicate)
			s.Items = make([]dto.ServiceListItemDTO, 2)
			s.Relationships = append(s.Relationships, duplicate)
			s.RelationshipMetadata.SourceItems, s.RelationshipMetadata.EvidenceRecords = 2, 2
			setNamespacedSnapshot(&plane.svcsStore, "apps", s)
			got := assertSelectorGateSuppressed(t, plane, service, owner, object)
			if !reasonContains(got.Coverage.Families[dto.ResourceRelationshipFamilySelector].Reasons, "conflicting Service selector evidence") {
				t.Fatalf("Service semantic conflict reason missing: %+v", got.Coverage.Families)
			}
		})
	}
}

func TestResourceMapSelectorAllNamespacesExactFiltering(t *testing.T) {
	plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
	seedCompleteEmptyClusterResourceMapInventory(plane)
	seedCompleteEmptyResourceMapAllNamespacesInventory(plane)
	service := resourceMapIdentity("", "v1", "services", "Service", "apps", "api", "svc-apps")
	otherService := resourceMapIdentity("", "v1", "services", "Service", "other", "api", "svc-other")
	pod := resourceMapIdentity("", "v1", "pods", "Pod", "apps", "api-0", "pod-apps")
	otherPod := resourceMapIdentity("", "v1", "pods", "Pod", "other", "api-0", "pod-other")
	selector := testServicePodSelector(map[string]string{"app": "api"}, "spec.selector")
	setNamespacedSnapshot(&plane.svcsStore, "", ServicesSnapshot{
		Items: make([]dto.ServiceListItemDTO, 2), Meta: resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(service, nil, selector), testSelectorResourceMapRecord(otherService, nil, selector)},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2, dto.ResourceRelationshipFamilySelector),
	})
	setNamespacedSnapshot(&plane.podsStore, "", PodsSnapshot{
		Items: make([]dto.PodListItemDTO, 2), Meta: resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(pod, map[string]string{"app": "api"}), testSelectorResourceMapRecord(otherPod, map[string]string{"app": "api"})},
		RelationshipMetadata: completeResourceMapRelationshipMetadataFor(2, 2, dto.ResourceRelationshipFamilyLabels),
	})
	for _, target := range []dto.ResourceIdentityDTO{service, pod} {
		got, err := plane.ResourceMap(ResourceMapRequest{Target: target})
		if err != nil {
			t.Fatal(err)
		}
		if findResourceMapNode(got, service) == nil || findResourceMapNode(got, pod) == nil || findResourceMapNode(got, otherService) != nil || findResourceMapNode(got, otherPod) != nil {
			t.Fatalf("all-namespace selector filtering for %s = %+v", target.Kind, got.Nodes)
		}
	}
}

func TestResourceMapSelectorDedupIdentityAndEvidenceIsolation(t *testing.T) {
	plane, service, pod, _, _ := selectorGateFixture(t)
	s, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
	exact := s.Relationships[0].Selectors[0]
	variant := exact
	variant.Source.FieldPath = "metadata.annotations[selector]"
	s.Relationships[0].Selectors = []dto.ResourceRelationshipSelectorDTO{exact, exact, variant}
	setNamespacedSnapshot(&plane.svcsStore, "apps", s)
	first, err := plane.ResourceMap(ResourceMapRequest{Target: service})
	if err != nil {
		t.Fatal(err)
	}
	var selectorEdges []ResourceMapEdge
	for _, edge := range first.Edges {
		if edge.Type == ResourceMapEdgeSelector {
			selectorEdges = append(selectorEdges, edge)
		}
	}
	if len(selectorEdges) != 2 || selectorEdges[0].ID == selectorEdges[1].ID || findResourceMapNode(first, pod) == nil {
		t.Fatalf("selector exact dedup/variant preservation/identity = edges=%+v nodes=%+v", selectorEdges, first.Nodes)
	}
	firstSignature := resourceMapSignature(first)
	selectorEdges[0].Evidence.Selector["app"] = "mutated"
	cached, _ := peekNamespacedSnapshot(&plane.svcsStore, "apps")
	if cached.Relationships[0].Selectors[0].MatchLabels["app"] != "api" {
		t.Fatalf("response selector mutation reached cached sidecar: %+v", cached.Relationships[0].Selectors)
	}
	second, err := plane.ResourceMap(ResourceMapRequest{Target: service})
	if err != nil || resourceMapSignature(second) != firstSignature {
		t.Fatalf("selector mutation changed next response IDs: err=%v first=%q second=%q", err, firstSignature, resourceMapSignature(second))
	}
	for _, edge := range second.Edges {
		if edge.Type == ResourceMapEdgeSelector && edge.Evidence.Selector["app"] != "api" {
			t.Fatalf("selector mutation changed next response: %+v", edge)
		}
	}
}

func TestResourceMapSelectorIndexStructure(t *testing.T) {
	fset := token.NewFileSet()
	file := parseResourceMapFile(t, fset, "resource_map.go")
	functions := map[string]*ast.FuncDecl{}
	var indexStruct *ast.StructType
	for _, decl := range file.Decls {
		switch value := decl.(type) {
		case *ast.FuncDecl:
			functions[methodReceiverType(value)+"."+value.Name.Name] = value
		case *ast.GenDecl:
			for _, spec := range value.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != "resourceMapIndex" {
					continue
				}
				indexStruct, _ = typeSpec.Type.(*ast.StructType)
			}
		}
	}
	incident := functions["compactResourceGraph.incident"]
	build := functions["resourceMapIndex.buildSelectorIndexes"]
	if incident == nil || build == nil || functions["resourceMapIndex.smallestSelectorPosting"] == nil || functions["resourceMapIndex.selectorMatchesPod"] == nil {
		t.Fatalf("selector index functions missing: %v", functions)
	}

	postingKeyBuilt := false
	podsByLabelIndexed := false
	ast.Inspect(build.Body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.CompositeLit:
			ident, ok := value.Type.(*ast.Ident)
			if !ok || ident.Name != "resourceMapLabelKey" {
				return true
			}
			fields := map[string]bool{}
			for _, element := range value.Elts {
				if pair, ok := element.(*ast.KeyValueExpr); ok {
					if key, ok := pair.Key.(*ast.Ident); ok {
						fields[key.Name] = true
					}
				}
			}
			postingKeyBuilt = postingKeyBuilt || fields["namespace"] && fields["key"] && fields["value"]
		case *ast.IndexExpr:
			if selector, ok := value.X.(*ast.SelectorExpr); ok && selector.Sel.Name == "podsByLabel" {
				podsByLabelIndexed = true
			}
		}
		return true
	})
	if !postingKeyBuilt || !podsByLabelIndexed {
		t.Fatalf("buildSelectorIndexes must construct namespace/key/value postings and index podsByLabel")
	}
	assertNoNestedRangesAcross(t, build.Body, "podLabels", "selectorsByService", "selector index build")

	var forward, reverse bool
	ast.Inspect(incident.Body, func(node ast.Node) bool {
		ifStmt, ok := node.(*ast.IfStmt)
		if !ok {
			return true
		}
		if astContainsString(ifStmt.Cond, "services") {
			smallest := astCallPositions(ifStmt.Body, "smallestSelectorPosting")
			matches := astCallPositions(ifStmt.Body, "selectorMatchesPod")
			forward = len(smallest) > 0 && len(matches) > 0 && smallest[0] < matches[len(matches)-1]
		}
		if astContainsString(ifStmt.Cond, "pods") {
			reverse = len(astCallPositions(ifStmt.Body, "selectorMatchesPod")) > 0 && astIndexesField(ifStmt.Body, "reverseSelector")
		}
		return true
	})
	if !forward {
		t.Error("forward selector traversal must call smallestSelectorPosting before final selectorMatchesPod verification")
	}
	if !reverse {
		t.Error("reverse selector traversal must use reverseSelector postings keyed while ranging Pod labels and verify selectorMatchesPod")
	}
	assertNoRangeOverSelector(t, incident.Body, "records", "selector incident")
	assertNoNestedRangesOverFields(t, incident.Body, "selectorsByService", "podLabels", "selector incident")
	if indexStruct == nil {
		t.Fatal("resourceMapIndex struct missing")
	}
	for _, field := range indexStruct.Fields.List {
		for _, name := range field.Names {
			if strings.Contains(strings.ToLower(name.Name), "edge") || strings.Contains(strings.ToLower(name.Name), "adjacency") {
				t.Errorf("resourceMapIndex must not pre-materialize edge adjacency: field %q", name.Name)
			}
		}
	}
}

func astCallPositions(node ast.Node, method string) []token.Pos {
	var positions []token.Pos
	ast.Inspect(node, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if ok && selector.Sel.Name == method {
			positions = append(positions, call.Pos())
		}
		return true
	})
	return positions
}

func astContainsString(node ast.Node, want string) bool {
	found := false
	ast.Inspect(node, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if ok && literal.Kind == token.STRING && strings.Trim(literal.Value, "\"") == want {
			found = true
			return false
		}
		return !found
	})
	return found
}

func astIndexesField(node ast.Node, field string) bool {
	found := false
	ast.Inspect(node, func(node ast.Node) bool {
		index, ok := node.(*ast.IndexExpr)
		if !ok {
			return true
		}
		selector, ok := index.X.(*ast.SelectorExpr)
		if ok && selector.Sel.Name == field {
			found = true
			return false
		}
		return true
	})
	return found
}

func rangeRootName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.SelectorExpr:
		return value.Sel.Name
	default:
		return ""
	}
}

func assertNoNestedRangesAcross(t *testing.T, node ast.Node, first, second, location string) {
	t.Helper()
	ast.Inspect(node, func(node ast.Node) bool {
		outer, ok := node.(*ast.RangeStmt)
		if !ok {
			return true
		}
		outerName := rangeRootName(outer.X)
		if outerName != first && outerName != second {
			return true
		}
		ast.Inspect(outer.Body, func(node ast.Node) bool {
			inner, ok := node.(*ast.RangeStmt)
			if !ok {
				return true
			}
			innerName := rangeRootName(inner.X)
			if (outerName == first && innerName == second) || (outerName == second && innerName == first) {
				t.Errorf("%s must not nest %s and %s ranges", location, first, second)
			}
			return true
		})
		return false
	})
}

func assertNoNestedRangesOverFields(t *testing.T, node ast.Node, outer, inner, location string) {
	t.Helper()
	ast.Inspect(node, func(node ast.Node) bool {
		rangeStmt, ok := node.(*ast.RangeStmt)
		if !ok {
			return true
		}
		selector, ok := rangeStmt.X.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != outer {
			return true
		}
		ast.Inspect(rangeStmt.Body, func(n ast.Node) bool {
			nested, ok := n.(*ast.RangeStmt)
			if !ok {
				return true
			}
			field, ok := nested.X.(*ast.SelectorExpr)
			if ok && field.Sel.Name == inner {
				t.Errorf("%s must not nest full %s and %s ranges", location, outer, inner)
			}
			return true
		})
		return false
	})
}

func BenchmarkResourceMapServicePodSelector(b *testing.B) {
	for _, size := range []int{10_000, 50_000} {
		b.Run(fmt.Sprintf("records-%d", size), func(b *testing.B) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			seedCompleteEmptyResourceMapInventory(plane)
			service := resourceMapIdentity("", "v1", "services", "Service", "apps", "selected", "service")
			selector := testServicePodSelector(map[string]string{"app": "workload", "selection": "bounded"}, "spec.selector")
			setNamespacedSnapshot(&plane.svcsStore, "apps", ServicesSnapshot{Items: make([]dto.ServiceListItemDTO, 1), Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testSelectorResourceMapRecord(service, nil, selector)}, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(1, 1, dto.ResourceRelationshipFamilySelector)})
			podCount := size - 1
			pods := make([]dto.ResourceRelationshipRecord, podCount)
			for i := range pods {
				selection := fmt.Sprintf("bucket-%03d", i%100)
				if i < 5 {
					selection = "bounded"
				}
				pods[i] = testSelectorResourceMapRecord(resourceMapIdentity("", "v1", "pods", "Pod", "apps", fmt.Sprintf("pod-%05d", i), fmt.Sprintf("pod-uid-%05d", i)), map[string]string{"app": "workload", "selection": selection, "zone": fmt.Sprintf("zone-%d", i%8)})
			}
			setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Items: make([]dto.PodListItemDTO, podCount), Meta: resourceMapMeta(), Relationships: pods, RelationshipMetadata: completeResourceMapRelationshipMetadataFor(podCount, podCount, dto.ResourceRelationshipFamilyLabels)})
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				got, err := plane.ResourceMap(ResourceMapRequest{Target: service})
				if err != nil || len(got.Edges) < 5 {
					b.Fatalf("selector benchmark projection: edges=%d err=%v", len(got.Edges), err)
				}
			}
		})
	}
}

func BenchmarkResourceMapBroadOwnerNamespace(b *testing.B) {
	for _, size := range []int{10_000, 50_000} {
		b.Run(fmt.Sprintf("records-%d", size), func(b *testing.B) {
			plane := newClusterPlane("ctx", "", "", ObservationScope{}, nil, nil, nil)
			namespace := resourceMapIdentity("", "v1", "namespaces", "Namespace", "", "apps", "namespace")
			setClusterSnapshot(&plane.nsStore, NamespaceSnapshot{Meta: resourceMapMeta(), Relationships: []dto.ResourceRelationshipRecord{testResourceMapRecord(namespace)}})
			owners := make([]dto.ResourceRelationshipRecord, size/2)
			children := make([]dto.ResourceRelationshipRecord, size-len(owners))
			for i := range owners {
				name := fmt.Sprintf("workload-%05d", i)
				owners[i] = testResourceMapRecord(resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", name, fmt.Sprintf("owner-%05d", i)))
			}
			for i := range children {
				ownerIndex := i % len(owners)
				children[i] = testResourceMapRecord(
					resourceMapIdentity("", "v1", "pods", "Pod", "apps", fmt.Sprintf("pod-%05d", i), fmt.Sprintf("pod-%05d", i)),
					dto.ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "Deployment", Name: fmt.Sprintf("workload-%05d", ownerIndex)},
				)
			}
			setNamespacedSnapshot(&plane.depsStore, "apps", DeploymentsSnapshot{Meta: resourceMapMeta(), Relationships: owners})
			setNamespacedSnapshot(&plane.podsStore, "apps", PodsSnapshot{Meta: resourceMapMeta(), Relationships: children})
			target := children[len(children)/2].Resource

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := plane.ResourceMap(ResourceMapRequest{Target: target, Depth: 2}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func resourceMapSignature(response ResourceMapResponse) string {
	var b strings.Builder
	for _, node := range response.Nodes {
		b.WriteString(node.ID)
	}
	for _, edge := range response.Edges {
		b.WriteString(edge.ID)
	}
	return b.String()
}
