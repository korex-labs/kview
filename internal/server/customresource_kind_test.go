package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestCustomResourceKindHTTP(t *testing.T) {
	for _, tc := range []struct {
		name, query             string
		crdCode, listCode, want int
	}{
		{name: "selected context", query: "scope=Cluster", want: 200},
		{name: "invalid scope", query: "scope=cluster", want: 400},
		{name: "namespace required", query: "scope=Namespaced", want: 400},
		{name: "limit", query: "scope=Cluster&limit=501", want: 400},
		{name: "bad limit", query: "scope=Cluster&limit=no", want: 400},
		{name: "unserved", query: "scope=Cluster", crdCode: 201, want: 400},
		{name: "crd denied", query: "scope=Cluster", crdCode: 403, want: 403},
		{name: "list denied", query: "scope=Cluster", listCode: 403, want: 403},
		{name: "list unavailable", query: "scope=Cluster", listCode: 503, want: 500},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			router := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if r.Method != "GET" {
					t.Errorf("unexpected method %s", r.Method)
				}
				switch r.URL.Path {
				case "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets.example.com":
					if tc.crdCode == 403 {
						w.WriteHeader(403)
						fmt.Fprint(w, `{"kind":"Status","apiVersion":"v1","reason":"Forbidden","code":403}`)
						return
					}
					fmt.Fprintf(w, `{"apiVersion":"apiextensions.k8s.io/v1","kind":"CustomResourceDefinition","metadata":{"name":"widgets.example.com"},"spec":{"group":"example.com","scope":"Cluster","names":{"plural":"widgets","kind":"Widget"},"versions":[{"name":"v1","served":%t,"storage":false}]}}`, tc.crdCode != 201)
				case "/apis/example.com/v1/widgets":
					if tc.listCode != 0 {
						w.WriteHeader(tc.listCode)
						reason := "Forbidden"
						if tc.listCode == 503 {
							reason = "ServiceUnavailable"
						}
						fmt.Fprintf(w, `{"kind":"Status","apiVersion":"v1","reason":%q,"code":%d}`, reason, tc.listCode)
						return
					}
					if r.URL.Query().Get("limit") != "200" {
						t.Error("missing default limit")
					}
					fmt.Fprint(w, `{"apiVersion":"example.com/v1","kind":"WidgetList","items":[]}`)
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
					http.Error(w, "unexpected", 500)
				}
			}))
			req := httptest.NewRequest(http.MethodGet, "/api/customresource-kinds/example.com/v1/widgets?"+tc.query, nil)
			req.Header.Set("Authorization", "Bearer "+testToken)
			req.Header.Set("X-Kview-Context", "selected")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d %s", w.Code, w.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.want == 200 {
				if body["active"] != "selected" || body["scope"] != "Cluster" || calls != 2 {
					t.Fatalf("contract %s calls=%d", w.Body.String(), calls)
				}
			} else if body["error"] == nil {
				t.Fatal("missing error")
			}
			wantCalls := 0
			if tc.want == 200 || tc.listCode != 0 {
				wantCalls = 2
			} else if tc.crdCode != 0 {
				wantCalls = 1
			}
			if calls != wantCalls {
				t.Fatalf("unexpected upstream fanout: got %d want %d", calls, wantCalls)
			}
		})
	}
}

func TestCustomResourceKindRequiresAuthentication(t *testing.T) {
	calls := 0
	router := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "must not reach upstream", 500)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/customresource-kinds/example.com/v1/widgets?scope=Cluster", nil)
	req.Header.Set("X-Kview-Context", "selected")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || calls != 0 {
		t.Fatalf("authentication bypass: status=%d upstream calls=%d", w.Code, calls)
	}
}

