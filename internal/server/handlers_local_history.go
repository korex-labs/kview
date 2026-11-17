package server

import (
	"io"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func (s *Server) CloseLocalHistory() {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	s.historyClosed = true
	for name, h := range s.historyCollectors {
		h.Close()
		delete(s.historyCollectors, name)
	}
}
func (s *Server) registerLocalHistoryRoutes(api chi.Router) {
	api.Get("/history/inventory", s.historyInventory)
	api.Get("/history/settings", s.getHistorySettings)
	api.Post("/history/settings", s.saveHistorySettings)
	api.Get("/history/status", s.localHistoryStatus)
	api.Get("/history/signal-trends", s.signalTrendsQuery)
}
func historyRequestScope(w http.ResponseWriter, r *http.Request) (localhistory.Scope, bool) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "invalid history query")
		return localhistory.Scope{}, false
	}
	scope := localhistory.Scope{Context: r.Header.Get("X-Kview-Context"), Namespace: q.Get("namespace")}
	if len(r.Header.Values("X-Kview-Context")) != 1 || localhistory.ValidateScope(scope) != nil {
		writeErrorResponse(w, http.StatusBadRequest, "explicit X-Kview-Context required")
		return scope, false
	}
	var probe [1]byte
	if r.Body != nil {
		n, err := r.Body.Read(probe[:])
		if n != 0 || err != io.EOF {
			writeErrorResponse(w, http.StatusBadRequest, "GET body not supported")
			return scope, false
		}
	}
	for k, v := range q {
		if len(v) != 1 || (r.URL.Path == "/api/history/status" && k != "namespace") || (k != "namespace" && k != "from" && k != "to" && k != "bucketSeconds") {
			writeErrorResponse(w, http.StatusBadRequest, "invalid history query")
			return scope, false
		}
	}
	return scope, true
}
func (s *Server) localHistoryStatus(w http.ResponseWriter, r *http.Request) {
	scope, ok := historyRequestScope(w, r)
	if !ok {
		return
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	h := s.historyForContext(scope.Context)
	status := h.Status()
	if failure := s.historyFailure(scope.Context); failure != "" {
		status.LastError = failure.message()
	}
	writeJSON(w, http.StatusOK, map[string]any{"context": scope.Context, "namespace": scope.Namespace, "configured": h.SignalsEnabled(scope.Context), "collector": status, "errorCode": s.historyFailure(scope.Context)})
}
