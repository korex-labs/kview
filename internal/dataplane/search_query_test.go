package dataplane

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestSearchQueryTerms(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  []searchTerm
	}{
		{"", nil},
		{" API prod ", []searchTerm{{value: "api"}, {value: "prod"}}},
		{`KIND:Pod ns:APP context:CTX attention:TRUE`, []searchTerm{{"kind", "pods"}, {"namespace", "app"}, {"cluster", "ctx"}, {"attention", "true"}}},
		{`status:"Not Ready" name:api`, []searchTerm{{"status", "not ready"}, {"name", "api"}}},
		{`health:custom signal:custom`, []searchTerm{{"health", "custom"}, {"signal", "custom"}}},
		{`unknown:value attention:yes kind:po name:`, []searchTerm{{value: "unknown:value"}, {value: "attention:yes"}, {value: "kind:po"}, {value: "name:"}}},
		{`name:"" status:" "`, []searchTerm{{value: `name:""`}, {value: `status:" "`}}},
		{`status:"Not Ready`, []searchTerm{{value: `status:"not ready`}}},
		{`status:"Not Ready"suffix`, []searchTerm{{value: `status:"not ready"suffix`}}},
		{`status:"Not\ Ready"`, []searchTerm{{value: `status:"not\ ready"`}}},
		{`"plain text"`, []searchTerm{{value: `"plain`}, {value: `text"`}}},
		{`note:yes stale:true service:api`, []searchTerm{{value: "note:yes"}, {value: "stale:true"}, {value: "service:api"}}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			if got := searchQueryTerms(tc.query); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("terms = %#v; want %#v", got, tc.want)
			}
		})
	}
	for _, query := range []string{strings.Repeat("a", maxSearchQueryBytes+1), strings.Repeat("kind:pod ", maxSearchQueryTerms+1)} {
		if got := searchQueryTerms(query); len(got) != 1 || got[0].key != "" || got[0].value != strings.TrimSpace(query) {
			t.Fatalf("over-limit query must remain entirely literal: %#v", got)
		}
	}
}

func TestSearchKindAliasesAreExact(t *testing.T) {
	for alias, want := range map[string]string{
		"pod": "pods", "pods": "pods", "deployment": "deployments", "deployments": "deployments",
		"ingress": "ingresses", "networkpolicy": "networkpolicies", "pvc": "persistentvolumeclaims",
		"hpas": "horizontalpodautoscalers", "crd": "customresourcedefinitions", "clusterresource": "clusterresources",
	} {
		if got := canonicalSearchKind(alias); got != want {
			t.Errorf("alias %q = %q; want %q", alias, got, want)
		}
	}
	for _, invalid := range []string{"po", "deploy", "podstuff", "networkpolicys", "unknown"} {
		if got := canonicalSearchKind(invalid); got != "" {
			t.Errorf("invalid alias %q = %q", invalid, got)
		}
	}
}

func TestSearchFiltersANDScopeAndLiteralFallback(t *testing.T) {
	row := dataplaneSearchRow{Cluster: "ctx", Kind: "pods", Namespace: "app", Name: "api-0", HealthBucket: "problem", ListStatus: "Not Ready", SignalSeverity: "high", NeedsAttention: true}
	for _, query := range []string{
		`kind:Pod ns:APP name:API cluster:CTX health:PROBLEM status:"Not Ready" signal:HIGH attention:true`,
		`api app kind:pods`, `namespace:app context:ctx`,
	} {
		if got := searchRowsMatching([]dataplaneSearchRow{row}, "ctx", query); len(got) != 1 || got[0].MatchReason == "" {
			t.Errorf("query %q = %+v", query, got)
		}
	}
	for _, query := range []string{
		`ns:ap`, `cluster:ct`, `kind:pod kind:deployment`, `attention:false`, `status:Ready`, `signal:hi`,
		`health:pro`, `context:other`, `unknown:api`, `attention:yes`, `kind:po`, `api missing`,
	} {
		if got := searchRowsMatching([]dataplaneSearchRow{row}, "ctx", query); len(got) != 0 {
			t.Errorf("query %q unexpectedly matched %+v", query, got)
		}
	}
	if got := searchRowsMatching([]dataplaneSearchRow{row}, "other", "context:ctx"); len(got) != 0 {
		t.Fatalf("context filter escaped scope: %+v", got)
	}
	row.Name = "unknown:api attention:yes kind:po"
	if got := searchRowsMatching([]dataplaneSearchRow{row}, "ctx", row.Name); len(got) != 1 {
		t.Fatalf("invalid filters no longer match literal text: %+v", got)
	}
	row.NeedsAttention = false
	if got := searchRowsMatching([]dataplaneSearchRow{row}, "ctx", "attention:false"); len(got) != 1 {
		t.Fatalf("false attention = %+v", got)
	}
}

