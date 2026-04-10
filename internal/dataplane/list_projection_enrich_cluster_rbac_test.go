package dataplane

import (
	"testing"

	"kview/internal/kube/dto"
)

func TestEnrichNodeListItemsForAPI(t *testing.T) {
	items := EnrichNodeListItemsForAPI([]dto.NodeListItemDTO{
		{Name: "worker-a", Status: "Ready", PodsCount: 40, PodsAllocatable: "100"},
		{Name: "worker-b", Status: "Ready", PodsCount: 95, PodsAllocatable: "100"},
		{Name: "worker-c", Status: "NotReady"},
	})
	if items[0].HealthBucket != deployBucketHealthy || items[0].PodDensityBucket != deployBucketHealthy || items[0].NeedsAttention {
		t.Fatalf("worker-a signal unexpected: %+v", items[0])
	}
	if items[1].PodDensityBucket != deployBucketDegraded || !items[1].NeedsAttention {
		t.Fatalf("worker-b density signal unexpected: %+v", items[1])
	}
	if items[2].HealthBucket != deployBucketDegraded || !items[2].NeedsAttention {
		t.Fatalf("worker-c health signal unexpected: %+v", items[2])
	}
}

func TestEnrichRoleAndRoleBindingListItemsForAPI(t *testing.T) {
	roles := EnrichRoleListItemsForAPI([]dto.RoleListItemDTO{
		{Name: "empty"},
		{Name: "wide", RulesCount: 12},
		{Name: "small", RulesCount: 2},
	})
	if roles[0].PrivilegeBreadth != "empty" || !roles[0].NeedsAttention {
		t.Fatalf("empty role signal unexpected: %+v", roles[0])
	}
	if roles[1].PrivilegeBreadth != "broad" || !roles[1].NeedsAttention {
		t.Fatalf("wide role signal unexpected: %+v", roles[1])
	}
	if roles[2].PrivilegeBreadth != "narrow" || roles[2].NeedsAttention {
		t.Fatalf("small role signal unexpected: %+v", roles[2])
	}

	bindings := EnrichRoleBindingListItemsForAPI([]dto.RoleBindingListItemDTO{
		{Name: "single", RoleRefKind: "Role", SubjectsCount: 1},
		{Name: "wide", RoleRefKind: "ClusterRole", SubjectsCount: 12},
	})
	if bindings[0].BindingHint != "namespace-role" || bindings[0].SubjectBreadth != "narrow" || bindings[0].NeedsAttention {
		t.Fatalf("single binding signal unexpected: %+v", bindings[0])
	}
	if bindings[1].BindingHint != "cluster-role" || bindings[1].SubjectBreadth != "broad" || !bindings[1].NeedsAttention {
		t.Fatalf("wide binding signal unexpected: %+v", bindings[1])
	}
}

func TestEnrichClusterRoleAndClusterRoleBindingListItemsForAPI(t *testing.T) {
	roles := EnrichClusterRoleListItemsForAPI([]dto.ClusterRoleListItemDTO{
		{Name: "wide", RulesCount: 12},
		{Name: "small", RulesCount: 2},
	})
	if roles[0].PrivilegeBreadth != "broad" || !roles[0].NeedsAttention {
		t.Fatalf("wide clusterrole signal unexpected: %+v", roles[0])
	}
	if roles[1].PrivilegeBreadth != "narrow" || roles[1].NeedsAttention {
		t.Fatalf("small clusterrole signal unexpected: %+v", roles[1])
	}

	bindings := EnrichClusterRoleBindingListItemsForAPI([]dto.ClusterRoleBindingListItemDTO{
		{Name: "wide", RoleRefKind: "ClusterRole", SubjectsCount: 12},
	})
	if bindings[0].BindingHint != "cluster-role" || bindings[0].SubjectBreadth != "broad" || !bindings[0].NeedsAttention {
		t.Fatalf("wide clusterrolebinding signal unexpected: %+v", bindings[0])
	}
}
