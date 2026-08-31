package customresources

import (
	"context"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestCustomResourceListMapperRetainsActualGVRKindAndScope(t *testing.T) {
	crd := dto.CRDListItemDTO{Name: "widgets.operator.example.com", Group: "operator.example.com", StorageVersion: "v1beta2", Plural: "widgets", Kind: "Widget", Scope: "Namespaced"}
	item := unstructured.Unstructured{}
	item.SetName("demo")
	item.SetNamespace("apps")
	item.SetUID(types.UID("widget-uid"))

	namespaced := mapCustomResourceInstance(item, crd, dto.ResourceScopeNamespaced, time.Unix(1_700_000_000, 0))
	got := namespaced.ResourceRelationshipMetadata().Resource
	if got.Group != crd.Group || got.Version != crd.StorageVersion || got.Resource != crd.Plural || got.Kind != crd.Kind || got.Scope != dto.ResourceScopeNamespaced || got.Namespace != "apps" || got.UID != "widget-uid" {
		t.Fatalf("namespaced custom identity = %+v", got)
	}

	item.SetNamespace("must-clear")
	cluster := mapCustomResourceInstance(item, crd, dto.ResourceScopeCluster, time.Unix(1_700_000_000, 0))
	got = cluster.ResourceRelationshipMetadata().Resource
	if got.Scope != dto.ResourceScopeCluster || got.Namespace != "" {
		t.Fatalf("cluster custom identity = %+v", got)
	}
}

func TestCustomResourceListMapperCarriesAuthoritativeCRDReference(t *testing.T) {
	crd := dto.CRDListItemDTO{Name: "widgets.operator.example.com", Group: "operator.example.com", StorageVersion: "v1", Plural: "widgets", Kind: "Widget", Scope: "Namespaced"}
	item := unstructured.Unstructured{}
	item.SetName("demo")
	item.SetNamespace("apps")

	record := mapCustomResourceInstance(item, crd, dto.ResourceScopeNamespaced, time.Time{}).ResourceRelationshipMetadata()
	if len(record.References) != 1 {
		t.Fatalf("references = %+v", record.References)
	}
	ref := record.References[0]
	if ref.Type != dto.ResourceRelationshipTypeKindDefinition || ref.Target.Group != "apiextensions.k8s.io" || ref.Target.Version != "v1" || ref.Target.Resource != "customresourcedefinitions" || ref.Target.Kind != "CustomResourceDefinition" || ref.Target.Scope != dto.ResourceScopeCluster || ref.Target.Namespace != "" || ref.Target.Name != crd.Name || ref.Source.FieldPath != "apiVersion/kind" {
		t.Fatalf("CRD reference = %+v", ref)
	}
	coverage := record.FamilyCoverage[dto.ResourceRelationshipFamilyKindDefinition]
	if coverage.Coverage != dto.ResourceRelationshipCoverageFull || coverage.Completeness != dto.ResourceRelationshipCompletenessComplete || record.Coverage != coverage {
		t.Fatalf("coverage = %+v family=%+v", record.Coverage, coverage)
	}

	crd.Name = ""
	partial := mapCustomResourceInstance(item, crd, dto.ResourceScopeNamespaced, time.Time{}).ResourceRelationshipMetadata()
	if len(partial.References) != 0 {
		t.Fatalf("blank CRD name fabricated reference: %+v", partial.References)
	}
	coverage = partial.FamilyCoverage[dto.ResourceRelationshipFamilyKindDefinition]
	if coverage.Coverage != dto.ResourceRelationshipCoveragePartial || coverage.Completeness != dto.ResourceRelationshipCompletenessPartial || partial.Coverage != coverage {
		t.Fatalf("partial coverage = %+v family=%+v", partial.Coverage, coverage)
	}
}

func TestListOneKindUsesRelationshipMapper(t *testing.T) {
	client := &blockingListClient{
		lateListed:  make(chan struct{}),
		releaseSlow: make(chan struct{}),
	}
	crd := dto.CRDListItemDTO{Name: "victoriametrics.operator.example.com", Group: "operator.example.com", StorageVersion: "v1", Plural: "victoriametrics", Kind: "VictoriaMetric", Scope: "Namespaced"}

	result := listOneKind(context.Background(), client, crd, "observability")
	if result.err || result.denied || len(result.items) != 1 {
		t.Fatalf("list result = %+v", result)
	}
	got := result.items[0].ResourceRelationshipMetadata()
	if got.Resource.Group != crd.Group || got.Resource.Version != crd.StorageVersion || got.Resource.Resource != crd.Plural || got.Resource.Kind != crd.Kind || got.Resource.Scope != dto.ResourceScopeNamespaced || got.Resource.Namespace != "observability" || got.Resource.Name != "vm" {
		t.Fatalf("listed custom identity = %+v", got.Resource)
	}
	if len(got.References) != 1 || got.References[0].Type != dto.ResourceRelationshipTypeKindDefinition || got.References[0].Target.Name != crd.Name {
		t.Fatalf("listed custom CRD reference = %+v", got.References)
	}
}

func TestListOneKindUsesAuthoritativeCRDScopeForAllNamespaceRequest(t *testing.T) {
	tests := []struct {
		name          string
		crdScope      string
		itemNamespace string
		wantScope     dto.ResourceScope
		wantNamespace string
	}{
		{
			name:          "namespaced CRD preserves object namespace",
			crdScope:      "Namespaced",
			itemNamespace: "observability",
			wantScope:     dto.ResourceScopeNamespaced,
			wantNamespace: "observability",
		},
		{
			name:          "cluster CRD clears object namespace",
			crdScope:      "Cluster",
			itemNamespace: "must-clear",
			wantScope:     dto.ResourceScopeCluster,
			wantNamespace: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &blockingListClient{
				lateListed:    make(chan struct{}),
				releaseSlow:   make(chan struct{}),
				itemNamespace: tt.itemNamespace,
			}
			crd := dto.CRDListItemDTO{
				Name: "victoriametrics.operator.example.com", Group: "operator.example.com", StorageVersion: "v1", Plural: "victoriametrics",
				Kind: "VictoriaMetric", Scope: tt.crdScope,
			}

			result := listOneKind(context.Background(), client, crd, "")
			if result.err || result.denied || len(result.items) != 1 {
				t.Fatalf("list result = %+v", result)
			}
			got := result.items[0].ResourceRelationshipMetadata().Resource
			if got.Scope != tt.wantScope || got.Namespace != tt.wantNamespace {
				t.Fatalf("identity scope/namespace = %q/%q, want %q/%q", got.Scope, got.Namespace, tt.wantScope, tt.wantNamespace)
			}
		})
	}
}
