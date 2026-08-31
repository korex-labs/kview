package customresources

import (
	"context"
	"sync"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

const (
	maxConcurrentListCalls = 24 // CR-heavy clusters need enough fan-out to cover late-sorted operator APIs.
	perKindListTimeout     = 3 * time.Second
)

// ListAllNamespacedCRs aggregates instances of all Namespaced CRDs in the given namespace.
// Uses the already-cached CRD list as type index — no extra RBAC requirement beyond CRD list access.
func ListAllNamespacedCRs(ctx context.Context, dynClient dynamic.Interface, crds []dto.CRDListItemDTO, namespace string) ([]dto.CustomResourceInstanceDTO, dto.CustomResourceAggregationMeta, error) {
	var filtered []dto.CRDListItemDTO
	for _, c := range crds {
		if c.Scope == "Namespaced" && c.StorageVersion != "" && c.Plural != "" {
			filtered = append(filtered, c)
		}
	}
	return fanOut(ctx, dynClient, filtered, namespace)
}

// ListAllClusterCRs aggregates instances of all Cluster-scoped CRDs.
func ListAllClusterCRs(ctx context.Context, dynClient dynamic.Interface, crds []dto.CRDListItemDTO) ([]dto.CustomResourceInstanceDTO, dto.CustomResourceAggregationMeta, error) {
	var filtered []dto.CRDListItemDTO
	for _, c := range crds {
		if c.Scope == "Cluster" && c.StorageVersion != "" && c.Plural != "" {
			filtered = append(filtered, c)
		}
	}
	return fanOut(ctx, dynClient, filtered, "")
}

type kindResult struct {
	items  []dto.CustomResourceInstanceDTO
	denied bool
	err    bool
}

func fanOut(ctx context.Context, dynClient dynamic.Interface, crds []dto.CRDListItemDTO, namespace string) ([]dto.CustomResourceInstanceDTO, dto.CustomResourceAggregationMeta, error) {
	meta := dto.CustomResourceAggregationMeta{TotalKinds: len(crds)}
	if len(crds) == 0 {
		return nil, meta, nil
	}

	results := make([]kindResult, len(crds))
	sem := make(chan struct{}, maxConcurrentListCalls)
	var wg sync.WaitGroup

	for i, crd := range crds {
		i, crd := i, crd
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				results[i] = kindResult{err: true}
				return
			}
			defer func() { <-sem }()

			results[i] = listOneKind(ctx, dynClient, crd, namespace)
		}()
	}
	wg.Wait()

	var allItems []dto.CustomResourceInstanceDTO
	for _, r := range results {
		switch {
		case r.denied:
			meta.DeniedKinds++
		case r.err:
			meta.ErrorKinds++
		default:
			meta.AccessibleKinds++
			allItems = append(allItems, r.items...)
		}
	}

	return allItems, meta, nil
}

func listOneKind(ctx context.Context, dynClient dynamic.Interface, crd dto.CRDListItemDTO, namespace string) kindResult {
	gvrVal := schema.GroupVersionResource{
		Group:    crd.Group,
		Version:  crd.StorageVersion,
		Resource: crd.Plural,
	}

	// Per-kind timeout so a slow or unresponsive API group can't block the whole fan-out.
	kindCtx, cancel := context.WithTimeout(ctx, perKindListTimeout)
	defer cancel()

	var raw *unstructured.UnstructuredList
	var err error
	if namespace != "" {
		raw, err = dynClient.Resource(gvrVal).Namespace(namespace).List(kindCtx, metav1.ListOptions{})
	} else {
		raw, err = dynClient.Resource(gvrVal).List(kindCtx, metav1.ListOptions{})
	}
	if err != nil {
		if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
			return kindResult{denied: true}
		}
		return kindResult{err: true}
	}

	now := time.Now()
	items := make([]dto.CustomResourceInstanceDTO, 0, len(raw.Items))
	scope := customResourceScope(crd)
	for _, item := range raw.Items {
		items = append(items, mapCustomResourceInstance(item, crd, scope, now))
	}
	return kindResult{items: items}
}

func customResourceScope(crd dto.CRDListItemDTO) dto.ResourceScope {
	if crd.Scope == "Namespaced" {
		return dto.ResourceScopeNamespaced
	}
	return dto.ResourceScopeCluster
}

func mapCustomResourceInstance(item unstructured.Unstructured, crd dto.CRDListItemDTO, scope dto.ResourceScope, now time.Time) dto.CustomResourceInstanceDTO {
	age := int64(0)
	ts := item.GetCreationTimestamp()
	if !ts.IsZero() {
		age = int64(now.Sub(ts.Time).Seconds())
	}
	severity, statusSummary := crSignal(item.Object)

	descriptor := relationships.IdentityDescriptor{
		Group: crd.Group, Version: crd.StorageVersion, Resource: crd.Plural, Kind: crd.Kind, Scope: scope,
	}
	carrier := relationships.WithKindDefinitions(
		relationships.Capture(&item, descriptor),
		relationships.CustomResourceKindDefinition(crd.Name),
	)
	return dto.CustomResourceInstanceDTO{
		ResourceRelationshipCarrier: carrier,
		Name:                        item.GetName(),
		Namespace:                   item.GetNamespace(),
		Kind:                        crd.Kind,
		Group:                       crd.Group,
		Version:                     crd.StorageVersion,
		Resource:                    crd.Plural,
		AgeSec:                      age,
		SignalSeverity:              severity,
		StatusSummary:               statusSummary,
	}
}
