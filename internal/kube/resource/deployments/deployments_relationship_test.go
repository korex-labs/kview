package deployments

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestDeploymentListMapperCarriesTemplatePodReferences(t *testing.T) {
	list := appsv1.DeploymentList{Items: []appsv1.Deployment{{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "apps"},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			ServiceAccountName: "runtime",
			ImagePullSecrets:   []corev1.LocalObjectReference{{Name: "registry"}},
		}}},
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
	items, err := ListDeployments(context.Background(), &cluster.Clients{Clientset: clientset}, "apps")
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
	want := map[string]string{
		"spec.template.spec.serviceAccountName":       "runtime",
		"spec.template.spec.imagePullSecrets[0].name": "registry",
	}
	for _, ref := range record.References {
		if want[ref.Source.FieldPath] != ref.Target.Name {
			t.Fatalf("unexpected reference: %+v", ref)
		}
		delete(want, ref.Source.FieldPath)
	}
	if len(want) != 0 {
		t.Fatalf("missing references: %+v", want)
	}
}
