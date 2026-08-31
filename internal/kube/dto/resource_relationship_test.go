package dto

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

type resourceRelationshipJSONItem struct {
	Name                        string `json:"name"`
	ResourceRelationshipCarrier `json:"-"`
}

func TestResourceRelationshipCarrierIsHiddenFromItemJSON(t *testing.T) {
	item := resourceRelationshipJSONItem{
		Name: "api-0",
		ResourceRelationshipCarrier: ResourceRelationshipCarrier{
			Resource: ResourceIdentityDTO{
				Group:     "",
				Version:   "v1",
				Resource:  "pods",
				Kind:      "Pod",
				Scope:     ResourceScopeNamespaced,
				Namespace: "apps",
				Name:      "api-0",
				UID:       "pod-uid",
			},
			Owners: []ResourceOwnerReferenceDTO{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "api-abc",
				UID:        "rs-uid",
			}},
		},
	}

	payload, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("marshal item: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode item: %v", err)
	}
	if !reflect.DeepEqual(decoded, map[string]any{"name": "api-0"}) {
		t.Fatalf("hidden carrier leaked into item JSON: %s", payload)
	}
}

func TestResourceRelationshipIdentityValidationAndCanonicalIdentity(t *testing.T) {
	namespaced := ResourceIdentityDTO{
		Group:     "apps",
		Version:   "v1",
		Resource:  "deployments",
		Kind:      "Deployment",
		Scope:     ResourceScopeNamespaced,
		Namespace: "apps",
		Name:      "api",
		UID:       "uid-1",
	}
	if err := namespaced.Validate(); err != nil {
		t.Fatalf("valid namespaced identity: %v", err)
	}
	clusterScoped := namespaced
	clusterScoped.Scope = ResourceScopeCluster
	clusterScoped.Namespace = ""
	if err := clusterScoped.Validate(); err != nil {
		t.Fatalf("valid cluster identity: %v", err)
	}
	if namespaced.CanonicalIdentity() == clusterScoped.CanonicalIdentity() {
		t.Fatal("namespaced and cluster identities collided")
	}
	recreated := namespaced
	recreated.UID = "uid-2"
	if namespaced.CanonicalIdentity() == recreated.CanonicalIdentity() {
		t.Fatal("UID did not distinguish recreated resource")
	}

	invalid := []ResourceIdentityDTO{
		{},
		{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Name: "api"},
		{Version: "v1", Resource: "nodes", Kind: "Node", Scope: ResourceScopeCluster, Namespace: "apps", Name: "worker"},
		{Version: "v1", Resource: "pods", Kind: "Pod", Scope: "other", Namespace: "apps", Name: "api"},
	}
	for _, identity := range invalid {
		if err := identity.Validate(); err == nil {
			t.Fatalf("invalid identity passed validation: %+v", identity)
		}
	}
}

func TestResourceRelationshipCarrierReturnsDefensiveMetadataCopy(t *testing.T) {
	controller := false
	blockOwnerDeletion := true
	item := resourceRelationshipJSONItem{
		ResourceRelationshipCarrier: ResourceRelationshipCarrier{
			Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api-0"},
			Owners: []ResourceOwnerReferenceDTO{{
				APIVersion:         "apps/v1",
				Kind:               "ReplicaSet",
				Name:               "api-rs",
				UID:                "rs-uid",
				Controller:         &controller,
				BlockOwnerDeletion: &blockOwnerDeletion,
			}},
			References: []ResourceReferenceDTO{{
				Type:   ResourceRelationshipTypeSelector,
				Target: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api-1"},
				Source: ResourceRelationshipSourceDTO{Type: ResourceRelationshipSourceKubernetes, FieldPath: "spec.selector"},
				Evidence: ResourceRelationshipEvidenceDTO{
					Description: "workload selector",
					Selector:    map[string]string{"app": "api"},
				},
				Coverage: ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete},
			}},
			Coverage: ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete},
		},
	}

	got := item.ResourceRelationshipMetadata()
	if got.Version != ResourceRelationshipRecordVersion {
		t.Fatalf("record version = %d", got.Version)
	}
	if got.Owners[0].Controller == nil || *got.Owners[0].Controller || got.Owners[0].BlockOwnerDeletion == nil || !*got.Owners[0].BlockOwnerDeletion {
		t.Fatalf("owner pointer presence/value not preserved: %+v", got.Owners[0])
	}
	got.Owners[0].Name = "changed"
	*got.Owners[0].Controller = true
	got.References[0].Evidence.Selector["app"] = "changed"

	again := item.ResourceRelationshipMetadata()
	if again.Owners[0].Name != "api-rs" || *again.Owners[0].Controller || again.References[0].Evidence.Selector["app"] != "api" {
		t.Fatalf("carrier metadata was aliased: %+v", again)
	}
}

