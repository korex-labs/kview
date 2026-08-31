package ingresses

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestIngressListMapperCarriesCanonicalReferencesAndCoverage(t *testing.T) {
	ing := networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "public", Namespace: "apps"},
		Spec: networkingv1.IngressSpec{
			DefaultBackend: &networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "api", Port: networkingv1.ServiceBackendPort{Number: 8080}}},
			TLS:            []networkingv1.IngressTLS{{SecretName: "tls-cert"}},
		},
	}
	record := mapIngressListItem(ing, "default", time.Unix(1_700_000_000, 0)).ResourceRelationshipMetadata()
	if len(record.References) != 2 {
		t.Fatalf("references = %+v, want service and secret", record.References)
	}
	want := []struct{ resource, kind, namespace, name, path string }{
		{"services", "Service", "apps", "api", "spec.defaultBackend.service.name"},
		{"secrets", "Secret", "apps", "tls-cert", "spec.tls[0].secretName"},
	}
	for i, ref := range record.References {
		w := want[i]
		if ref.Target.Resource != w.resource || ref.Target.Kind != w.kind || ref.Target.Namespace != w.namespace || ref.Target.Name != w.name || ref.Source.FieldPath != w.path {
			t.Fatalf("reference[%d] = %+v", i, ref)
		}
	}
	assertIngressCoverage(t, record, dto.ResourceRelationshipCoverageFull, dto.ResourceRelationshipCompletenessComplete)

	empty := mapIngressListItem(networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "empty", Namespace: "apps"}}, "default", time.Time{}).ResourceRelationshipMetadata()
	if len(empty.References) != 0 {
		t.Fatalf("empty references = %+v", empty.References)
	}
	assertIngressCoverage(t, empty, dto.ResourceRelationshipCoverageFull, dto.ResourceRelationshipCompletenessComplete)

	malformed := ing
	malformed.Spec.DefaultBackend = &networkingv1.IngressBackend{Resource: &corev1.TypedLocalObjectReference{Kind: "Bucket", Name: "assets"}}
	partial := mapIngressListItem(malformed, "default", time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 1 || partial.References[0].Target.Name != "tls-cert" {
		t.Fatalf("malformed references = %+v", partial.References)
	}
	assertIngressCoverage(t, partial, dto.ResourceRelationshipCoveragePartial, dto.ResourceRelationshipCompletenessPartial)
}

func assertIngressCoverage(t *testing.T, record dto.ResourceRelationshipRecord, coverage dto.ResourceRelationshipCoverage, completeness dto.ResourceRelationshipCompleteness) {
	t.Helper()
	got := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if got.Coverage != coverage || got.Completeness != completeness || record.Coverage != got {
		t.Fatalf("coverage = %+v family=%+v", record.Coverage, got)
	}
}
