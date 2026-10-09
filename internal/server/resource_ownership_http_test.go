package server

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func TestResourceOwnershipHTTPValidationAndRouting(t *testing.T) {
	const path = "/api/dataplane/resource-ownership"
	const identity = `{"group":"apps","version":"v1","resource":"deployments","kind":"Deployment","scope":"namespaced","namespace":"apps","name":"api"}`
	const valid = `{"identities":[` + identity + `],"depth":2}`
	for name, body := range map[string]string{
		"empty body": "", "null": "null", "empty roots": `{"identities":[]}`,
		"unknown field":          `{"identities":[` + identity + `],"extra":true}`,
		"unknown identity field": strings.Replace(valid, `"name":"api"`, `"name":"api","extra":true`, 1),
		"trailing value":         valid + ` {}`, "trailing garbage": valid + `!`,
		"negative depth":    strings.Replace(valid, `"depth":2`, `"depth":-1`, 1),
		"large depth":       strings.Replace(valid, `"depth":2`, `"depth":5`, 1),
		"fractional depth":  strings.Replace(valid, `"depth":2`, `"depth":1.5`, 1),
		"missing namespace": strings.Replace(valid, `"namespace":"apps",`, "", 1),
		"wrong scope":       strings.Replace(valid, `"scope":"namespaced"`, `"scope":"cluster"`, 1),
		"unsafe identity":   strings.Replace(valid, `"name":"api"`, `"name":"../api"`, 1),
		"too many roots":    `{"identities":[` + strings.Repeat(identity+",", dataplane.ResourcePresenceMaxItems) + identity + `]}`,
		"oversize body":     valid + strings.Repeat(" ", 128<<10),
	} {
		t.Run(name, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := s.dp.(*stubDataplane)
			rec := doReq(t, h, http.MethodPost, path, testToken, []byte(body))
			if rec.Code != http.StatusBadRequest || len(dp.resourceOwnershipCalls) != 0 {
				t.Fatalf("status=%d calls=%+v body=%s", rec.Code, dp.resourceOwnershipCalls, rec.Body.String())
			}
		})
	}
	t.Run("auth", func(t *testing.T) {
		s, h := newTestServer(t)
		rec := doReq(t, h, http.MethodPost, path, "", []byte(valid))
		if rec.Code != http.StatusUnauthorized || len(s.dp.(*stubDataplane).resourceOwnershipCalls) != 0 {
			t.Fatalf("status=%d", rec.Code)
		}
	})
	t.Run("explicit context", func(t *testing.T) {
		s, h := newTestServer(t)
		dp := s.dp.(*stubDataplane)
		rec := doReqWithHeader(t, h, http.MethodPost, path, map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "other-context"}, []byte(valid))
		if rec.Code != http.StatusOK || dp.resourceOwnershipContext != "other-context" || len(dp.resourceOwnershipCalls) != 1 {
			t.Fatalf("status=%d context=%s", rec.Code, dp.resourceOwnershipContext)
		}
		request := dp.resourceOwnershipCalls[0]
		if request.Depth != 2 || len(request.Identities) != 1 || request.Identities[0].Resource != "deployments" {
			t.Fatalf("request=%+v", request)
		}
		if mustDecodeJSON(t, rec.Body.Bytes())["active"] != "other-context" {
			t.Fatal("response lost context")
		}
	})
	for name, err := range map[string]error{"unloaded": dataplane.ErrResourceMapPlaneUnavailable, "internal": errors.New("private detail")} {
		t.Run(name, func(t *testing.T) {
			s, h := newTestServer(t)
			s.dp.(*stubDataplane).resourceOwnershipErr = err
			rec := doReq(t, h, http.MethodPost, path, testToken, []byte(valid))
			want := http.StatusInternalServerError
			if errors.Is(err, dataplane.ErrResourceMapPlaneUnavailable) {
				want = http.StatusServiceUnavailable
			}
			if rec.Code != want || strings.Contains(rec.Body.String(), "private detail") {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	t.Run("disabled", func(t *testing.T) {
		s, h := newTestServer(t)
		s.dp = nil
		if rec := doReq(t, h, http.MethodPost, path, testToken, []byte(valid)); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status=%d", rec.Code)
		}
	})
}
