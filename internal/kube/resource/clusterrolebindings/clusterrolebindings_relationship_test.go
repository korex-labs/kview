package clusterrolebindings

import (
	"testing"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestClusterRoleBindingListMapperCarriesCanonicalReferences(t *testing.T) {
	rb := rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "operators"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "operator"},
		Subjects:   []rbacv1.Subject{{Kind: rbacv1.ServiceAccountKind, Namespace: "ops", Name: "controller"}},
	}
	record := mapClusterRoleBinding(rb, time.Time{}).ResourceRelationshipMetadata()
	if len(record.References) != 2 {
		t.Fatalf("references = %+v", record.References)
	}
	role, subject := record.References[0], record.References[1]
	if role.Target.Resource != "clusterroles" || role.Target.Kind != "ClusterRole" || role.Target.Scope != dto.ResourceScopeCluster || role.Target.Namespace != "" || role.Target.Name != "operator" || role.Source.FieldPath != "roleRef.name" {
		t.Fatalf("role ref = %+v", role)
	}
	if subject.Target.Resource != "serviceaccounts" || subject.Target.Namespace != "ops" || subject.Target.Name != "controller" || subject.Source.FieldPath != "subjects[0].name" {
		t.Fatalf("subject ref = %+v", subject)
	}
	assertCRBCoverage(t, record, true)

	rb.Subjects[0].Namespace = ""
	partial := mapClusterRoleBinding(rb, time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 1 || partial.References[0].Target.Name != "operator" {
		t.Fatalf("malformed refs = %+v", partial.References)
	}
	assertCRBCoverage(t, partial, false)
}

func assertCRBCoverage(t *testing.T, record dto.ResourceRelationshipRecord, complete bool) {
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
