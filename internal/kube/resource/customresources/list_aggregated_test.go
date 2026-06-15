package customresources

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"

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
	client := &blockingListClient{
		lateListed:  make(chan struct{}),
		releaseSlow: make(chan struct{}),
	}
	result := make(chan struct {
		items []dto.CustomResourceInstanceDTO
		meta  dto.CustomResourceAggregationMeta
		err   error
	}, 1)

	go func() {
		items, meta, err := ListAllNamespacedCRs(context.Background(), client, crds, "observability")
		result <- struct {
			items []dto.CustomResourceInstanceDTO
			meta  dto.CustomResourceAggregationMeta
			err   error
		}{items: items, meta: meta, err: err}
	}()

	select {
	case <-client.lateListed:
	case <-time.After(time.Second):
		close(client.releaseSlow)
		t.Fatal("late-sorted custom resource was starved behind slow earlier kinds")
	}
	close(client.releaseSlow)

	got := <-result
	if got.err != nil {
		t.Fatal(got.err)
	}
	items, meta := got.items, got.meta
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

type blockingListClient struct {
	lateListed  chan struct{}
	releaseSlow chan struct{}
	lateOnce    sync.Once
}

func (c *blockingListClient) Resource(resource schema.GroupVersionResource) dynamic.NamespaceableResourceInterface {
	return &blockingResourceClient{client: c, resource: resource}
}

type blockingResourceClient struct {
	client    *blockingListClient
	resource  schema.GroupVersionResource
	namespace string
}

func (c *blockingResourceClient) Namespace(namespace string) dynamic.ResourceInterface {
	copy := *c
	copy.namespace = namespace
	return &copy
}

func (c *blockingResourceClient) List(ctx context.Context, _ metav1.ListOptions) (*unstructured.UnstructuredList, error) {
	if strings.HasPrefix(c.resource.Resource, "slow") {
		select {
		case <-c.client.releaseSlow:
			return &unstructured.UnstructuredList{}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if c.resource.Resource == "victoriametrics" {
		c.client.lateOnce.Do(func() { close(c.client.lateListed) })
		return &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{
					Object: map[string]interface{}{
						"apiVersion": "operator.example.com/v1",
						"kind":       "VictoriaMetric",
						"metadata": map[string]interface{}{
							"name":      "vm",
							"namespace": c.namespace,
						},
					},
				},
			},
		}, nil
	}
	return &unstructured.UnstructuredList{}, nil
}

func (c *blockingResourceClient) Create(context.Context, *unstructured.Unstructured, metav1.CreateOptions, ...string) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) Update(context.Context, *unstructured.Unstructured, metav1.UpdateOptions, ...string) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) UpdateStatus(context.Context, *unstructured.Unstructured, metav1.UpdateOptions) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) Delete(context.Context, string, metav1.DeleteOptions, ...string) error {
	panic("not implemented")
}

func (c *blockingResourceClient) DeleteCollection(context.Context, metav1.DeleteOptions, metav1.ListOptions) error {
	panic("not implemented")
}

func (c *blockingResourceClient) Get(context.Context, string, metav1.GetOptions, ...string) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) Watch(context.Context, metav1.ListOptions) (watch.Interface, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) Patch(context.Context, string, types.PatchType, []byte, metav1.PatchOptions, ...string) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) Apply(context.Context, string, *unstructured.Unstructured, metav1.ApplyOptions, ...string) (*unstructured.Unstructured, error) {
	panic("not implemented")
}

func (c *blockingResourceClient) ApplyStatus(context.Context, string, *unstructured.Unstructured, metav1.ApplyOptions) (*unstructured.Unstructured, error) {
	panic("not implemented")
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
