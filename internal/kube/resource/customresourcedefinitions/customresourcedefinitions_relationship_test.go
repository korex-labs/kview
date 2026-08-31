package customresourcedefinitions

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func TestCRDListMapperCapturesClusterIdentityWithEmptyNamespace(t *testing.T) {
	item := unstructured.Unstructured{Object: map[string]any{
		"spec": map[string]any{
			"group": "example.io", "scope": "Namespaced",
			"names":    map[string]any{"kind": "Widget", "plural": "widgets"},
			"versions": []any{map[string]any{"name": "v1", "served": true, "storage": true}},
		},
	}}
	item.SetName("widgets.example.io")
	item.SetNamespace("ignored")
	item.SetUID(types.UID("crd-uid"))
	item.SetCreationTimestamp(metav1.NewTime(time.Unix(1_699_999_000, 0)))

	got := mapCRDListItem(item, time.Unix(1_700_000_000, 0)).ResourceRelationshipMetadata().Resource
	if got.Group != "apiextensions.k8s.io" || got.Version != "v1" || got.Resource != "customresourcedefinitions" || got.Kind != "CustomResourceDefinition" || got.Scope != "cluster" || got.Namespace != "" || got.UID != "crd-uid" {
		t.Fatalf("CRD identity = %+v", got)
	}
}
