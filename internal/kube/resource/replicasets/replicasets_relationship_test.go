package replicasets

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

func TestReplicaSetListMapperCarriesTemplatePodReferences(t *testing.T) {
	list := appsv1.ReplicaSetList{Items: []appsv1.ReplicaSet{{
		ObjectMeta: metav1.ObjectMeta{Name: "api-rs", Namespace: "apps"},
		Spec: appsv1.ReplicaSetSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Volumes: []corev1.Volume{{
			VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data"}},
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
	items, err := ListReplicaSets(context.Background(), &cluster.Clients{Clientset: clientset}, "apps")
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
	if len(record.References) != 2 || record.References[1].Source.FieldPath != "spec.template.spec.volumes[0].persistentVolumeClaim.claimName" || record.References[1].Target.Name != "data" {
		t.Fatalf("references = %+v", record.References)
	}
}
