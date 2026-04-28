package server

import (
	"net/http"
	"strconv"

	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
)

func readEventListOptions(r *http.Request) kubeevents.ListOptions {
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	offset, _ := strconv.Atoi(query.Get("offset"))
	return kubeevents.ListOptions{
		Limit:       limit,
		Offset:      offset,
		Query:       query.Get("q"),
		Type:        query.Get("type"),
		SubResource: query.Get("subResource"),
	}
}

func writeEventListResponse(w http.ResponseWriter, active string, result kubeevents.ListResult) {
	writeJSON(w, http.StatusOK, map[string]any{
		"active":  active,
		"items":   result.Items,
		"total":   result.Total,
		"limit":   result.Limit,
		"offset":  result.Offset,
		"hasMore": result.HasMore,
	})
}
