package customresources

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

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