func TestExtractResourceRelationshipsPreservesRawOrderAndDuplicates(t *testing.T) {
	itemZ := resourceRelationshipJSONItem{
		Name: "z",
		ResourceRelationshipCarrier: ResourceRelationshipCarrier{
			Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "z"},
			References: []ResourceReferenceDTO{{
				Type:     ResourceRelationshipTypeSelector,
				Evidence: ResourceRelationshipEvidenceDTO{Selector: map[string]string{"app": "z"}},
			}},
		},
	}
	itemA := resourceRelationshipJSONItem{
		Name: "a",
		ResourceRelationshipCarrier: ResourceRelationshipCarrier{
			Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "a"},
		},
	}

	got := ExtractResourceRelationships([]resourceRelationshipJSONItem{itemZ, itemA, itemZ})
	if len(got) != 3 {
		t.Fatalf("extracted relationships = %d, want raw duplicate retained", len(got))
	}
	if names := []string{got[0].Resource.Name, got[1].Resource.Name, got[2].Resource.Name}; !reflect.DeepEqual(names, []string{"z", "a", "z"}) {
		t.Fatalf("extracted resource order = %v, want input order with duplicate", names)
	}
	if !reflect.DeepEqual(got[0], got[2]) {
		t.Fatalf("exact duplicate changed during collection: first=%+v third=%+v", got[0], got[2])
	}

	got[0].References[0].Evidence.Selector["app"] = "mutated"
	if itemZ.References[0].Evidence.Selector["app"] != "z" || got[2].References[0].Evidence.Selector["app"] != "z" {
		t.Fatalf("collected metadata aliases carrier or another collected record: item=%q duplicate=%q", itemZ.References[0].Evidence.Selector["app"], got[2].References[0].Evidence.Selector["app"])
	}
}

func TestResourceRelationshipV1LegacyJSONDecode(t *testing.T) {
	const payload = `{"version":1,"resource":{"group":"apps","version":"v1","resource":"deployments","kind":"Deployment","scope":"namespaced","namespace":"apps","name":"api","uid":"dep-uid"},"owners":[{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"api-rs","uid":"rs-uid","controller":false,"blockOwnerDeletion":true}],"references":[{"type":"selector","target":{"group":"","version":"v1","resource":"pods","kind":"Pod","scope":"namespaced","namespace":"apps","name":"api-0"},"source":{"type":"kubernetes","fieldPath":"spec.selector"},"evidence":{"description":"legacy selector","selector":{"app.kubernetes.io/name":"api"}},"coverage":{"coverage":"full","completeness":"complete"}}],"coverage":{"coverage":"full","completeness":"complete"}}`
	var got ResourceRelationshipRecord
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatalf("decode exact v1 payload: %v", err)
	}
	if got.Version != 1 || got.Resource.UID != "dep-uid" || len(got.Owners) != 1 || got.Owners[0].Controller == nil || *got.Owners[0].Controller || got.Owners[0].BlockOwnerDeletion == nil || !*got.Owners[0].BlockOwnerDeletion {
		t.Fatalf("legacy identity/owner changed: %+v", got)
	}
	if len(got.References) != 1 || got.References[0].Evidence.Selector["app.kubernetes.io/name"] != "api" {
		t.Fatalf("legacy selector evidence changed: %+v", got.References)
	}
}

