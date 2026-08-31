package rolebindings

import (
	"testing"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestRoleBindingListMapperCarriesRoleAndServiceAccountReferences(t *testing.T) {
	rb := rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "apps"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"},
		Subjects:   []rbacv1.Subject{{Kind: rbacv1.ServiceAccountKind, Name: "bot"}, {Kind: rbacv1.UserKind, Name: "alex"}},
	}
	record := mapRoleBinding(rb, time.Time{}).ResourceRelationshipMetadata()
	if len(record.References) != 2 {
		t.Fatalf("references = %+v", record.References)
	}
	role, subject := record.References[0], record.References[1]
	if role.Target.Resource != "roles" || role.Target.Kind != "Role" || role.Target.Namespace != "apps" || role.Target.Name != "reader" || role.Source.FieldPath != "roleRef.name" {
		t.Fatalf("role ref = %+v", role)
	}
	if subject.Target.Resource != "serviceaccounts" || subject.Target.Kind != "ServiceAccount" || subject.Target.Namespace != "apps" || subject.Target.Name != "bot" || subject.Source.FieldPath != "subjects[0].name" {
		t.Fatalf("subject ref = %+v", subject)
	}
	assertRBCoverage(t, record, true)

	rb.RoleRef.APIGroup = "wrong.example"
	rb.Subjects = []rbacv1.Subject{{Kind: rbacv1.ServiceAccountKind}}
	partial := mapRoleBinding(rb, time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 0 {
		t.Fatalf("malformed refs = %+v", partial.References)
	}
	assertRBCoverage(t, partial, false)
}

func assertRBCoverage(t *testing.T, record dto.ResourceRelationshipRecord, complete bool) {
	t.Helper()
	got := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if complete && (got.Coverage != dto.ResourceRelationshipCoverageFull || got.Completeness != dto.ResourceRelationshipCompletenessComplete) {
		t.Fatalf("full coverage = %+v", got)
	}
	if !complete && (got.Coverage != dto.ResourceRelationshipCoveragePartial || got.Completeness != dto.ResourceRelationshipCompletenessPartial) {
		t.Fatalf("partial coverage = %+v", got)
	}
	if record.Coverage != got {
		t.Fatalf("aggregate coverage = %+v family=%+v", record.Coverage, got)
	}
}
