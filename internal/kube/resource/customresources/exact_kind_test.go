package customresources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/client-go/rest"
)

func TestExactKind(t *testing.T) {
	for _, tc := range []struct {
		name, group, scope, namespace, mode string
		crdCode, listCode                   int
		wantError                           bool
	}{
		{name: "table namespaced served nonstorage", group: "example.com", scope: "Namespaced", namespace: "apps"},
		{name: "same plural other group", group: "other.com", scope: "Namespaced", namespace: "apps"},
		{name: "cluster", group: "example.com", scope: "Cluster"},
		{name: "unsupported table", group: "example.com", scope: "Cluster", mode: "fallback"},
		{name: "server ignores table", group: "example.com", scope: "Cluster", mode: "list"},
		{name: "unknown identity missing cells", group: "example.com", scope: "Cluster", mode: "unknown"},
		{name: "malformed rows", group: "example.com", scope: "Cluster", mode: "malformed", wantError: true},
		{name: "unsupported version", group: "example.com", scope: "Cluster", mode: "unserved", wantError: true},
		{name: "scope mismatch", group: "example.com", scope: "Cluster", mode: "scope", wantError: true},
		{name: "crd denied", group: "example.com", scope: "Cluster", crdCode: 403, wantError: true},
		{name: "cr denied", group: "example.com", scope: "Cluster", listCode: 403, wantError: true},
		{name: "table error not fallback", group: "example.com", scope: "Cluster", listCode: 500, wantError: true},
		{name: "bounded page", group: "example.com", scope: "Cluster", mode: "page"},
		{name: "oversized page", group: "example.com", scope: "Cluster", mode: "oversize"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gets, lists := 0, 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method != "GET" {
					t.Errorf("mutation %s", r.Method)
				}
				reject := func(code int) {
					w.WriteHeader(code)
					fmt.Fprintf(w, `{"apiVersion":"v1","kind":"Status","status":"Failure","reason":"Forbidden","code":%d,"message":"denied"}`, code)
				}
				if r.URL.Path == "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets."+tc.group {
					gets++
					if tc.crdCode != 0 {
						reject(tc.crdCode)
						return
					}
					scope := tc.scope
					if tc.mode == "scope" {
						scope = "Namespaced"
					}
					fmt.Fprintf(w, `{"apiVersion":"apiextensions.k8s.io/v1","kind":"CustomResourceDefinition","metadata":{"name":"widgets.%s"},"spec":{"group":%q,"scope":%q,"names":{"plural":"widgets","kind":"Widget"},"versions":[{"name":"v1","served":%t,"storage":false},{"name":"v2","served":true,"storage":true}]}}`, tc.group, tc.group, scope, tc.mode != "unserved")
					return
				}
				path := "/apis/" + tc.group + "/v1/"
				if tc.namespace != "" {
					path += "namespaces/" + tc.namespace + "/"
				}
				path += "widgets"
				if r.URL.Path != path {
					t.Errorf("unexpected path %s", r.URL.Path)
					reject(404)
					return
				}
				lists++
				if gets != 1 {
					t.Error("missing exact CRD validation")
				}
				if r.URL.Query().Get("limit") != "1" {
					t.Error("unbounded limit")
				}
				if tc.listCode != 0 {
					reject(tc.listCode)
					return
				}
				if tc.mode == "fallback" && lists == 1 {
					reject(406)
					return
				}
				obj := fmt.Sprintf(`{"apiVersion":%q,"kind":"Widget","metadata":{"name":"demo","namespace":%q,"uid":"uid-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}`, tc.group+"/v1", tc.namespace)
				if tc.mode == "fallback" || tc.mode == "list" {
					fmt.Fprintf(w, `{"apiVersion":%q,"kind":"WidgetList","metadata":{},"items":[%s]}`, tc.group+"/v1", obj)
					return
				}
				if !strings.Contains(r.Header.Get("Accept"), "as=Table") || r.URL.Query().Get("includeObject") != "Object" {
					t.Error("missing Table negotiation")
				}
				if tc.mode == "malformed" {
					fmt.Fprint(w, `{"apiVersion":"meta.k8s.io/v1","kind":"Table","rows":"invalid"}`)
					return
				}
				row := fmt.Sprintf(`{"cells":["demo","True"],"object":%s}`, obj)
				if tc.mode == "unknown" {
					row = `{"cells":["demo"]}`
				}
				cont := ""
				if tc.mode == "page" {
					cont = "next"
				}
				if tc.mode == "oversize" {
					row += "," + row
				}
				fmt.Fprintf(w, `{"apiVersion":"meta.k8s.io/v1","kind":"Table","metadata":{"continue":%q},"columnDefinitions":[{"name":"Name","type":"string"},{"name":"Ready","type":"string"}],"rows":[%s]}`, cont, row)
			}))
			defer upstream.Close()
			result, err := ListExactKind(context.Background(), &rest.Config{Host: upstream.URL}, ExactKindOptions{Group: tc.group, Version: "v1", Resource: "widgets", Scope: tc.scope, Namespace: tc.namespace, Limit: 1})
			if (err != nil) != tc.wantError {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if err != nil {
				return
			}
			if len(result.Items) != 1 {
				t.Fatalf("rows %+v", result)
			}
			if tc.mode == "unknown" {
				if result.Items[0].IdentityKnown || result.Meta.UnknownIdentityRows != 1 || result.Items[0].Cells[1] != nil {
					t.Fatalf("dishonest unknown: %+v", result)
				}
			} else {
				if result.Items[0].UID != "uid-1" || result.Items[0].SignalSeverity != "ok" || result.Items[0].Version != "v1" {
					t.Fatalf("lost identity/health %+v", result.Items[0])
				}
			}
			if tc.mode == "fallback" || tc.mode == "list" {
				if result.Meta.ColumnSource != "standard" || result.Meta.FallbackReason == "" {
					t.Fatal("missing fallback contract")
				}
				if result.Items[0].AgeKnown || result.Items[0].Cells[2] != nil || !result.Meta.Partial || result.Meta.IncompleteCellRows != 1 {
					t.Fatalf("unknown age must remain null and partial: %+v", result)
				}
			}
			if tc.mode == "page" && (!result.Meta.Truncated || result.Meta.Continue != "next") {
				t.Fatal("lost continuation")
			}
			if tc.mode == "oversize" && (!result.Meta.Truncated || result.Meta.Continue != "") {
				t.Fatal("dishonest overflow")
			}
			wantLists := 1
			if tc.mode == "fallback" {
				wantLists = 2
			}
			if lists != wantLists {
				t.Fatalf("list fanout %d", lists)
			}
			if _, err := json.Marshal(result); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestExactKindListKind(t *testing.T) {
	for _, tc := range []struct {
		name, declaration, responseKind string
		wantError                       bool
	}{
		{name: "absent defaults", responseKind: "WidgetList"},
		{name: "explicit default", declaration: `,"listKind":"WidgetList"`, responseKind: "WidgetList"},
		{name: "custom", declaration: `,"listKind":"WidgetCollection"`, responseKind: "WidgetCollection"},
		{name: "custom rejects conventional", declaration: `,"listKind":"WidgetCollection"`, responseKind: "WidgetList", wantError: true},
		{name: "custom rejects unrelated", declaration: `,"listKind":"WidgetCollection"`, responseKind: "OtherList", wantError: true},
		{name: "absent rejects unrelated", responseKind: "OtherList", wantError: true},
		{name: "empty is not absent", declaration: `,"listKind":""`, responseKind: "WidgetList", wantError: true},
		{name: "malformed is not absent", declaration: `,"listKind":42`, responseKind: "WidgetList", wantError: true},
	} {
		for _, code := range []int{0, http.StatusNotAcceptable, http.StatusUnsupportedMediaType} {
			t.Run(fmt.Sprintf("%s/%d", tc.name, code), func(t *testing.T) {
				gets, lists := 0, 0
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					switch r.URL.Path {
					case "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets.example.com":
						gets++
						fmt.Fprintf(w, `{"apiVersion":"apiextensions.k8s.io/v1","kind":"CustomResourceDefinition","metadata":{"name":"widgets.example.com"},"spec":{"group":"example.com","scope":"Cluster","names":{"plural":"widgets","kind":"Widget"%s},"versions":[{"name":"v1","served":true}]}}`, tc.declaration)
					case "/apis/example.com/v1/widgets":
						lists++
						if r.URL.Query().Get("continue") != "opaque+/=& token" || r.URL.Query().Get("limit") != "1" {
							t.Errorf("lost pagination: %v", r.URL.Query())
						}
						if code != 0 && lists == 1 {
							w.WriteHeader(code)
							fmt.Fprintf(w, `{"apiVersion":"v1","kind":"Status","code":%d}`, code)
							return
						}
						fmt.Fprintf(w, `{"apiVersion":"example.com/v1","kind":%q,"metadata":{"continue":"next+/= token","resourceVersion":"42"},"items":[{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","uid":"one"}}]}`, tc.responseKind)
					default:
						t.Errorf("unexpected path %s", r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer upstream.Close()
				got, err := ListExactKind(context.Background(), &rest.Config{Host: upstream.URL}, ExactKindOptions{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Cluster", Limit: 1, Continue: "opaque+/=& token"})
				if tc.wantError {
					if err == nil || got != nil {
						t.Fatalf("accepted incompatible list identity: %+v", got)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				wantLists, reason := 1, "serverReturnedObjectList"
				if code != 0 {
					wantLists, reason = 2, "tableNegotiationUnsupported"
				}
				if gets != 1 || lists != wantLists || got.Kind != "Widget" || len(got.Items) != 1 || !got.Items[0].IdentityKnown || got.Items[0].Kind != "Widget" {
					t.Fatalf("identity/fanout: gets=%d lists=%d result=%+v", gets, lists, got)
				}
				if got.Meta.ColumnSource != "standard" || got.Meta.FallbackReason != reason || got.Meta.Continue != "next+/= token" || got.Meta.ResourceVersion != "42" || !got.Meta.Truncated {
					t.Fatalf("lost fallback/pagination: %+v", got.Meta)
				}
			})
		}
	}
}

func TestExactKindRowIdentity(t *testing.T) {
	o := ExactKindOptions{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Namespaced", Namespace: "apps"}
	for _, tc := range []struct {
		name, object string
		known        bool
	}{
		{"metadata only", `{"apiVersion":"meta.k8s.io/v1","kind":"PartialObjectMetadata","metadata":{"name":"demo","namespace":"apps","uid":"one"}}`, true},
		{"other group", `{"apiVersion":"other.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":"apps","uid":"one"}}`, false},
		{"other namespace", `{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":"other","uid":"one"}}`, false},
		{"missing uid", `{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo","namespace":"apps"}}`, false},
		{"malformed object", `"no object"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := exactKindRow([]byte(tc.object), o, "Widget")
			if row.IdentityKnown != tc.known || row.SignalSeverity != "unknown" || row.AgeKnown {
				t.Fatalf("unexpected evidence: %+v", row)
			}
		})
	}
}

func TestExactKindRowMalformedIdentity(t *testing.T) {
	for _, metadata := range []string{
		`{"name":"../demo","uid":"one"}`,
		`{"name":"demo","uid":"one","namespace":12}`,
		`{"name":12,"uid":"one"}`,
		`{"name":"demo","uid":12}`,
	} {
		row := exactKindRow([]byte(`{"apiVersion":"example.com/v1","kind":"Widget","metadata":`+metadata+`}`), ExactKindOptions{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Cluster"}, "Widget")
		if row.IdentityKnown || row.Name != "" || row.UID != "" || row.AgeKnown {
			t.Fatalf("malformed identity became actionable: %+v", row)
		}
	}
}

func TestExactKindValidation(t *testing.T) {
	for _, o := range []ExactKindOptions{
		{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Namespaced"},
		{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Cluster", Namespace: "apps"},
		{Group: "../other", Version: "v1", Resource: "widgets", Scope: "Cluster"},
		{Group: "example.com", Version: "v1", Resource: "widgets", Scope: "Cluster", Limit: 501},
	} {
		if _, err := ListExactKind(context.Background(), &rest.Config{Host: "http://127.0.0.1:1"}, o); err == nil {
			t.Fatal("accepted invalid request")
		}
	}
}
