package server

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOutreachRoutesRequireAuthenticationAndExplicitConsent(t *testing.T) {
	for _, path := range []string{"/api/statistics", "/api/releases/latest"} {
		if !isBackgroundPollingPath(path) {
			t.Errorf("outreach must not reset idle gate: %s", path)
		}
	}
	s := &Server{token: "test-secret", readOnly: true}
	router := chi.NewRouter()
	router.Use(s.authMiddleware)
	router.Use(s.readOnlyMiddleware)
	router.Route("/api", s.registerOutreachRoutes)
	for _, tc := range []struct {
		method, path, body, token string
		status                    int
	}{
		{"GET", "/api/releases/latest", "", "", 401},
		{"POST", "/api/statistics", `{"consent":true}`, "", 401},
		{"POST", "/api/statistics", `{"consent":false}`, "test-secret", 400},
		{"POST", "/api/statistics", `{"consent":true,"url":"https://evil.invalid"}`, "test-secret", 400},
		{"POST", "/api/statistics", `{"consent":true} {}`, "test-secret", 400},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Errorf("%s %s: %d", tc.method, tc.path, w.Code)
		}
	}
	if readOnlyBlocksRequest(http.MethodPost, "/api/statistics") {
		t.Fatal("consent tied to cluster write permission")
	}
}
