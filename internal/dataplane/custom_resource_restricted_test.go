package dataplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestRestrictedCustomResourceSnapshots(t *testing.T) {
	for _, tt := range []struct {
		name                  string
		listStatus, getStatus int
		namespace             string
		served                bool
		want                  int
	}{
		{"namespaced allowed", 403, 200, "apps", true, 1},
		{"cluster allowed", 403, 200, "", true, 1},
		{"get forbidden", 403, 403, "apps", true, 0},
		{"get missing", 403, 404, "apps", true, 0},
		{"get error", 403, 500, "apps", true, 0},
		{"unserved advertised version", 403, 200, "apps", false, 0},
		{"unauthorized does not discover", 401, 200, "apps", true, 0},
		{"server failure does not discover", 500, 200, "apps", true, 0},
		{"empty namespace rejected", 403, 200, "", true, 0},
		{"instance denied", 403, 200, "apps", true, 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			scope := "Cluster"
			if tt.namespace != "" {
				scope = "Namespaced"
			}
			listPath := "/apis/operator.example.com/v1/widgets"
			if tt.namespace != "" {
				listPath = "/apis/operator.example.com/v1/namespaces/" + tt.namespace + "/widgets"
			}
			discoveries, reads := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Header.Get("Authorization") != "Bearer restricted" {
					t.Errorf("identity changed: %q", r.Header.Get("Authorization"))
				}
				status := func(code int) {
					w.WriteHeader(code)
					reason := "Forbidden"
					if code == 401 {
						reason = "Unauthorized"
					}
					if code == 404 {
						reason = "NotFound"
					}
					if code == 500 {
						reason = "InternalError"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "Status", "status": "Failure", "reason": reason, "code": code})
				}
				switch r.URL.Path {
				case "/apis/apiextensions.k8s.io/v1/customresourcedefinitions":
					status(tt.listStatus)
				case "/apis":
					discoveries++
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "APIGroupList", "groups": []any{map[string]any{"name": "operator.example.com", "preferredVersion": map[string]any{"groupVersion": "operator.example.com/v1", "version": "v1"}}}})
				case "/apis/operator.example.com/v1":
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "APIResourceList", "groupVersion": "operator.example.com/v1", "resources": []any{
						map[string]any{"name": "widgets", "kind": "Widget", "namespaced": tt.namespace != "", "verbs": []string{"list"}},
						map[string]any{"name": "aggregated", "kind": "External", "namespaced": tt.namespace != "", "verbs": []string{"list"}},
						map[string]any{"name": "widgets/status", "kind": "Widget", "namespaced": tt.namespace != "", "verbs": []string{"list"}},
					}})
				case "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets.operator.example.com":
					if tt.getStatus != 200 {
						status(tt.getStatus)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "apiextensions.k8s.io/v1", "kind": "CustomResourceDefinition", "metadata": map[string]any{"name": "widgets.operator.example.com"}, "spec": map[string]any{"group": "operator.example.com", "scope": scope, "names": map[string]any{"kind": "Widget", "plural": "widgets"}, "versions": []any{map[string]any{"name": "v0", "storage": true, "served": false}, map[string]any{"name": "v1", "storage": false, "served": tt.served}}}})
				case "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/aggregated.operator.example.com":
					status(404)
				case listPath:
					if tt.name == "instance denied" {
						status(403)
						return
					}
					reads++
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "operator.example.com/v1", "kind": "WidgetList", "items": []any{map[string]any{"apiVersion": "operator.example.com/v1", "kind": "Widget", "metadata": map[string]any{"name": "widget", "namespace": tt.namespace, "uid": "widget-uid"}}}})
				default:
					if strings.Contains(r.URL.Path, "/secrets") {
						_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "SecretList", "items": []any{}})
						return
					}
					t.Errorf("unexpected or expanded request: %s", r.URL.Path)
					status(403)
				}
			}))
			defer server.Close()
			cfg := &rest.Config{Host: server.URL, BearerToken: "restricted"}
			client, err := kubernetes.NewForConfig(cfg)
			if err != nil {
				t.Fatal(err)
			}
			provider := customResourceClientsProvider{clients: &cluster.Clients{RestConfig: cfg, Clientset: client}}
			plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
			invoke := func() (CustomResourcesSnapshot, error) {
				if tt.namespace == "" && tt.name != "empty namespace rejected" {
					return plane.ClusterCustomResourcesSnapshot(context.Background(), newWorkScheduler(1), provider, WorkPriorityCritical)
				}
				return plane.CustomResourcesSnapshot(context.Background(), newWorkScheduler(1), provider, tt.namespace, WorkPriorityCritical)
			}
			got, err := invoke()
			if len(got.Items) != tt.want || reads != tt.want {
				t.Fatalf("items=%+v reads=%d err=%v", got.Items, reads, err)
			}
			if tt.listStatus != 403 || tt.name == "empty namespace rejected" {
				if discoveries != 0 || err == nil {
					t.Fatalf("invalid scope/index triggered discovery=%d err=%v", discoveries, err)
				}
				cached, _ := invoke()
				if cached.Err == nil {
					t.Fatal("cache lost index/scope failure")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Err == nil || got.Err.Class != NormalizedErrorClassAccessDenied || got.Meta.Coverage != CoverageClassPartial || got.Meta.Completeness != CompletenessClassInexact {
				t.Fatalf("lost denial/coverage: %+v", got)
			}
			if got.Aggregation == nil || got.Aggregation.Discovery == nil || !got.Aggregation.Discovery.UniverseUnknown || got.Aggregation.Discovery.NotFound < 1 {
				t.Fatalf("missing incomplete discovery: %+v", got.Aggregation)
			}
			wantConfirmed := tt.want
			if tt.name == "instance denied" {
				wantConfirmed = 1
				if got.Aggregation.DeniedKinds != 1 || got.Aggregation.AccessibleKinds != 0 {
					t.Fatalf("list permission inferred from discovery: %+v", got.Aggregation)
				}
			}
			if got.Aggregation.Discovery.Confirmed != wantConfirmed {
				t.Fatalf("confirmation: %+v", got.Aggregation.Discovery)
			}
			if tt.want == 0 && len(got.Relationships) != 0 {
				t.Fatalf("fabricated relationship: %+v", got.Relationships)
			}
			for _, r := range got.Relationships {
				for _, ref := range r.References {
					if ref.Type == dto.ResourceRelationshipTypeKindDefinition && ref.Target.Name != "widgets.operator.example.com" {
						t.Fatalf("fabricated CRD: %+v", ref)
					}
				}
			}
			for _, coverage := range got.RelationshipMetadata.FamilyCoverage {
				if coverage.Coverage == dto.ResourceRelationshipCoverageFull {
					t.Fatalf("complete relationship universe: %+v", coverage)
				}
			}
			cached, err := invoke()
			if err != nil || cached.Aggregation.Discovery == nil || cached.Err == nil {
				t.Fatalf("cache lost partial state: %+v %v", cached, err)
			}
			// The fallback never populates the authoritative CRD-list store.
			crd, _ := plane.CRDsSnapshot(context.Background(), newWorkScheduler(1), provider, WorkPriorityCritical)
			if len(crd.Items) != 0 || crd.Err == nil {
				t.Fatalf("fallback polluted CRD list: %+v", crd)
			}
		})
	}
}
