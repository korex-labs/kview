package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/runtime"
)

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prefer Authorization: Bearer. Query "token" is fallback only for WebSocket
		// endpoints, where the browser WebSocket API cannot set custom headers.
		token := r.Header.Get("Authorization")
		if strings.HasPrefix(token, "Bearer ") {
			token = strings.TrimPrefix(token, "Bearer ")
		} else {
			token = r.URL.Query().Get("token")
		}

		if token != s.token {
			writeErrorResponse(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusCapturingWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusCapturingWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (s *Server) activityAccessDeniedLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// WebSocket upgrade requires optional interfaces (Hijacker, etc.).
		// Wrapping ResponseWriter here can break upgrades for terminal/log streams.
		if isWebSocketUpgradeRequest(r) {
			next.ServeHTTP(w, r)
			return
		}

		sw := &statusCapturingWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(sw, r)
		if sw.statusCode != http.StatusForbidden {
			return
		}

		// Avoid flooding runtime logs for periodic polling endpoints.
		key := r.Method + " " + r.URL.Path
		now := time.Now().UTC()
		s.deniedLogMu.Lock()
		until, exists := s.deniedLogUntil[key]
		if exists && now.Before(until) {
			s.deniedLogMu.Unlock()
			return
		}
		s.deniedLogUntil[key] = now.Add(deniedLogSuppressTTL)
		s.deniedLogMu.Unlock()

		s.rt.Log(runtime.LogLevelWarn, "rbac", fmt.Sprintf("access denied: %s", key))
	})
}

func isWebSocketUpgradeRequest(r *http.Request) bool {
	connection := strings.ToLower(r.Header.Get("Connection"))
	upgrade := strings.ToLower(r.Header.Get("Upgrade"))
	return strings.Contains(connection, "upgrade") && upgrade == "websocket"
}

func (s *Server) dataplaneUserActivityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Namespace enrichment idle gate: background polling routes must not count as "activity".
		p := strings.TrimSuffix(r.URL.Path, "/")
		if !isBackgroundPollingPath(p) {
			s.dp.NoteUserActivity()
		}
		next.ServeHTTP(w, r)
	})
}

func isBackgroundPollingPath(p string) bool {
	switch p {
	case "/api/namespaces/enrichment",
		"/api/status",
		"/api/activity",
		"/api/activity/runtime/logs",
		"/api/dataplane/work/live",
		"/api/dataplane/config",
		"/api/dataplane/signals/catalog",
		"/api/dataplane/metrics/status",
		"/api/dashboard/cluster",
		"/api/sessions":
		return true
	default:
		return p == "/api/dataplane/revision"
	}
}
