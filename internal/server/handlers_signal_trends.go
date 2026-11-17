package server

import (
	"context"
	"errors"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"io"
	"net/http"
	"net/url"
	"time"
)

func parseSignalTrendsQuery(r *http.Request) (localhistory.TrendQuery, error) {
	out := localhistory.TrendQuery{Context: r.Header.Get("X-Kview-Context")}
	if len(r.Header.Values("X-Kview-Context")) != 1 || len(r.URL.RawQuery) > 32768 {
		return out, localhistory.ErrInvalidQuery
	}
	q, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil {
		return out, e
	}
	for k, values := range q {
		multi := k == "rule" || k == "node" || k == "namespace"
		if !multi && k != "from" && k != "to" && k != "rulesMode" && k != "nodesMode" && k != "namespacesMode" && k != "diagnostics" {
			return out, localhistory.ErrInvalidQuery
		}
		if (!multi && len(values) != 1) || len(values) > localhistory.TrendMaxSelections {
			return out, localhistory.ErrInvalidQuery
		}
		for _, v := range values {
			if v == "" {
				return out, localhistory.ErrInvalidQuery
			}
		}
	}
	if r.Body != nil {
		var probe [1]byte
		if n, e := r.Body.Read(probe[:]); n != 0 || e != io.EOF {
			return out, localhistory.ErrInvalidQuery
		}
	}
	out.From, e = time.Parse(time.RFC3339, q.Get("from"))
	if e != nil {
		return out, e
	}
	out.To, e = time.Parse(time.RFC3339, q.Get("to"))
	if e != nil {
		return out, e
	}
	if values, ok := q["diagnostics"]; ok {
		if len(values) != 1 || values[0] != "transitions" {
			return out, localhistory.ErrInvalidQuery
		}
		out.TransitionDetails = true
	}
	out.RulesMode = q.Get("rulesMode")
	out.NodesMode = q.Get("nodesMode")
	out.NamespacesMode = q.Get("namespacesMode")
	out.Rules = q["rule"]
	out.Nodes = q["node"]
	out.Namespaces = q["namespace"]
	out.Normalize()
	return out, out.Validate()
}
func (s *Server) signalTrendsQuery(w http.ResponseWriter, r *http.Request) {
	q, e := parseSignalTrendsQuery(r)
	if e != nil {
		writeErrorResponse(w, 400, "invalid bounded signal trends query")
		return
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	h := s.historyForContext(q.Context)
	if !h.SignalsEnabled(q.Context) {
		writeErrorResponse(w, 409, "signal trends require explicit resource identity consent")
		return
	}
	response, e := h.QueryTrendsContext(r.Context(), q)
	if e != nil {
		writeSignalTrendsError(w, e)
		return
	}
	writeJSON(w, 200, response)
}

func writeSignalTrendsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, localhistory.ErrTrendQueryLimit):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"code":    "history_query_limit",
			"message": "History query exceeds the memory limit. Choose a shorter period or narrow the date range.",
		})
	case errors.Is(err, context.Canceled):
		// The caller disconnected; do not misreport a storage failure.
		return
	case errors.Is(err, context.DeadlineExceeded):
		writeErrorResponse(w, http.StatusRequestTimeout, "History query timed out. Choose a shorter period and retry.")
	default:
		writeErrorResponse(w, http.StatusServiceUnavailable, "signal trends storage unavailable")
	}
}
