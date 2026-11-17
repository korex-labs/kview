package server

import (
	"net/http/httptest"
	"testing"
)

// Retired prototypes must not remain accessible alongside the current trends API.
func TestHistoryPrototypeRoutesRemoved(t *testing.T) {
	s := &Server{token: "fixture-token", dp: &stubDataplane{}}
	for _, path := range []string{"/api/history", "/api/history/signals"} {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer fixture-token")
		r.Header.Set("X-Kview-Context", "synthetic-a")
		w := httptest.NewRecorder()
		s.Router().ServeHTTP(w, r)
		if w.Code != 404 {
			t.Fatalf("%s still registered: %d", path, w.Code)
		}
	}
}
