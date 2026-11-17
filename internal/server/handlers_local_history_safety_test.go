package server

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

type historyZeroReader struct{}

func (historyZeroReader) Read([]byte) (int, error) { return 0, nil }
func (historyZeroReader) Close() error             { return nil }
func TestLocalHistoryRejectsAmbiguousRequests(t *testing.T) {
	for _, tc := range []struct{ query, context string }{
		{"/api/history/status?namespace=%zz", "synthetic-a"},
		{"/api/history/status?namespace=x;from=y", "synthetic-a"},
		{"/api/history/status?from=x", "synthetic-a"},
		{"/api/history/status?namespace=a&namespace=b", "synthetic-a"},
		{"/api/history/status?namespace=%00", "synthetic-a"},
		{"/api/history/status", " synthetic-a"},
	} {
		r := httptest.NewRequest("GET", tc.query, nil)
		r.Header.Set("X-Kview-Context", tc.context)
		w := httptest.NewRecorder()
		if _, ok := historyRequestScope(w, r); ok || w.Code != 400 {
			t.Fatal(tc, w.Code)
		}
	}
	for _, body := range []io.ReadCloser{historyZeroReader{}, io.NopCloser(strings.NewReader("x"))} {
		r := httptest.NewRequest("GET", "/api/history/status", nil)
		r.Header.Set("X-Kview-Context", "synthetic-a")
		r.Body = body
		if _, ok := historyRequestScope(httptest.NewRecorder(), r); ok {
			t.Fatal("accepted GET body")
		}
	}
	r := httptest.NewRequest("GET", "/api/history/status", nil)
	r.Header.Add("X-Kview-Context", "a")
	r.Header.Add("X-Kview-Context", "b")
	if _, ok := historyRequestScope(httptest.NewRecorder(), r); ok {
		t.Fatal("accepted duplicate header")
	}
}
