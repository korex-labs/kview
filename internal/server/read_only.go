package server

import (
	"net/http"
	"strings"
)

const readOnlyMutationMessage = "read-only mode blocks Kubernetes mutations"

func (s *Server) readOnlyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s == nil || !s.readOnly || !readOnlyBlocksRequest(r.Method, r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		writeReadOnlyBlocked(w, r.URL.Path)
	})
}

func writeReadOnlyBlocked(w http.ResponseWriter, path string) {
	writeJSON(w, http.StatusForbidden, map[string]any{
		"error": &APIError{
			Code:    ErrCodeForbidden,
			Message: readOnlyMutationMessage,
			Details: map[string]any{
				"path": path,
			},
		},
	})
}

func readOnlyBlocksRequest(method, path string) bool {
	p := strings.TrimSuffix(path, "/")

	if method == http.MethodGet && strings.HasPrefix(p, "/api/sessions/") && strings.HasSuffix(p, "/terminal/ws") {
		return true
	}

	if method == http.MethodDelete && strings.HasPrefix(p, "/api/job-runs/") {
		return true
	}

	if method != http.MethodPost {
		return false
	}

	switch {
	case p == "/api/sessions/terminal",
		p == "/api/sessions/portforward",
		p == "/api/container-commands/run":
		return true
	case strings.HasPrefix(p, "/api/namespaces/") && strings.HasSuffix(p, "/job-runs/debug"):
		return true
	case strings.HasPrefix(p, "/api/job-runs/") && strings.HasSuffix(p, "/stop"):
		return true
	default:
		return false
	}
}