func TestNormalizeResourceRelationshipRecordsBoundsAndFamilyIsolation(t *testing.T) {
	full := ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}
	base := ResourceRelationshipRecord{
		Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api-0"},
		Owners:   []ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-rs", UID: "rs-uid"}},
		Coverage: full,
		References: []ResourceReferenceDTO{
			{Type: ResourceRelationshipTypeObjectReference, Target: ResourceIdentityDTO{Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "settings"}},
			{Type: ResourceRelationshipTypeKindDefinition, Target: ResourceIdentityDTO{Version: "v1", Resource: "customresourcedefinitions", Kind: "CustomResourceDefinition", Scope: ResourceScopeCluster, Name: "widgets.example.io"}},
		},
		Labels:    map[string]string{},
		Selectors: []ResourceRelationshipSelectorDTO{{Target: ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced}, MatchLabels: map[string]string{}, Coverage: full}},
		FamilyCoverage: map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO{
			ResourceRelationshipFamilyOwner: full, ResourceRelationshipFamilyObjectReference: full, ResourceRelationshipFamilyKindDefinition: full,
			ResourceRelationshipFamilySelector: full, ResourceRelationshipFamilyLabels: full,
		},
	}

	t.Run("valid empty evidence is retained", func(t *testing.T) {
		got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{base})[0]
		if got.Version != ResourceRelationshipRecordVersion || len(got.Labels) != 0 || len(got.Selectors) != 1 || got.Selectors[0].MatchLabels == nil {
			t.Fatalf("valid empty evidence changed: %+v", got)
		}
		payload, _ := json.Marshal(got.Selectors[0].Target)
		if strings.Contains(string(payload), `"name"`) || strings.Contains(string(payload), `"namespace"`) {
			t.Fatalf("selector target fabricated concrete identity: %s", payload)
		}
	})

	tests := []struct {
		name   string
		mutate func(*ResourceRelationshipRecord)
		family ResourceRelationshipFamily
	}{
		{"malformed label", func(r *ResourceRelationshipRecord) { r.Labels = map[string]string{"bad key": "ok"} }, ResourceRelationshipFamilyLabels},
		{"label count overflow", func(r *ResourceRelationshipRecord) {
			r.Labels = relationshipTestMap(ResourceRelationshipMaxLabels+1, false)
		}, ResourceRelationshipFamilyLabels},
		{"label byte overflow", func(r *ResourceRelationshipRecord) {
			r.Labels = relationshipTestMap(ResourceRelationshipMaxLabels, true)
		}, ResourceRelationshipFamilyLabels},
		{"malformed selector", func(r *ResourceRelationshipRecord) { r.Selectors[0].MatchLabels = map[string]string{"bad key": "ok"} }, ResourceRelationshipFamilySelector},
		{"selector count overflow", func(r *ResourceRelationshipRecord) {
			r.Selectors[0].MatchLabels = relationshipTestMap(ResourceRelationshipMaxSelectorMatchLabels+1, false)
		}, ResourceRelationshipFamilySelector},
		{"selector byte overflow", func(r *ResourceRelationshipRecord) {
			r.Selectors[0].MatchLabels = relationshipTestMap(ResourceRelationshipMaxSelectorMatchLabels, true)
		}, ResourceRelationshipFamilySelector},
		{"selector slice count overflow", func(r *ResourceRelationshipRecord) {
			selector := r.Selectors[0]
			r.Selectors = make([]ResourceRelationshipSelectorDTO, ResourceRelationshipMaxSelectors+1)
			for index := range r.Selectors {
				r.Selectors[index] = selector
			}
		}, ResourceRelationshipFamilySelector},
		{"selector slice aggregate byte overflow", func(r *ResourceRelationshipRecord) {
			selector := r.Selectors[0]
			selector.Source.FieldPath = strings.Repeat("x", ResourceRelationshipMaxSelectorsBytes/ResourceRelationshipMaxSelectors+1)
			r.Selectors = make([]ResourceRelationshipSelectorDTO, ResourceRelationshipMaxSelectors)
			for index := range r.Selectors {
				r.Selectors[index] = selector
			}
		}, ResourceRelationshipFamilySelector},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := cloneResourceRelationshipRecord(base)
			test.mutate(&record)
			got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
			coverage := got.FamilyCoverage[test.family]
			if coverage.Coverage != ResourceRelationshipCoveragePartial || coverage.Completeness != ResourceRelationshipCompletenessPartial {
				t.Fatalf("invalid family coverage = %+v", coverage)
			}
			if got.Coverage.Coverage != ResourceRelationshipCoveragePartial || got.Coverage.Completeness != ResourceRelationshipCompletenessPartial {
				t.Fatalf("invalid family did not degrade aggregate coverage: %+v", got.Coverage)
			}
			if test.family == ResourceRelationshipFamilyLabels && got.Labels != nil {
				t.Fatalf("invalid labels were partly retained: %+v", got.Labels)
			}
			if test.family == ResourceRelationshipFamilySelector && got.Selectors != nil {
				t.Fatalf("invalid selector family was partly retained: %+v", got.Selectors)
			}
			if len(got.Owners) != 1 || len(got.References) != 2 {
				t.Fatalf("unrelated evidence family was downgraded: %+v", got)
			}
		})
	}
}

