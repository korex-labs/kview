package jobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestJobListMapperCarriesTemplatePodReferences(t *testing.T) {
	list := batchv1.JobList{Items: []batchv1.Job{{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "apps"},
		Spec: batchv1.JobSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: "backup", EnvFrom: []corev1.EnvFromSource{{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "backup-creds"}}}},
		}}}}},
	}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(list)
	}))
	defer server.Close()
	clientset, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	items, err := ListJobs(context.Background(), &cluster.Clients{Clientset: clientset}, "apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	record := items[0].ResourceRelationshipMetadata()
	coverage := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if coverage.Coverage != dto.ResourceRelationshipCoverageFull || coverage.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("coverage = %+v", coverage)
	}
	if len(record.References) != 2 || record.References[1].Source.FieldPath != "spec.template.spec.containers[0].envFrom[0].secretRef.name" || record.References[1].Target.Name != "backup-creds" {
		t.Fatalf("references = %+v", record.References)
	}
}
