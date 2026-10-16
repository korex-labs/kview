package dataplane

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	bolt "go.etcd.io/bbolt"
)

// Embedding retains the production search path but makes accidental hydration fail.
type searchOnlyPersistence struct{ snapshotPersistence }

func (searchOnlyPersistence) ListSnapshots(string) ([]persistedSnapshotCell, error) {
	panic("search hydrated snapshots")
}
func (searchOnlyPersistence) Load(string, ResourceKind, string, any) (bool, error) {
	panic("search loaded a snapshot")
}

func TestSearchNamespacePhasesPagingAndNoHydration(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/search.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, cluster := range []string{"ctx", "other-context"} {
		for _, namespace := range []string{"app", "app-other", "other"} {
			snap := PodsSnapshot{Items: []dto.PodListItemDTO{
				{Name: "a", Namespace: namespace, ListHealthHint: "problem"},
				{Name: "b", Namespace: namespace, ListHealthHint: "problem"},
				{Name: "c", Namespace: namespace, ListHealthHint: "problem"},
			}}
			if err := store.Save(cluster, ResourceKindPods, namespace, snap); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Cluster-scoped matches must be in rest, never the namespace-first phase.
	if err := store.Save("ctx", ResourceKindNodes, "", struct{ Items []struct{ Name string } }{Items: []struct{ Name string }{{"node"}}}); err != nil {
		t.Fatal(err)
	}
	plane := &clusterPlane{name: "ctx"}
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Unix(1, 0)}, Items: []dto.PodListItemDTO{
		{Name: "a", Namespace: "app", ListHealthHint: "healthy"},
		{Name: "d", Namespace: "app", ListHealthHint: "problem"},
	}})
	m := &manager{persistence: searchOnlyPersistence{store}, planes: map[string]*clusterPlane{"ctx": plane}}
	for _, tc := range []struct {
		name, query   string
		scope         SearchScope
		offset, limit int
		want          []string
		more          bool
	}{
		{"first", "health:problem", SearchScope{Namespace: "app"}, 0, 2, []string{"app/b", "app/c"}, true},
		{"next", "health:problem", SearchScope{Namespace: "app"}, 2, 2, []string{"app/d"}, false},
		{"past-end", "health:problem", SearchScope{Namespace: "app"}, 3, 2, nil, false},
		{"missing", "kind:pod", SearchScope{Namespace: "missing"}, 0, 20, nil, false},
		{"rest", "context:ctx", SearchScope{ExcludeNamespace: "app"}, 0, 20, []string{"app-other/a", "other/a", "app-other/b", "other/b", "app-other/c", "other/c", "/node"}, false},
		{"rest-page", "kind:pod", SearchScope{ExcludeNamespace: "app"}, 2, 2, []string{"app-other/b", "other/b"}, true},
		{"explicit-wins", "ns:other kind:pod", SearchScope{Namespace: "app", ExcludeNamespace: "other"}, 0, 20, []string{"other/a", "other/b", "other/c"}, false},
		{"context-cannot-escape", "context:other-context", SearchScope{Namespace: "app"}, 0, 20, nil, false},
		{"intersection", "kind:pod", SearchScope{Namespace: "app", ExcludeNamespace: "app"}, 0, 20, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := m.SearchCachedResources(context.Background(), "ctx", tc.query, tc.limit, tc.offset, tc.scope)
			if err != nil {
				t.Fatal(err)
			}
			var names []string
			for _, row := range got.Items {
				if row.Cluster != "ctx" {
					t.Fatalf("context escaped: %+v", row)
				}
				names = append(names, row.Namespace+"/"+row.Name)
			}
			if !reflect.DeepEqual(names, tc.want) || got.HasMore != tc.more {
				t.Fatalf("got %v more=%v; want %v more=%v", names, got.HasMore, tc.want, tc.more)
			}
		})
	}
	// A cold search reads the index without constructing a plane or hydrating it.
	cold := &manager{persistence: searchOnlyPersistence{store}}
	got, err := cold.SearchCachedResources(context.Background(), "ctx", "kind:pod", 2, 0, SearchScope{Namespace: "app"})
	if err != nil || len(got.Items) != 2 || len(cold.planes) != 0 {
		t.Fatalf("cold search: %+v, %v", got, err)
	}
}

func TestSearchScopedIndexSkipsUnrelatedJSONAndRetainsPriorityOrder(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/search.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	rows := []dataplaneSearchRow{
		{Cluster: "ctx", Namespace: "app", Kind: "pods", Name: "a"},
		{Cluster: "ctx", Namespace: "app", Kind: "deployments", Name: "z"},
		{Cluster: "ctx", Namespace: "app", Kind: "helmreleases", Name: "zz"},
		{Cluster: "ctx", Namespace: "app", Kind: "pods", Name: "b"},
	}
	err = store.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSearchBucket)
		for _, row := range rows {
			raw, err := json.Marshal(row)
			if err != nil {
				return err
			}
			if err := b.Put(searchIndexKey(row), raw); err != nil {
				return err
			}
		}
		return b.Put(searchIndexKey(dataplaneSearchRow{Cluster: "ctx", Namespace: "other", Kind: "pods", Name: "bad"}), []byte("not JSON"))
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"zz", "z", "a", "b"}
	for offset, name := range want {
		got, err := store.SearchName("ctx", "context:ctx", 1, offset, SearchScope{Namespace: "app"})
		if err != nil || len(got) != 1 || got[0].Name != name {
			t.Fatalf("offset %d: %+v, %v", offset, got, err)
		}
	}
}

func TestSearchScopeSkipsOtherRAMSnapshots(t *testing.T) {
	plane := &clusterPlane{name: "ctx"}
	for _, ns := range []string{"app", "other"} {
		setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Unix(1, 0)}, Items: []dto.PodListItemDTO{{Name: ns, Namespace: ns}}})
	}
	rows := plane.inMemorySearchRows(SearchScope{Namespace: "app"})
	if len(rows) != 1 || rows[0].Namespace != "app" {
		t.Fatalf("scope leaked: %+v", rows)
	}
	// Query kind pushdown avoids unrelated stores as well.
	if rows := plane.inMemorySearchRows(effectiveSearchScope("kind:ingress", []SearchScope{{Namespace: "app"}})); len(rows) != 0 {
		t.Fatalf("kind scope leaked: %+v", rows)
	}
}

// Isolated RAM-only benchmark: this is not an end-to-end endpoint latency claim.
func BenchmarkCachedSearchNamespaceScope(b *testing.B) {
	plane := &clusterPlane{name: "ctx"}
	for n := 0; n < 100; n++ {
		ns := fmt.Sprintf("ns-%03d", n)
		items := make([]dto.PodListItemDTO, 100)
		for i := range items {
			items[i] = dto.PodListItemDTO{Name: fmt.Sprintf("pod-%03d", i), Namespace: ns}
		}
		setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{Meta: SnapshotMetadata{ObservedAt: time.Unix(1, 0)}, Items: items})
	}
	m := &manager{planes: map[string]*clusterPlane{"ctx": plane}}
	for _, tc := range []struct {
		name  string
		scope SearchScope
	}{
		{"unscoped", SearchScope{}}, {"namespace", SearchScope{Namespace: "ns-050"}},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				got, err := m.SearchCachedResources(context.Background(), "ctx", "kind:pod", 20, 0, tc.scope)
				if err != nil || len(got.Items) != 20 {
					b.Fatalf("search: %+v, %v", got, err)
				}
			}
		})
	}
}
