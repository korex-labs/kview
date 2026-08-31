package horizontalpodautoscalers

import (
	"testing"
	"time"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestHPAListMapperUsesStrictScaleTargetRegistry(t *testing.T) {
	for _, target := range []struct{ kind, resource string }{{"Deployment", "deployments"}, {"ReplicaSet", "replicasets"}, {"StatefulSet", "statefulsets"}} {
		t.Run(target.kind, func(t *testing.T) {
			hpa := autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: metav1.ObjectMeta{Name: "scale", Namespace: "apps"}, Spec: autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: target.kind, Name: "web"}}}
			record := summarizeHPA(hpa, time.Unix(1_700_000_000, 0)).ResourceRelationshipMetadata()
			if len(record.References) != 1 {
				t.Fatalf("references = %+v", record.References)
			}
			ref := record.References[0]
			if ref.Target.Group != "apps" || ref.Target.Version != "v1" || ref.Target.Resource != target.resource || ref.Target.Kind != target.kind || ref.Target.Namespace != "apps" || ref.Target.Name != "web" || ref.Source.FieldPath != "spec.scaleTargetRef.name" {
				t.Fatalf("scale target = %+v", ref)
			}
			assertHPACoverage(t, record, true)
		})
	}

	for _, bad := range []autoscalingv2.CrossVersionObjectReference{{}, {APIVersion: "apps/v1beta1", Kind: "Deployment", Name: "web"}, {APIVersion: "apps/v1", Kind: "DaemonSet", Name: "web"}} {
		hpa := autoscalingv2.HorizontalPodAutoscaler{ObjectMeta: metav1.ObjectMeta{Name: "bad", Namespace: "apps"}, Spec: autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: bad}}
		record := summarizeHPA(hpa, time.Time{}).ResourceRelationshipMetadata()
		if len(record.References) != 0 {
			t.Fatalf("malformed target fabricated refs: %+v", record.References)
		}
		assertHPACoverage(t, record, false)
	}
}

func assertHPACoverage(t *testing.T, record dto.ResourceRelationshipRecord, complete bool) {
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
