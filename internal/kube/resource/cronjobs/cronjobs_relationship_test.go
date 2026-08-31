package cronjobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestCronJobListMapperCarriesNestedTemplatePodReferences(t *testing.T) {
	list := batchv1.CronJobList{Items: []batchv1.CronJob{{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "apps"},
		Spec: batchv1.CronJobSpec{Schedule: "0 * * * *", JobTemplate: batchv1.JobTemplateSpec{Spec: batchv1.JobSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry"}},
		}}}}},
	}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/cronjobs") {
			_ = json.NewEncoder(w).Encode(list)
			return
		}
		_ = json.NewEncoder(w).Encode(corev1.EventList{})
	}))
	defer server.Close()
	clientset, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	items, err := ListCronJobs(context.Background(), &cluster.Clients{Clientset: clientset}, "apps")
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
	wantPath := "spec.jobTemplate.spec.template.spec.imagePullSecrets[0].name"
	if len(record.References) != 2 || record.References[1].Source.FieldPath != wantPath || record.References[1].Target.Name != "registry" {
		t.Fatalf("references = %+v", record.References)
	}
	if record.References[0].Source.FieldPath != "spec.jobTemplate.spec.template.spec.serviceAccountName" || record.References[0].Target.Name != "default" {
		t.Fatalf("default SA = %+v", record.References[0])
	}
}