func TestNormalizeResourceRelationshipRecordsAllOrNothingReferenceFamiliesAndNoAliasing(t *testing.T) {
	full := ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}
	validObject := ResourceReferenceDTO{Type: ResourceRelationshipTypeObjectReference, Target: ResourceIdentityDTO{Version: "v1", Resource: "secrets", Kind: "Secret", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "token"}}
	invalidObject := validObject
	invalidObject.Target.Name = ""
	kindDefinition := ResourceReferenceDTO{Type: ResourceRelationshipTypeKindDefinition, Target: ResourceIdentityDTO{Version: "v1", Resource: "customresourcedefinitions", Kind: "CustomResourceDefinition", Scope: ResourceScopeCluster, Name: "widgets.example.io"}}
	record := ResourceRelationshipRecord{
		Resource:   ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api"},
		References: []ResourceReferenceDTO{validObject, kindDefinition, invalidObject, validObject}, Labels: map[string]string{"app": "api"},
		Selectors:      []ResourceRelationshipSelectorDTO{{Target: ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced}, MatchLabels: map[string]string{"app": "api"}}},
		FamilyCoverage: map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO{ResourceRelationshipFamilyObjectReference: full, ResourceRelationshipFamilyKindDefinition: full, ResourceRelationshipFamilyLabels: full, ResourceRelationshipFamilySelector: full},
	}
	got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
	if len(got.References) != 1 || got.References[0].Type != ResourceRelationshipTypeKindDefinition {
		t.Fatalf("object-reference family was not discarded atomically or kind family was lost: %+v", got.References)
	}
	if got.FamilyCoverage[ResourceRelationshipFamilyObjectReference].Coverage != ResourceRelationshipCoveragePartial || got.FamilyCoverage[ResourceRelationshipFamilyKindDefinition] != full {
		t.Fatalf("reference family coverage was not isolated: %+v", got.FamilyCoverage)
	}
	record.Labels["app"] = "mutated"
	record.Selectors[0].MatchLabels["app"] = "mutated"
	record.FamilyCoverage[ResourceRelationshipFamilyKindDefinition] = ResourceRelationshipCoverageDTO{}
	if got.Labels["app"] != "api" || got.Selectors[0].MatchLabels["app"] != "api" || got.FamilyCoverage[ResourceRelationshipFamilyKindDefinition] != full {
		t.Fatalf("normalized record aliases input deeply: %+v", got)
	}
}

func TestNormalizeResourceRelationshipRecordsDeterministicExactDedup(t *testing.T) {
	ownerA := ResourceOwnerReferenceDTO{APIVersion: "v1", Kind: "ConfigMap", Name: "a", UID: "a"}
	ownerZ := ResourceOwnerReferenceDTO{APIVersion: "v1", Kind: "ConfigMap", Name: "z", UID: "z"}
	recordZ := ResourceRelationshipRecord{Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "z"}, Owners: []ResourceOwnerReferenceDTO{ownerZ, ownerA, ownerZ}}
	recordA := recordZ
	recordA.Resource.Name = "a"
	got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{recordZ, recordA, recordZ})
	if len(got) != 2 || got[0].Resource.Name != "a" || got[1].Resource.Name != "z" || len(got[1].Owners) != 2 || got[1].Owners[0].Name != "a" {
		t.Fatalf("normalization order/dedup is not deterministic: %+v", got)
	}
}

