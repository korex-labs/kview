package server

import (
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"io"
	"net/http"
	"strings"
)

// historyInventory is independent of history collection/consent and reads only
// currently published dataplane inventory. It does not use the /nodes handler.
func (s *Server) historyInventory(w http.ResponseWriter, r *http.Request) {
	name := r.Header.Get("X-Kview-Context")
	if len(r.Header.Values("X-Kview-Context")) != 1 || name == "" || strings.TrimSpace(name) != name || len(name) > 512 || strings.ContainsAny(name, "\x00\r\n") || r.URL.RawQuery != "" {
		writeErrorResponse(w, 400, "explicit context and no query required")
		return
	}
	if r.Body != nil {
		var probe [1]byte
		if n, err := r.Body.Read(probe[:]); n != 0 || err != io.EOF {
			writeErrorResponse(w, 400, "body not supported")
			return
		}
	}
	catalog := localhistory.NewTrendCatalog()
	if source, ok := s.dp.(interface {
		HistoryInventory(string) localhistory.TrendCatalog
	}); ok {
		catalog = source.HistoryInventory(name)
	}
	writeJSON(w, 200, struct {
		Context string `json:"context"`
		localhistory.TrendCatalog
	}{name, catalog})
}
