package customresourcedefinitions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

func TestRestrictedDiscoveryBoundsAndProof(t *testing.T) {
	for _, mode := range []string{"candidate cap", "group cap", "scope mismatch", "kind mismatch", "name mismatch", "group mismatch", "plural mismatch", "unserved", "stale discovery", "denied discovery", "partial discovery", "canceled", "known builtin", "resource group mismatch", "resource version mismatch"} {
		t.Run(mode, func(t *testing.T) {
			gets, groupReads := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Header.Get("Impersonate-User") != "viewer" || r.Header.Get("Impersonate-Group") != "readers" {
					t.Error("impersonation changed")
				}
				if r.Header.Get("Authorization") != "Bearer user-a" {
					t.Error("identity changed")
				}
				encode := func(v any) { _ = json.NewEncoder(w).Encode(v) }
				if r.URL.Path == "/apis" {
					if mode == "denied discovery" {
						w.WriteHeader(403)
						encode(metav1.Status{Status: "Failure", Reason: metav1.StatusReasonForbidden, Code: 403})
						return
					}
					groups := []metav1.APIGroup{{Name: "example.com", PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "example.com/v1", Version: "v1"}}}
					if mode == "group cap" {
						for i := 1; i <= maxDiscoveryGroups; i++ {
							group := fmt.Sprintf("g%d.example.com", i)
							groups = append(groups, metav1.APIGroup{Name: group, PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: group + "/v1", Version: "v1"}})
						}
					}
					if mode == "partial discovery" {
						groups = append(groups, metav1.APIGroup{Name: "broken.example.com", PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "broken.example.com/v1", Version: "v1"}})
					}
					if mode == "known builtin" {
						groups = []metav1.APIGroup{{Name: "apps", PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "apps/v1", Version: "v1"}}}
					}
					encode(metav1.APIGroupList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIGroupList"}, Groups: groups})
					return
				}
				if strings.HasPrefix(r.URL.Path, "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/") {
					gets++
					name := strings.TrimPrefix(r.URL.Path, "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/")
					if mode == "candidate cap" {
						w.WriteHeader(404)
						encode(metav1.Status{Status: "Failure", Reason: metav1.StatusReasonNotFound, Code: 404})
						return
					}
					kind, plural, group, scope := "Widget", "widgets", "example.com", "Namespaced"
					switch mode {
					case "scope mismatch":
						scope = "Cluster"
					case "kind mismatch":
						kind = "Other"
					case "name mismatch":
						name = "other.example.com"
					case "plural mismatch":
						plural = "other"
					case "group mismatch":
						group = "other.com"
					}
					encode(map[string]any{"apiVersion": "apiextensions.k8s.io/v1", "kind": "CustomResourceDefinition", "metadata": map[string]any{"name": name}, "spec": map[string]any{"group": group, "scope": scope, "names": map[string]any{"kind": kind, "plural": plural}, "versions": []any{map[string]any{"name": "v1", "served": mode != "unserved", "storage": true}}}})
					return
				}
				groupReads++
				if r.URL.Path == "/apis/broken.example.com/v1" {
					w.WriteHeader(503)
					encode(metav1.Status{Status: "Failure", Code: 503})
					return
				}
				gv := strings.TrimPrefix(r.URL.Path, "/apis/")
				if mode == "stale discovery" {
					gv = "example.com/v0"
				}
				resources := []metav1.APIResource{{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: []string{"list"}}}
				switch mode {
				case "known builtin":
					resources = []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: []string{"list"}}}
				case "resource group mismatch":
					resources[0].Group = "other.example.com"
				case "resource version mismatch":
					resources[0].Version = "v2"
				}
				if mode == "candidate cap" {
					for i := 1; i <= maxDiscoveryCandidates; i++ {
						resources = append(resources, metav1.APIResource{Name: fmt.Sprintf("widgets%d", i), Kind: "Widget", Namespaced: true, Verbs: []string{"list"}})
					}
				}
				if mode == "group cap" {
					resources = nil
				}
				resources = append(resources, metav1.APIResource{Name: "widgets/status", Kind: "Widget", Namespaced: true, Verbs: []string{"list"}}, metav1.APIResource{Name: "clusterwidgets", Kind: "Widget", Namespaced: false, Verbs: []string{"list"}}, metav1.APIResource{Name: "getonly", Kind: "Widget", Namespaced: true, Verbs: []string{"get"}})
				encode(metav1.APIResourceList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIResourceList"}, GroupVersion: gv, APIResources: resources})
			}))
			defer server.Close()
			ctx := context.Background()
			if mode == "canceled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			got, report := DiscoverRestrictedTypes(ctx, &rest.Config{Host: server.URL, BearerToken: "user-a", Impersonate: rest.ImpersonationConfig{UserName: "viewer", Groups: []string{"readers"}}, QPS: 1000, Burst: 1000}, true)
			if !report.UniverseUnknown || !report.ListDenied {
				t.Fatalf("false completeness: %+v", report)
			}
			switch mode {
			case "known builtin", "resource group mismatch", "resource version mismatch":
				if len(got) != 0 || gets != 0 || report.Candidates != 0 {
					t.Fatalf("untrusted routing probed: gets=%d got=%+v report=%+v", gets, got, report)
				}
			case "candidate cap":
				if gets != maxDiscoveryCandidates || !report.Truncated || report.NotFound != maxDiscoveryCandidates {
					t.Fatalf("gets=%d report=%+v", gets, report)
				}
			case "group cap":
				if groupReads != maxDiscoveryGroups || !report.Truncated {
					t.Fatalf("groups=%d report=%+v", groupReads, report)
				}
			case "partial discovery":
				if len(got) != 1 || report.Errors != 1 {
					t.Fatalf("partial result=%+v report=%+v", got, report)
				}
			default:
				if len(got) != 0 || report.Errors == 0 {
					t.Fatalf("unconfirmed result=%+v report=%+v", got, report)
				}
			}
		})
	}
}

func TestRestrictedDiscoveryHonorsCallerDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	got, report := DiscoverRestrictedTypes(ctx, &rest.Config{Host: server.URL}, true)
	if len(got) != 0 || report.Errors == 0 || time.Since(start) > time.Second {
		t.Fatalf("deadline ignored: %+v %+v", got, report)
	}
}