func TestNormalizeResourceRelationshipRecordsInvalidatesFamiliesAcrossCarriers(t *testing.T) {
	full := ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}
	identity := ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api"}
	target := ResourceIdentityDTO{Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "settings"}
	newRecord := func() ResourceRelationshipRecord {
		ref := func(relationshipType ResourceRelationshipType) ResourceReferenceDTO {
			return ResourceReferenceDTO{Type: relationshipType, Target: target}
		}
		return ResourceRelationshipRecord{
			Resource:   identity,
			Owners:     []ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-rs", UID: "rs-uid"}},
			References: []ResourceReferenceDTO{ref(ResourceRelationshipTypeOwnerReference), ref(ResourceRelationshipTypeObjectReference), ref(ResourceRelationshipTypeKindDefinition), ref(ResourceRelationshipTypeVirtual), ref(ResourceRelationshipTypeSelector)},
			Selectors:  []ResourceRelationshipSelectorDTO{{Target: ResourceRelationshipSelectorTargetDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced}, MatchLabels: map[string]string{"app": "api"}}},
			FamilyCoverage: map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO{
				ResourceRelationshipFamilyOwner: full, ResourceRelationshipFamilyObjectReference: full, ResourceRelationshipFamilyKindDefinition: full,
				ResourceRelationshipFamilySelector: full, ResourceRelationshipFamilyVirtual: full,
			},
		}
	}
	assertFamilyRemoved := func(t *testing.T, got ResourceRelationshipRecord, family ResourceRelationshipFamily, relationshipType ResourceRelationshipType) {
		t.Helper()
		for _, reference := range got.References {
			if reference.Type == relationshipType {
				t.Fatalf("malformed family fragment survived: %+v", got)
			}
		}
		coverage := got.FamilyCoverage[family]
		if coverage.Coverage != ResourceRelationshipCoveragePartial || coverage.Completeness != ResourceRelationshipCompletenessPartial {
			t.Fatalf("invalid family coverage = %+v", coverage)
		}
	}

	t.Run("owner carriers", func(t *testing.T) {
		record := newRecord()
		record.Owners = append(record.Owners, ResourceOwnerReferenceDTO{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "broken"})
		got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
		assertFamilyRemoved(t, got, ResourceRelationshipFamilyOwner, ResourceRelationshipTypeOwnerReference)
		if got.Owners != nil || len(got.Selectors) != 1 || len(got.References) != 4 {
			t.Fatalf("owner invalidation was not atomic and isolated: %+v", got)
		}
	})

	for _, legacy := range []bool{true, false} {
		name := "structured selector"
		if legacy {
			name = "legacy selector"
		}
		t.Run(name, func(t *testing.T) {
			record := newRecord()
			if legacy {
				record.References[4].Evidence.Selector = map[string]string{"bad key": "value"}
			} else {
				record.Selectors[0].MatchLabels = map[string]string{"bad key": "value"}
			}
			got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
			assertFamilyRemoved(t, got, ResourceRelationshipFamilySelector, ResourceRelationshipTypeSelector)
			if got.Selectors != nil || len(got.Owners) != 1 || len(got.References) != 4 {
				t.Fatalf("selector invalidation was not atomic and isolated: %+v", got)
			}
		})
	}

	families := []struct {
		index     int
		family    ResourceRelationshipFamily
		typeValue ResourceRelationshipType
	}{
		{1, ResourceRelationshipFamilyObjectReference, ResourceRelationshipTypeObjectReference},
		{2, ResourceRelationshipFamilyKindDefinition, ResourceRelationshipTypeKindDefinition},
		{3, ResourceRelationshipFamilyVirtual, ResourceRelationshipTypeVirtual},
	}
	for _, test := range families {
		t.Run(string(test.typeValue), func(t *testing.T) {
			record := newRecord()
			record.References[test.index].Target.Name = ""
			got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
			assertFamilyRemoved(t, got, test.family, test.typeValue)
			if len(got.References) != 4 || len(got.Owners) != 1 || len(got.Selectors) != 1 {
				t.Fatalf("reference-family invalidation was not isolated: %+v", got)
			}
		})
	}
}

