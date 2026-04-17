package dataplane

import (
	"context"
	"testing"
	"time"

	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func TestSetNamespacedSnapshot_BumpsPerNamespaceRevision(t *testing.T) {
	s := newNamespacedSnapshotStore[PodsSnapshot]()
	now := time.Now().UTC()
	setNamespacedSnapshot(&s, "ns1", PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: now}, Items: nil})
	setNamespacedSnapshot(&s, "ns1", PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: now}, Items: []dto.PodListItemDTO{{Name: "a"}}})
	snap, ok := peekNamespacedSnapshot(&s, "ns1")
	if !ok || snap.Meta.Revision != 2 {
		t.Fatalf("revision=%d ok=%v", snap.Meta.Revision, ok)
	}
	setNamespacedSnapshot(&s, "ns2", PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: now}})
	s2, ok2 := peekNamespacedSnapshot(&s, "ns2")
	if !ok2 || s2.Meta.Revision != 1 {
		t.Fatalf("ns2 revision=%d", s2.Meta.Revision)
	}
}

func TestSetClusterSnapshot_BumpsRevision(t *testing.T) {
	var st snapshotStore[NamespaceSnapshot]
	now := time.Now().UTC()
	setClusterSnapshot(&st, NamespaceSnapshot{Meta: SnapshotMetadata{ObservedAt: now}, Items: nil})
	setClusterSnapshot(&st, NamespaceSnapshot{Meta: SnapshotMetadata{ObservedAt: now}, Items: []dto.NamespaceListItemDTO{{Name: "x"}}})
	snap, ok := peekClusterSnapshot(&st)
	if !ok || snap.Meta.Revision != 2 {
		t.Fatalf("revision=%d ok=%v", snap.Meta.Revision, ok)
	}
}

func TestListSnapshotRevision_UnknownWithoutCache(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	env, err := mm.ListSnapshotRevision(context.Background(), "ghost", ResourceKindPods, "default")
	if err != nil {
		t.Fatal(err)
	}
	if env.Known || env.Revision != "0" {
		t.Fatalf("expected unknown cell: %+v", env)
	}
}

func TestListSnapshotRevision_AfterSnapshotSet(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(context.Background(), "c1")
	plane := planeAny.(*clusterPlane)
	now := time.Now().UTC()
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot},
		Items: []dto.PodListItemDTO{{Name: "p", Namespace: "app"}},
	})
	env, err := mm.ListSnapshotRevision(context.Background(), "c1", ResourceKindPods, "app")
	if err != nil {
		t.Fatal(err)
	}
	if !env.Known || env.Revision != "1" || env.Freshness != string(FreshnessClassHot) {
		t.Fatalf("env %+v", env)
	}
}

func TestListSnapshotRevision_ClusterScopedKindsDoNotRequireNamespace(t *testing.T) {
	kinds := []ResourceKind{
		ResourceKindNamespaces,
		ResourceKindNodes,
		ResourceKindPersistentVolumes,
		ResourceKindClusterRoles,
		ResourceKindClusterRoleBindings,
		ResourceKindCRDs,
	}
	for _, kind := range kinds {
		if ListRevisionKindNeedsNamespace(kind) {
			t.Fatalf("%s should be cluster-scoped for revision polling", kind)
		}
		parsed, ok := ParseListRevisionResourceKind(string(kind))
		if !ok || parsed != kind {
			t.Fatalf("parse %s = %s/%v", kind, parsed, ok)
		}
	}
}

func TestListSnapshotRevision_AfterClusterScopedSnapshotSet(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(context.Background(), "c1")
	plane := planeAny.(*clusterPlane)
	now := time.Now().UTC()
	setClusterSnapshot(&plane.clusterRolesStore, ClusterRolesSnapshot{
		Meta:  SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot},
		Items: []dto.ClusterRoleListItemDTO{{Name: "view", RulesCount: 3}},
	})
	env, err := mm.ListSnapshotRevision(context.Background(), "c1", ResourceKindClusterRoles, "")
	if err != nil {
		t.Fatal(err)
	}
	if !env.Known || env.Revision != "1" || env.Freshness != string(FreshnessClassHot) {
		t.Fatalf("env %+v", env)
	}
}
