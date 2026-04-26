package server

import (
	"embed"
	"net/http"
	"strings"
)

//go:embed ui_dist
var uiFS embed.FS

func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "ui_dist/index.html"
	} else {
		path = "ui_dist/" + path
	}

	b, err := uiFS.ReadFile(path)
	if err != nil {
		b, err = uiFS.ReadFile("ui_dist/index.html")
		if err != nil {
			http.Error(w, "UI not built", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	w.Header().Set("Content-Type", contentTypeByPath(path))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

func contentTypeByPath(p string) string {
	switch {
	case strings.HasSuffix(p, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(p, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(p, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(p, ".png"):
		return "image/png"
	default:
		return "application/octet-stream"
	}
}
