package persistentvolumes

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestPersistentVolumeListMapperCapturesClusterIdentityWithEmptyNamespace(t *testing.T) {
	pv := corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "ignored", UID: types.UID("pv-uid")}}
	got := mapPersistentVolume(pv, time.Unix(1_700_000_000, 0)).ResourceRelationshipMetadata().Resource
	if got.Resource != "persistentvolumes" || got.Kind != "PersistentVolume" || got.Scope != "cluster" || got.Namespace != "" || got.UID != "pv-uid" {
		t.Fatalf("persistent volume identity = %+v", got)
	}
}

func TestPersistentVolumeListMapperCarriesClaimReferenceUIDAndCoverage(t *testing.T) {
	pv := corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: "data"},
		Spec: corev1.PersistentVolumeSpec{ClaimRef: &corev1.ObjectReference{
			Namespace: "apps", Name: "data", UID: types.UID("pvc-uid"),
		}},
	}
	record := mapPersistentVolume(pv, time.Time{}).ResourceRelationshipMetadata()
	if len(record.References) != 1 {
		t.Fatalf("references = %+v", record.References)
	}
	ref := record.References[0]
	if ref.Target.Resource != "persistentvolumeclaims" || ref.Target.Kind != "PersistentVolumeClaim" || ref.Target.Scope != dto.ResourceScopeNamespaced || ref.Target.Namespace != "apps" || ref.Target.Name != "data" || ref.Target.UID != "pvc-uid" || ref.Source.FieldPath != "spec.claimRef.name" {
		t.Fatalf("claim reference = %+v", ref)
	}
	assertPVCoverage(t, record, true)

	pv.Spec.ClaimRef = nil
	empty := mapPersistentVolume(pv, time.Time{}).ResourceRelationshipMetadata()
	if len(empty.References) != 0 {
		t.Fatalf("empty references = %+v", empty.References)
	}
	assertPVCoverage(t, empty, true)

	pv.Spec.ClaimRef = &corev1.ObjectReference{Name: "data"}
	partial := mapPersistentVolume(pv, time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 0 {
		t.Fatalf("malformed references = %+v", partial.References)
	}
	assertPVCoverage(t, partial, false)
}

func assertPVCoverage(t *testing.T, record dto.ResourceRelationshipRecord, complete bool) {
	t.Helper()
	got := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	wantCoverage, wantCompleteness := dto.ResourceRelationshipCoveragePartial, dto.ResourceRelationshipCompletenessPartial
	if complete {
		wantCoverage, wantCompleteness = dto.ResourceRelationshipCoverageFull, dto.ResourceRelationshipCompletenessComplete
	}
	if got.Coverage != wantCoverage || got.Completeness != wantCompleteness || record.Coverage != got {
		t.Fatalf("coverage = %+v family=%+v", record.Coverage, got)
	}
}
