package server

import (
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"net/http/httptest"
	"strings"
	"testing"
)

type historyInventoryDataplane struct {
	stubDataplane
	activity int
	context  string
}

func (d *historyInventoryDataplane) NoteUserActivity() { d.activity++ }
func (d *historyInventoryDataplane) HistoryInventory(name string) localhistory.TrendCatalog {
	d.context = name
	out := localhistory.NewTrendCatalog()
	out.Nodes = append(out.Nodes, localhistory.TrendOption{Key: localhistory.TrendNodeKey("synthetic-worker", "synthetic-uid"), Label: "synthetic-worker"})
	return out
}
func TestHistoryInventoryAuthenticatedBackgroundRoute(t *testing.T) {
	dp := &historyInventoryDataplane{}
	s := &Server{token: "secret", readOnly: true, dp: dp}
	h := s.Router()
	for _, tc := range []struct {
		context, token, suffix string
		status                 int
	}{
		{"synthetic", "secret", "", 200}, {"synthetic", "", "", 401}, {"", "secret", "", 400}, {"synthetic", "secret", "?extra=1", 400},
	} {
		r := httptest.NewRequest("GET", "/api/history/inventory"+tc.suffix, nil)
		if tc.context != "" {
			r.Header.Set("X-Kview-Context", tc.context)
		}
		if tc.token != "" {
			r.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal(tc, w.Code, w.Body.String())
		}
		if tc.status == 200 && (!strings.Contains(w.Body.String(), `"context":"synthetic"`) || !strings.Contains(w.Body.String(), "synthetic-uid")) {
			t.Fatal(w.Body.String())
		}
	}
	if dp.context != "synthetic" || dp.activity != 0 {
		t.Fatal("route resumed foreground activity", dp.context, dp.activity)
	}
}
