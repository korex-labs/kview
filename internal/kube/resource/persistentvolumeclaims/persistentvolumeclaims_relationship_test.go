package persistentvolumeclaims

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestPersistentVolumeClaimListMapperCarriesVolumeReferenceAndEmptyCoverage(t *testing.T) {
	pvc := corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "apps"}, Spec: corev1.PersistentVolumeClaimSpec{VolumeName: "pv-data"}}
	record := mapPersistentVolumeClaim(pvc, time.Unix(1_700_000_000, 0)).ResourceRelationshipMetadata()
	if len(record.References) != 1 {
		t.Fatalf("references = %+v", record.References)
	}
	ref := record.References[0]
	if ref.Target.Resource != "persistentvolumes" || ref.Target.Kind != "PersistentVolume" || ref.Target.Scope != dto.ResourceScopeCluster || ref.Target.Namespace != "" || ref.Target.Name != "pv-data" || ref.Source.FieldPath != "spec.volumeName" {
		t.Fatalf("volume reference = %+v", ref)
	}
	assertPVCFull(t, record)

	pvc.Spec.VolumeName = ""
	empty := mapPersistentVolumeClaim(pvc, time.Time{}).ResourceRelationshipMetadata()
	if len(empty.References) != 0 {
		t.Fatalf("empty references = %+v", empty.References)
	}
	assertPVCFull(t, empty)
}

func assertPVCFull(t *testing.T, record dto.ResourceRelationshipRecord) {
	t.Helper()
	got := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if got.Coverage != dto.ResourceRelationshipCoverageFull || got.Completeness != dto.ResourceRelationshipCompletenessComplete || record.Coverage != got {
		t.Fatalf("coverage = %+v family=%+v", record.Coverage, got)
	}
}
