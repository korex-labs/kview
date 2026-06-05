package customresources

import (
	"context"
	"strings"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	ktesting "k8s.io/client-go/testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestListAllNamespacedCRsDoesNotStarveLateKindsBehindSlowEarlyKinds(t *testing.T) {
	crds := []dto.CRDListItemDTO{
		crd("cilium.io", "Slow0", "slow0"),
		crd("cilium.io", "Slow1", "slow1"),
		crd("cilium.io", "Slow2", "slow2"),
		crd("cilium.io", "Slow3", "slow3"),
		crd("cilium.io", "Slow4", "slow4"),
		crd("operator.example.com", "VictoriaMetric", "victoriametrics"),
	}
	listKinds := make(map[schema.GroupVersionResource]string, len(crds))
	for _, item := range crds {
		listKinds[schema.GroupVersionResource{
			Group:    item.Group,
			Version:  item.StorageVersion,
			Resource: item.Plural,
		}] = item.Kind + "List"
	}
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), listKinds)
	start := time.Now()
	client.PrependReactor("list", "*", func(action ktesting.Action) (bool, runtime.Object, error) {
		resource := action.GetResource().Resource
		if strings.HasPrefix(resource, "slow") {
			time.Sleep(700 * time.Millisecond)
			return true, &unstructured.UnstructuredList{}, nil
		}
		if time.Since(start) > 400*time.Millisecond {
			return true, nil, apierrors.NewTimeoutError("late custom resource list", 1)
		}
		return true, &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{
					Object: map[string]interface{}{
						"apiVersion": "operator.example.com/v1",
						"kind":       "VictoriaMetric",
						"metadata": map[string]interface{}{
							"name":      "vm",
							"namespace": "observability",
						},
					},
				},
			},
		}, nil
	})

	items, meta, err := ListAllNamespacedCRs(context.Background(), client, crds, "observability")
	if err != nil {
		t.Fatal(err)
	}
	if meta.TotalKinds != len(crds) || meta.ErrorKinds != 0 {
		t.Fatalf("aggregation meta: %+v", meta)
	}
	found := false
	for _, item := range items {
		if item.Kind == "VictoriaMetric" && item.Name == "vm" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected late-sorted custom resource to be included, got %+v", items)
	}
}

func crd(group, kind, plural string) dto.CRDListItemDTO {
	return dto.CRDListItemDTO{
		Group:          group,
		Scope:          "Namespaced",
		Kind:           kind,
		StorageVersion: "v1",
		Plural:         plural,
	}
}