func TestDegradeFamilyPreservesWorstStateIndependently(t *testing.T) {
	tests := []struct {
		name    string
		initial *ResourceRelationshipCoverageDTO
		want    ResourceRelationshipCoverageDTO
	}{
		{"absent", nil, ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoveragePartial, Completeness: ResourceRelationshipCompletenessPartial}},
		{"unknown", &ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageUnknown, Completeness: ResourceRelationshipCompletenessUnknown}, ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageUnknown, Completeness: ResourceRelationshipCompletenessUnknown}},
		{"partial", &ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoveragePartial, Completeness: ResourceRelationshipCompletenessPartial}, ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoveragePartial, Completeness: ResourceRelationshipCompletenessPartial}},
		{"full", &ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}, ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoveragePartial, Completeness: ResourceRelationshipCompletenessPartial}},
		{"independent axes", &ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageUnknown, Completeness: ResourceRelationshipCompletenessComplete}, ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageUnknown, Completeness: ResourceRelationshipCompletenessPartial}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := ResourceRelationshipRecord{Coverage: ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}}
			if test.initial != nil {
				record.FamilyCoverage = map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO{ResourceRelationshipFamilyOwner: *test.initial}
				record.Coverage = *test.initial
			}
			degradeFamily(&record, ResourceRelationshipFamilyOwner)
			if got := record.FamilyCoverage[ResourceRelationshipFamilyOwner]; got != test.want {
				t.Fatalf("degraded coverage = %+v, want %+v", got, test.want)
			}
			if record.Coverage != test.want {
				t.Fatalf("degraded aggregate coverage = %+v, want %+v", record.Coverage, test.want)
			}
		})
	}
}

func TestNormalizeResourceRelationshipRecordsDropsUnknownTypesBeforeEvidenceValidation(t *testing.T) {
	full := ResourceRelationshipCoverageDTO{Coverage: ResourceRelationshipCoverageFull, Completeness: ResourceRelationshipCompletenessComplete}
	for _, relationshipType := range []ResourceRelationshipType{"", "future-relationship"} {
		t.Run(string(relationshipType), func(t *testing.T) {
			record := ResourceRelationshipRecord{
				Resource: ResourceIdentityDTO{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "api"},
				References: []ResourceReferenceDTO{{
					Type:     relationshipType,
					Target:   ResourceIdentityDTO{Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "settings"},
					Evidence: ResourceRelationshipEvidenceDTO{Selector: relationshipTestMap(ResourceRelationshipMaxSelectorMatchLabels+1, true)},
				}},
				Coverage: full,
				FamilyCoverage: map[ResourceRelationshipFamily]ResourceRelationshipCoverageDTO{
					ResourceRelationshipFamilyOwner: full,
				},
			}
			got := NormalizeResourceRelationshipRecords([]ResourceRelationshipRecord{record})[0]
			if got.References != nil {
				t.Fatalf("unknown relationship reference survived normalization: %+v", got.References)
			}
			if got.Coverage.Coverage != ResourceRelationshipCoveragePartial || got.Coverage.Completeness != ResourceRelationshipCompletenessPartial {
				t.Fatalf("unknown relationship type retained full aggregate proof: %+v", got.Coverage)
			}
			if got.FamilyCoverage[ResourceRelationshipFamilyOwner] != full {
				t.Fatalf("unknown type degraded known owner family: %+v", got.FamilyCoverage)
			}
		})
	}
}

func relationshipTestMap(entries int, large bool) map[string]string {
	out := make(map[string]string, entries)
	for i := 0; i < entries; i++ {
		if large {
			prefixPart := strings.Repeat("a", 60)
			name := fmt.Sprintf("%02d-%s", i, strings.Repeat("b", 57))
			out[prefixPart+"."+prefixPart+"."+prefixPart+"/"+name] = strings.Repeat("v", 63)
		} else {
			out[fmt.Sprintf("key-%02d", i)] = "value"
		}
	}
	return out
}
