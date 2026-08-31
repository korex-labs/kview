package services

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestServiceListMapperCarriesExactAndEmptySelectorEvidence(t *testing.T) {
	services := []corev1.Service{
		{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "apps"}, Spec: corev1.ServiceSpec{Selector: map[string]string{"app": "api"}}},
		{ObjectMeta: metav1.ObjectMeta{Name: "external", Namespace: "apps"}},
	}
	items := serviceListItems(services, nil, "complete", time.Unix(1_700_000_000, 0))
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	selected := items[0].ResourceRelationshipMetadata()
	assertServiceSelectorFamilyFull(t, selected.FamilyCoverage[dto.ResourceRelationshipFamilySelector])
	if len(selected.Selectors) != 1 || selected.Selectors[0].Source.FieldPath != "spec.selector" || selected.Selectors[0].MatchLabels["app"] != "api" || selected.Selectors[0].Target.Resource != "pods" {
		t.Fatalf("selector evidence = %+v", selected.Selectors)
	}
	empty := items[1].ResourceRelationshipMetadata()
	assertServiceSelectorFamilyFull(t, empty.FamilyCoverage[dto.ResourceRelationshipFamilySelector])
	if len(empty.Selectors) != 0 {
		t.Fatalf("empty selector fabricated match-all evidence: %+v", empty.Selectors)
	}
}

func assertServiceSelectorFamilyFull(t *testing.T, got dto.ResourceRelationshipCoverageDTO) {
	t.Helper()
	if got.Coverage != dto.ResourceRelationshipCoverageFull || got.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("selector family coverage = %+v, want full/complete", got)
	}
}
