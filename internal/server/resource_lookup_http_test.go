package server

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Characterize the shared HTTP boundary through the real router before moving
// the handlers. Error bodies are deliberately exact, not merely status checks.
func TestResourceLookupHTTPContract(t *testing.T) {
	const identity = `{"group":"apps","version":"v1","resource":"deployments","kind":"Deployment","scope":"namespaced","namespace":"apps","name":"api","uid":"fixture-uid"}`
	const valid = `{"identities":[` + identity + `]}`
	const bodyLimit = 128 << 10
	wantIdentity := dto.ResourceIdentityDTO{Group: "apps", Version: "v1", Resource: "deployments", Kind: "Deployment", Scope: dto.ResourceScopeNamespaced, Namespace: "apps", Name: "api", UID: "fixture-uid"}

	for _, endpoint := range []string{"presence", "ownership"} {
		t.Run(endpoint, func(t *testing.T) {
			path := "/api/dataplane/resource-" + endpoint
			calls := func(dp *stubDataplane) int {
				return len(dp.resourcePresenceCalls) + len(dp.resourceOwnershipCalls)
			}
			assertError := func(t *testing.T, rec *httptest.ResponseRecorder, status int, message string) {
				t.Helper()
				want := fmt.Sprintf("{\"message\":%q}\n", message)
				if rec.Code != status || rec.Body.String() != want || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
					t.Fatalf("status=%d body=%q content-type=%q; want %d %q", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"), status, want)
				}
			}
			invalid := map[string]string{
				"empty body": "", "null": "null", "missing identities": `{}`, "empty identities": `{"identities":[]}`,
				"malformed": `{"identities":[`, "wrong type": `{"identities":"private-value"}`,
				"unknown field":          strings.TrimSuffix(valid, "}") + `,"private-field":true}`,
				"unknown identity field": strings.Replace(valid, `"uid":"fixture-uid"`, `"uid":"fixture-uid","private-field":true`, 1),
				"trailing object":        valid + ` {}`, "trailing null": valid + ` null`, "trailing malformed": valid + ` !`,
				"oversized value":      strings.Replace(valid, "fixture-uid", strings.Repeat("x", bodyLimit), 1),
				"oversized whitespace": valid + strings.Repeat(" ", bodyLimit-len(valid)+1),
				"too many identities":  `{"identities":[` + strings.Repeat(identity+",", dataplane.ResourcePresenceMaxItems) + identity + `]}`,
				"missing namespace":    strings.Replace(valid, `"namespace":"apps",`, "", 1),
				"wrong scope":          strings.Replace(valid, `"scope":"namespaced"`, `"scope":"cluster"`, 1),
			}
			for field, value := range map[string]string{"group": "apps", "version": "v1", "resource": "deployments", "kind": "Deployment", "namespace": "apps", "name": "api"} {
				invalid["unsafe "+field] = strings.Replace(valid, fmt.Sprintf(`"%s":"%s"`, field, value), fmt.Sprintf(`"%s":"../private"`, field), 1)
			}
			if endpoint == "ownership" {
				for name, depth := range map[string]string{"negative": "-1", "excessive": fmt.Sprint(dataplane.ResourceOwnershipMaxDepth + 1), "fractional": "1.5"} {
					invalid[name+" depth"] = strings.TrimSuffix(valid, "}") + `,"depth":` + depth + `}`
				}
			} else {
				invalid["ownership-only depth"] = strings.TrimSuffix(valid, "}") + `,"depth":0}`
			}
			for name, body := range invalid {
				t.Run(name, func(t *testing.T) {
					s, h := newTestServer(t)
					dp := s.dp.(*stubDataplane)
					assertError(t, doReq(t, h, http.MethodPost, path, testToken, []byte(body)), http.StatusBadRequest, "invalid resource "+endpoint+" request")
					if calls(dp) != 0 {
						t.Fatal("invalid request reached dataplane")
					}
				})
			}
			for name, token := range map[string]string{"missing auth": "", "wrong auth": "wrong-token"} {
				t.Run(name, func(t *testing.T) {
					s, h := newTestServer(t)
					dp := s.dp.(*stubDataplane)
					assertError(t, doReq(t, h, http.MethodPost, path, token, []byte(valid)), http.StatusUnauthorized, "unauthorized")
					if calls(dp) != 0 {
						t.Fatal("unauthenticated request reached dataplane")
					}
				})
			}
			for _, tc := range []struct{ name, header, want string }{
				{"active fallback", "", "test-context"}, {"blank fallback", " \t ", "test-context"},
				{"exact explicit", "other-context", "other-context"}, {"trimmed explicit", " other-context ", "other-context"},
				{"unknown explicit is not replaced", "unloaded-context", "unloaded-context"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					s, h := newTestServer(t)
					s.readOnly = true // These POSTs are cache reads, not mutations.
					dp := s.dp.(*stubDataplane)
					rec := doReqWithHeader(t, h, http.MethodPost, path, map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": tc.header}, []byte(valid))
					if rec.Code != http.StatusOK || calls(dp) != 1 {
						t.Fatalf("status=%d calls=%d body=%s", rec.Code, calls(dp), rec.Body.String())
					}
					contextName := dp.resourceOwnershipContext
					var identities []dto.ResourceIdentityDTO
					if endpoint == "presence" {
						contextName = dp.resourcePresenceCalls[0].contextName
						identities = dp.resourcePresenceCalls[0].request.Identities
					} else {
						identities = dp.resourceOwnershipCalls[0].Identities
					}
					if contextName != tc.want || !reflect.DeepEqual(identities, []dto.ResourceIdentityDTO{wantIdentity}) || mustDecodeJSON(t, rec.Body.Bytes())["active"] != tc.want {
						t.Fatalf("context=%q identities=%+v body=%s", contextName, identities, rec.Body.String())
					}
				})
			}
			accepted := map[string]string{
				"exact body limit":    valid + strings.Repeat(" ", bodyLimit-len(valid)),
				"max identities":      `{"identities":[` + strings.Repeat(identity+",", dataplane.ResourcePresenceMaxItems-1) + identity + `]}`,
				"trailing whitespace": valid + " \r\n\t",
			}
			if endpoint == "ownership" {
				accepted["zero depth"] = strings.TrimSuffix(valid, "}") + `,"depth":0}`
				accepted["max depth"] = strings.TrimSuffix(valid, "}") + fmt.Sprintf(`,"depth":%d}`, dataplane.ResourceOwnershipMaxDepth)
			}
			for name, body := range accepted {
				t.Run(name, func(t *testing.T) {
					s, h := newTestServer(t)
					dp := s.dp.(*stubDataplane)
					rec := doReq(t, h, http.MethodPost, path, testToken, []byte(body))
					if rec.Code != http.StatusOK || calls(dp) != 1 {
						t.Fatalf("status=%d calls=%d body=%s", rec.Code, calls(dp), rec.Body.String())
					}
					if endpoint == "ownership" && name == "max depth" && dp.resourceOwnershipCalls[0].Depth != dataplane.ResourceOwnershipMaxDepth {
						t.Fatal("depth changed")
					}
				})
			}
			for _, tc := range []struct {
				name    string
				err     error
				status  int
				message string
			}{
				{"unloaded", dataplane.ErrResourceMapPlaneUnavailable, http.StatusServiceUnavailable, "resource " + endpoint + " unavailable"},
				{"wrapped unloaded", fmt.Errorf("private: %w", dataplane.ErrResourceMapPlaneUnavailable), http.StatusServiceUnavailable, "resource " + endpoint + " unavailable"},
				{"internal", errors.New("private failure"), http.StatusInternalServerError, "failed to resolve resource " + endpoint},
			} {
				t.Run(tc.name, func(t *testing.T) {
					s, h := newTestServer(t)
					dp := s.dp.(*stubDataplane)
					dp.resourcePresenceErr, dp.resourceOwnershipErr = tc.err, tc.err
					assertError(t, doReq(t, h, http.MethodPost, path, testToken, []byte(valid)), tc.status, tc.message)
					if calls(dp) != 1 {
						t.Fatalf("calls=%d", calls(dp))
					}
				})
			}
			for _, body := range []string{valid, "malformed"} {
				t.Run("disabled before decode "+body, func(t *testing.T) {
					s, h := newTestServer(t)
					s.dp = nil
					assertError(t, doReq(t, h, http.MethodPost, path, testToken, []byte(body)), http.StatusServiceUnavailable, "dataplane unavailable")
				})
			}
		})
	}
}
