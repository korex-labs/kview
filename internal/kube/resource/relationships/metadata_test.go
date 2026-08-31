package relationships

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestCaptureMetadataCopiesCanonicalIdentityAndAllOwners(t *testing.T) {
	controller := false
	blockOwnerDeletion := true
	object := &metav1.ObjectMeta{
		Name:      "api-0",
		Namespace: "apps",
		UID:       types.UID("pod-uid"),
		Labels:    map[string]string{"ignored": "label"},
		Annotations: map[string]string{
			"ignored": "annotation",
		},
		OwnerReferences: []metav1.OwnerReference{
			{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-rs", UID: types.UID("rs-uid"), Controller: &controller},
			{APIVersion: "example.io/v1", Kind: "Tenant", Name: "apps", UID: types.UID("tenant-uid"), BlockOwnerDeletion: &blockOwnerDeletion},
		},
	}

	carrier := Capture(object, PodDescriptor)
	got := carrier.ResourceRelationshipMetadata()
	assertFullCompleteCoverage(t, got.Coverage)
	if len(got.FamilyCoverage) != 1 {
		t.Fatalf("captured family declarations = %+v, want owner only", got.FamilyCoverage)
	}
	assertFullCompleteCoverage(t, got.FamilyCoverage[dto.ResourceRelationshipFamilyOwner])
	want := dto.ResourceIdentityDTO{
		Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced,
		Namespace: "apps", Name: "api-0", UID: "pod-uid",
	}
	if got.Version != dto.ResourceRelationshipRecordVersion {
		t.Fatalf("version = %d, want %d", got.Version, dto.ResourceRelationshipRecordVersion)
	}
	if got.Resource != want {
		t.Fatalf("identity = %+v, want %+v", got.Resource, want)
	}
	if len(got.Owners) != 2 {
		t.Fatalf("owners = %d, want 2", len(got.Owners))
	}
	if got.Owners[0].Controller == nil || *got.Owners[0].Controller || got.Owners[0].BlockOwnerDeletion != nil {
		t.Fatalf("first owner pointer presence/value = %+v", got.Owners[0])
	}
	if got.Owners[1].Controller != nil || got.Owners[1].BlockOwnerDeletion == nil || !*got.Owners[1].BlockOwnerDeletion {
		t.Fatalf("second owner pointer presence/value = %+v", got.Owners[1])
	}
	if got.Owners[1].APIVersion != "example.io/v1" || got.Owners[1].Kind != "Tenant" || got.Owners[1].Name != "apps" || got.Owners[1].UID != "tenant-uid" {
		t.Fatalf("second owner incomplete: %+v", got.Owners[1])
	}

	controller = true
	blockOwnerDeletion = false
	object.OwnerReferences[0].Name = "mutated"
	again := carrier.ResourceRelationshipMetadata()
	if *again.Owners[0].Controller || !*again.Owners[1].BlockOwnerDeletion || again.Owners[0].Name != "api-rs" {
		t.Fatalf("carrier aliases source owner metadata: %+v", again.Owners)
	}
}

func TestCaptureMetadataWithoutOwnersIsStillFullAndComplete(t *testing.T) {
	got := Capture(&metav1.ObjectMeta{Name: "api", Namespace: "apps"}, PodDescriptor).ResourceRelationshipMetadata()

	if len(got.Owners) != 0 {
		t.Fatalf("owners = %d, want zero", len(got.Owners))
	}
	if len(got.References) != 0 {
		t.Fatalf("references = %d, want zero", len(got.References))
	}
	assertFullCompleteCoverage(t, got.Coverage)
	assertFullCompleteCoverage(t, got.FamilyCoverage[dto.ResourceRelationshipFamilyOwner])
}

func assertFullCompleteCoverage(t *testing.T, got dto.ResourceRelationshipCoverageDTO) {
	t.Helper()
	want := dto.ResourceRelationshipCoverageDTO{
		Coverage:     dto.ResourceRelationshipCoverageFull,
		Completeness: dto.ResourceRelationshipCompletenessComplete,
	}
	if got != want {
		t.Fatalf("coverage = %+v, want %+v", got, want)
	}
}

func TestCaptureMetadataClusterScopeClearsNamespaceAndUIDStabilizesIdentity(t *testing.T) {
	first := &metav1.ObjectMeta{Name: "worker", Namespace: "must-be-cleared", UID: types.UID("uid-1")}
	second := first.DeepCopy()
	second.UID = types.UID("uid-2")

	firstRecord := Capture(first, NodeDescriptor).ResourceRelationshipMetadata()
	secondRecord := Capture(second, NodeDescriptor).ResourceRelationshipMetadata()
	if firstRecord.Resource.Namespace != "" {
		t.Fatalf("cluster namespace = %q, want empty", firstRecord.Resource.Namespace)
	}
	if firstRecord.Resource.CanonicalIdentity() == secondRecord.Resource.CanonicalIdentity() {
		t.Fatal("same name with different UIDs produced identical stable identities")
	}
}