// Exercise the public route twice, including URL encoding at both HTTP boundaries.
// No discovery, aggregate read, automatic page drain or per-object GET is allowed.
func TestCustomResourceKindContinuationHTTP(t *testing.T) {
	for _, scope := range []string{"Namespaced", "Cluster"} {
		for _, variant := range []string{"table", "directList", "406", "415", "custom/directList", "custom/406", "custom/415"} {
			t.Run(scope+"/"+variant, func(t *testing.T) {
				mode := strings.TrimPrefix(variant, "custom/")
				listKind, declaration := "WidgetList", ""
				if mode != variant {
					listKind, declaration = "WidgetCollection", `,"listKind":"WidgetCollection"`
				}
				namespace := ""
				path := "/apis/example.com/v1/"
				if scope == "Namespaced" {
					namespace = "apps"
					path += "namespaces/apps/"
				}
				path += "widgets"
				const opaque = " opaque+/=%2F&? token "
				gets, lists, page := 0, 0, 0
				router := customResourceInspectionRouter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if r.Method != http.MethodGet {
						t.Errorf("unexpected method %s", r.Method)
					}
					if r.URL.Path == "/apis/apiextensions.k8s.io/v1/customresourcedefinitions/widgets.example.com" {
						gets++
						fmt.Fprintf(w, `{"apiVersion":"apiextensions.k8s.io/v1","kind":"CustomResourceDefinition","metadata":{"name":"widgets.example.com"},"spec":{"group":"example.com","scope":%q,"names":{"plural":"widgets","kind":"Widget"%s},"versions":[{"name":"v1","served":true,"storage":false},{"name":"v2","served":true,"storage":true}]}}`, scope, declaration)
						return
					}
					if r.URL.Path != path {
						t.Errorf("unexpected path %s", r.URL.Path)
						http.Error(w, "unexpected", 500)
						return
					}
					lists++
					wantContinue := ""
					if page == 1 {
						wantContinue = opaque
					}
					q := r.URL.Query()
					if q.Get("continue") != wantContinue || q.Get("limit") != "1" {
						t.Errorf("lost page scope: %v", q)
					}
					table := strings.Contains(r.Header.Get("Accept"), "as=Table")
					if table && q.Get("includeObject") != "Object" {
						t.Error("missing full object request")
					}
					if !table && (q.Has("includeObject") || r.Header.Get("Accept") != "application/json") {
						t.Error("incorrect fallback request")
					}
					if table && (mode == "406" || mode == "415") {
						code := http.StatusNotAcceptable
						if mode == "415" {
							code = http.StatusUnsupportedMediaType
						}
						w.WriteHeader(code)
						fmt.Fprintf(w, `{"apiVersion":"v1","kind":"Status","code":%d}`, code)
						return
					}
					cont := opaque
					if page == 1 {
						cont = ""
					}
					obj := fmt.Sprintf(`{"apiVersion":"example.com/v1","kind":"Widget","metadata":{"name":"demo-%d","namespace":%q,"uid":"uid-%d","creationTimestamp":"2026-01-01T00:00:00Z"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}`, page, namespace, page)
					if mode == "table" {
						fmt.Fprintf(w, `{"apiVersion":"meta.k8s.io/v1","kind":"Table","metadata":{"continue":%q,"resourceVersion":"42"},"columnDefinitions":[{"name":"Name","type":"string"}],"rows":[{"cells":["demo-%d"],"object":%s}]}`, cont, page, obj)
					} else {
						fmt.Fprintf(w, `{"apiVersion":"example.com/v1","kind":%q,"metadata":{"continue":%q,"resourceVersion":"42"},"items":[%s]}`, listKind, cont, obj)
					}
				}))
				q := url.Values{"scope": {scope}, "limit": {"1"}}
				if namespace != "" {
					q.Set("namespace", namespace)
				}
				for page = 0; page < 2; page++ {
					req := httptest.NewRequest(http.MethodGet, "/api/customresource-kinds/example.com/v1/widgets?"+q.Encode(), nil)
					req.Header.Set("Authorization", "Bearer "+testToken)
					req.Header.Set("X-Kview-Context", "selected")
					w := httptest.NewRecorder()
					router.ServeHTTP(w, req)
					if w.Code != 200 {
						t.Fatalf("page %d: %d %s", page, w.Code, w.Body.String())
					}
					var got struct {
						Active string `json:"active"`
						dto.CustomResourceKindList
					}
					if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
						t.Fatal(err)
					}
					if got.Active != "selected" || got.Group != "example.com" || got.Version != "v1" || got.Resource != "widgets" || got.Kind != "Widget" || got.Scope != scope || got.Namespace != namespace {
						t.Fatalf("lost exact identity: %+v", got)
					}
					if len(got.Items) != 1 {
						t.Fatalf("rows: %+v", got.Items)
					}
					row := got.Items[0]
					if !row.IdentityKnown || !row.AgeKnown || row.Name != fmt.Sprintf("demo-%d", page) || row.UID != fmt.Sprintf("uid-%d", page) || row.Namespace != namespace || row.SignalSeverity != "ok" {
						t.Fatalf("row: %+v", row)
					}
					if got.Meta.Limit != 1 || got.Meta.Pages != 1 || got.Meta.ResourceVersion != "42" || got.Meta.Truncated != (page == 0) || got.Meta.Partial != (page == 0) {
						t.Fatalf("page meta: %+v", got.Meta)
					}
					if (page == 0 && got.Meta.Continue != opaque) || (page == 1 && got.Meta.Continue != "") {
						t.Fatalf("opaque token changed: %q", got.Meta.Continue)
					}
					if mode == "table" {
						if got.Meta.ColumnSource != "table" || got.Meta.FallbackReason != "" || len(row.Cells) != 1 || row.Cells[0] != row.Name {
							t.Fatalf("table contract: %+v", got)
						}
					} else {
						reason := "tableNegotiationUnsupported"
						if mode == "directList" {
							reason = "serverReturnedObjectList"
						}
						if got.Meta.ColumnSource != "standard" || got.Meta.FallbackReason != reason || len(row.Cells) != 3 || row.Cells[0] != row.Name || row.Cells[1] != namespace || row.Cells[2] != float64(row.AgeSec) {
							t.Fatalf("fallback contract: %+v", got)
						}
					}
					q.Set("continue", got.Meta.Continue)
				}
				wantLists := 2
				if mode == "406" || mode == "415" {
					wantLists = 4
				}
				if gets != 2 || lists != wantLists {
					t.Fatalf("unexpected fanout: GETs=%d LISTs=%d", gets, lists)
				}
			})
		}
	}
}
