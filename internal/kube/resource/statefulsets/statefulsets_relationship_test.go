package statefulsets

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

func TestStatefulSetListMapperMergesTemplateAndServiceReferences(t *testing.T) {
	list := appsv1.StatefulSetList{Items: []appsv1.StatefulSet{{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "apps"},
		Spec: appsv1.StatefulSetSpec{
			ServiceName: "db-headless",
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Volumes: []corev1.Volume{{
				VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{}},
			}}}},
		},
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
	items, err := ListStatefulSets(context.Background(), &cluster.Clients{Clientset: clientset}, "apps")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	record := items[0].ResourceRelationshipMetadata()
	coverage := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if coverage.Coverage != dto.ResourceRelationshipCoveragePartial || coverage.Completeness != dto.ResourceRelationshipCompletenessPartial {
		t.Fatalf("coverage = %+v", coverage)
	}
	want := map[string]string{
		"spec.template.spec.serviceAccountName": "default",
		"spec.serviceName":                      "db-headless",
	}
	for _, ref := range record.References {
		if want[ref.Source.FieldPath] != ref.Target.Name {
			t.Fatalf("unexpected reference: %+v", ref)
		}
		delete(want, ref.Source.FieldPath)
	}
	if len(want) != 0 {
		t.Fatalf("merged references missing: %+v", want)
	}
}
