package dto

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPersistedListRelationshipCarriersAreHiddenFromJSON(t *testing.T) {
	carrier := ResourceRelationshipCarrier{
		Resource: ResourceIdentityDTO{Group: "example.io", Version: "v1", Resource: "widgets", Kind: "Widget", Scope: ResourceScopeNamespaced, Namespace: "apps", Name: "demo", UID: "secret-uid"},
		Owners:   []ResourceOwnerReferenceDTO{{APIVersion: "apps/v1", Kind: "Deployment", Name: "owner", UID: "owner-uid"}},
	}
	tests := []struct {
		name string
		item any
	}{
		{name: "namespaced", item: PodListItemDTO{Name: "demo", Namespace: "apps", ResourceRelationshipCarrier: carrier}},
		{name: "cluster", item: NodeListItemDTO{Name: "demo", ResourceRelationshipCarrier: carrier}},
		{name: "custom", item: CustomResourceInstanceDTO{Name: "demo", Namespace: "apps", Kind: "Widget", Group: "example.io", Version: "v1", Resource: "widgets", ResourceRelationshipCarrier: carrier}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload, err := json.Marshal(test.item)
			if err != nil {
				t.Fatal(err)
			}
			for _, forbidden := range []string{"secret-uid", "owner-uid", "ownerReference", "ResourceRelationshipCarrier"} {
				if strings.Contains(string(payload), forbidden) {
					t.Fatalf("hidden relationship metadata leaked into JSON: %s", payload)
				}
			}
		})
	}
}

func TestAllPersistedKubernetesListDTOsProvideRelationshipMetadata(t *testing.T) {
	items := []any{
		NamespaceListItemDTO{}, NodeListItemDTO{}, PersistentVolumeDTO{}, ClusterRoleListItemDTO{}, ClusterRoleBindingListItemDTO{}, CRDListItemDTO{}, CustomResourceInstanceDTO{},
		PodListItemDTO{}, DeploymentListItemDTO{}, ServiceListItemDTO{}, IngressListItemDTO{}, NetworkPolicyDTO{}, PersistentVolumeClaimDTO{}, ConfigMapDTO{}, SecretDTO{},
		ServiceAccountListItemDTO{}, RoleListItemDTO{}, RoleBindingListItemDTO{}, DaemonSetDTO{}, StatefulSetDTO{}, ReplicaSetDTO{}, JobDTO{}, CronJobDTO{},
		HorizontalPodAutoscalerDTO{}, ResourceQuotaDTO{}, LimitRangeDTO{},
	}
	for _, item := range items {
		if _, ok := item.(ResourceRelationshipMetadataProvider); !ok {
			t.Errorf("%T does not provide hidden resource relationship metadata", item)
		}
	}
	// HelmReleaseDTO is a product-derived virtual resource, not a Kubernetes LIST
	// object, and intentionally does not receive universal Kubernetes metadata.
	if _, ok := any(HelmReleaseDTO{}).(ResourceRelationshipMetadataProvider); ok {
		t.Fatal("HelmReleaseDTO unexpectedly implements Kubernetes metadata provider")
	}
}
