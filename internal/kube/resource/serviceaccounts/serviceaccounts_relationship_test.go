package serviceaccounts

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestServiceAccountListMapperCarriesSecretsUIDPathsAndCoverage(t *testing.T) {
	sa := corev1.ServiceAccount{
		ObjectMeta:       metav1.ObjectMeta{Name: "builder", Namespace: "apps"},
		Secrets:          []corev1.ObjectReference{{Name: "token", UID: types.UID("secret-uid")}},
		ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry"}},
	}
	record := mapServiceAccount(sa, time.Time{}).ResourceRelationshipMetadata()
	if len(record.References) != 2 {
		t.Fatalf("references = %+v", record.References)
	}
	secret, pull := record.References[0], record.References[1]
	if secret.Target.Resource != "secrets" || secret.Target.Kind != "Secret" || secret.Target.Namespace != "apps" || secret.Target.Name != "token" || secret.Target.UID != "secret-uid" || secret.Source.FieldPath != "secrets[0].name" {
		t.Fatalf("secret ref = %+v", secret)
	}
	if pull.Target.Name != "registry" || pull.Target.UID != "" || pull.Source.FieldPath != "imagePullSecrets[0].name" {
		t.Fatalf("pull secret ref = %+v", pull)
	}
	assertSACoverage(t, record, true)

	empty := mapServiceAccount(corev1.ServiceAccount{ObjectMeta: sa.ObjectMeta}, time.Time{}).ResourceRelationshipMetadata()
	if len(empty.References) != 0 {
		t.Fatalf("empty refs = %+v", empty.References)
	}
	assertSACoverage(t, empty, true)

	sa.Secrets = []corev1.ObjectReference{{}}
	sa.ImagePullSecrets = nil
	partial := mapServiceAccount(sa, time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 0 {
		t.Fatalf("malformed refs = %+v", partial.References)
	}
	assertSACoverage(t, partial, false)
}

func assertSACoverage(t *testing.T, record dto.ResourceRelationshipRecord, complete bool) {
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
