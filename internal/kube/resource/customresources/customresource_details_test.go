package customresources

import (
	"context"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

func TestCustomResourceListAndDetailHealthAgree(t *testing.T) {
	for _, tc := range []struct {
		observed int64
		want     string
	}{{2, "warning"}, {1, "unknown"}} {
		item := &unstructured.Unstructured{Object: map[string]interface{}{
			"apiVersion": "example.com/v1", "kind": "Widget",
			"metadata": map[string]interface{}{"name": "demo", "namespace": "apps", "generation": int64(2)},
			"status": map[string]interface{}{"observedGeneration": tc.observed, "conditions": []interface{}{
				map[string]interface{}{"type": "Ready", "status": "True"},
				map[string]interface{}{"type": "Degraded", "status": "True"},
			}},
		}}
		client := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), item)
		details, err := GetCustomResourceDetails(context.Background(), client, "example.com", "v1", "widgets", "apps", "demo")
		if err != nil {
			t.Fatal(err)
		}
		crd := dto.CRDListItemDTO{Name: "widgets.example.com", Group: "example.com", StorageVersion: "v1", Plural: "widgets", Kind: "Widget", Scope: "Namespaced"}
		listed := mapCustomResourceInstance(*item, crd, dto.ResourceScopeNamespaced, time.Now())
		if listed.SignalSeverity != tc.want || details.Summary.SignalSeverity != tc.want || listed.StatusSummary != details.Summary.StatusSummary {
			t.Fatalf("list=%+v details=%+v", listed, details.Summary)
		}
		if listed.Provenance != dto.CustomResourceProvenanceKubernetes || len(listed.ResourceRelationshipMetadata().References) != 1 {
			t.Fatalf("lost provenance/CRD relationship: %+v", listed)
		}
	}
}

func TestGetCustomResourceDetailsIncludesDerivedStatus(t *testing.T) {
	item := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "example.com/v1",
			"kind":       "Widget",
			"metadata": map[string]interface{}{
				"name":      "stuck",
				"namespace": "apps",
			},
			"status": map[string]interface{}{
				"conditions": []interface{}{
					map[string]interface{}{
						"type":    "Ready",
						"status":  "False",
						"reason":  "NotReady",
						"message": "controller has not reconciled the resource",
					},
				},
			},
		},
	}
	item.SetCreationTimestamp(metav1.Now())

	client := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), item)
	got, err := GetCustomResourceDetails(context.Background(), client, "example.com", "v1", "widgets", "apps", "stuck")
	if err != nil {
		t.Fatal(err)
	}
	if got.Summary.SignalSeverity != "warning" || got.Summary.StatusSummary != "NotReady" {
		t.Fatalf("derived status: got %q/%q", got.Summary.SignalSeverity, got.Summary.StatusSummary)
	}
	if len(got.Conditions) != 1 || got.Conditions[0].Reason != "NotReady" {
		t.Fatalf("conditions: %+v", got.Conditions)
	}
}