func TestSearchFiltersPersistenceParityAndPagination(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/search.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	snap := PodsSnapshot{Items: []dto.PodListItemDTO{
		{Name: "a-healthy", Namespace: "app", ListHealthHint: "healthy"},
		{Name: "b-api", Namespace: "app", ListHealthHint: "problem", ListStatus: "Not Ready", ListSignalSeverity: "high", ListSignalCount: 1},
		{Name: "c-api", Namespace: "app", ListHealthHint: "problem", ListStatus: "Not Ready", ListSignalSeverity: "high", ListSignalCount: 1},
	}}
	for _, cluster := range []string{"ctx", "other"} {
		if err := store.Save(cluster, ResourceKindPods, "app", snap); err != nil {
			t.Fatal(err)
		}
	}
	rows := searchRowsFromSnapshot("ctx", ResourceKindPods, "app", snap)
	for _, query := range []string{`kind:pod ns:app attention:true`, `status:"Not Ready" name:API signal:high`, `health:healthy attention:false`, `app api`, `context:other`, `unknown:api`, `attention:invalid`} {
		want := searchRowsMatching(rows, "ctx", query)
		sortSearchRows(want)
		got, err := store.SearchName("ctx", query, 20, 0)
		if err != nil || !reflect.DeepEqual(got, want) {
			// Empty results may be nil or allocated on the two paths.
			if err != nil || len(got) != 0 || len(want) != 0 {
				t.Fatalf("query %q: disk=%+v RAM=%+v err=%v", query, got, want, err)
			}
		}
	}
	got, err := store.SearchName("ctx", "attention:true", 1, 1)
	if err != nil || len(got) != 1 || got[0].Name != "c-api" {
		t.Fatalf("filter before pagination: %+v, %v", got, err)
	}
}

func TestSearchRAMShadowsPersistedBeforeFilteringAndPagination(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/search.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	var disk, ram []dto.PodListItemDTO
	for _, name := range []string{"a", "b", "c", "d"} {
		disk = append(disk, dto.PodListItemDTO{Name: name, Namespace: "app", ListHealthHint: "problem"})
		ram = append(ram, dto.PodListItemDTO{Name: name, Namespace: "app", ListHealthHint: "healthy"})
	}
	for _, name := range []string{"e", "g", "h"} {
		disk = append(disk, dto.PodListItemDTO{Name: name, Namespace: "app", ListHealthHint: "problem"})
	}
	ram = append(ram, dto.PodListItemDTO{Name: "f", Namespace: "app", ListHealthHint: "problem"})
	for _, cluster := range []string{"ctx", "other"} {
		if err := store.Save(cluster, ResourceKindPods, "app", PodsSnapshot{Items: disk}); err != nil {
			t.Fatal(err)
		}
	}
	plane := &clusterPlane{name: "ctx"}
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{Items: ram, Meta: SnapshotMetadata{ObservedAt: time.Unix(1, 0).UTC()}})
	// No clients, scheduler, or plane initialization: this must remain cache-only.
	m := &manager{persistence: store, planes: map[string]*clusterPlane{"ctx": plane}}
	for _, tc := range []struct {
		offset int
		want   []string
		more   bool
	}{
		{0, []string{"e", "f"}, true},
		{2, []string{"g", "h"}, false},
		{4, nil, false},
	} {
		got, err := m.SearchCachedResources(context.Background(), "ctx", "kind:pod health:problem", 2, tc.offset)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, item := range got.Items {
			if item.Cluster != "ctx" {
				t.Fatalf("scope escaped: %+v", item)
			}
			names = append(names, item.Name)
		}
		if !reflect.DeepEqual(names, tc.want) || got.HasMore != tc.more {
			t.Fatalf("offset %d: names=%v more=%v; want %v more=%v", tc.offset, names, got.HasMore, tc.want, tc.more)
		}
	}
	got, err := m.SearchCachedResources(context.Background(), "ctx", "context:other", 10, 0)
	if err != nil || len(got.Items) != 0 {
		t.Fatalf("context filter escaped manager scope: %+v, %v", got, err)
	}
	// RAM wins for plain text too, even when its updated health no longer matches.
	got, err = m.SearchCachedResources(context.Background(), "ctx", "problem", 10, 0)
	if err != nil || len(got.Items) != 4 {
		t.Fatalf("plain text resurrected persisted rows: %+v, %v", got, err)
	}
}
