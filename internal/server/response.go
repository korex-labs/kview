package server

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

// writeErrorResponse sends a consistent error envelope for API errors.
// Use {"message": msg} so the frontend can extract it consistently (see api.ts extractJsonMessage).
func writeErrorResponse(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"message": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if status >= http.StatusBadRequest {
		if payload, ok := v.(map[string]any); ok {
			if msg, ok := payload["error"].(string); ok && strings.TrimSpace(msg) != "" {
				if status >= http.StatusInternalServerError && looksLikeForbiddenMessage(msg) {
					status = http.StatusForbidden
				}
				payload["error"] = sanitizeErrorMessage(status)
				v = payload
			}
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func looksLikeForbiddenMessage(msg string) bool {
	lower := strings.ToLower(strings.TrimSpace(msg))
	return strings.Contains(lower, "forbidden") ||
		strings.Contains(lower, "not allowed") ||
		strings.Contains(lower, "cannot list resource")
}

func sanitizeErrorMessage(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "bad request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusTooManyRequests:
		return "too many requests"
	default:
		return "request failed"
	}
}

func writeDataplaneListResponse(w http.ResponseWriter, active string, items any, meta dataplane.SnapshotMetadata, nerr *dataplane.NormalizedError) {
	writeJSON(w, http.StatusOK, map[string]any{
		"active":   active,
		"items":    items,
		"observed": meta.ObservedAt,
		"meta": map[string]any{
			"revision":     strconv.FormatUint(meta.Revision, 10),
			"freshness":    meta.Freshness,
			"coverage":     meta.Coverage,
			"degradation":  meta.Degradation,
			"completeness": meta.Completeness,
			"state":        dataplane.CoarseState(nerr, listLength(items)),
		},
	})
}

func dataplaneClusterListHandler[I any](
	s *Server,
	fetch func(context.Context, string) (dataplane.Snapshot[I], error),
	transform func([]I) any,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		snap, err := fetch(ctx, active)
		if err != nil && listLength(snap.Items) == 0 {
			writeDataplaneListError(w, active, err)
			return
		}
		items := any(snap.Items)
		if transform != nil {
			items = transform(snap.Items)
		}
		writeDataplaneListResponse(w, active, items, snap.Meta, snap.Err)
	}
}

func dataplaneNamespacedListHandler[I any](
	s *Server,
	fetch func(context.Context, string, string) (dataplane.Snapshot[I], error),
	transform func([]I) any,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		if ns == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		snap, err := fetch(ctx, active, ns)
		if err != nil && listLength(snap.Items) == 0 {
			writeDataplaneListError(w, active, err)
			return
		}
		items := any(snap.Items)
		if transform != nil {
			items = transform(snap.Items)
		}
		writeDataplaneListResponse(w, active, items, snap.Meta, snap.Err)
	}
}

func writeDataplaneListError(w http.ResponseWriter, active string, err error) {
	status := http.StatusInternalServerError
	if apierrors.IsForbidden(err) {
		status = http.StatusForbidden
	}
	writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
}

func writeDataplaneNormalizedListError(w http.ResponseWriter, active string, err *dataplane.NormalizedError) {
	if err == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "dataplane snapshot unavailable", "active": active})
		return
	}
	status := http.StatusInternalServerError
	if err.Class == dataplane.NormalizedErrorClassAccessDenied || err.Class == dataplane.NormalizedErrorClassUnauthorized {
		status = http.StatusForbidden
	}
	message := err.UpstreamMessage
	if message == "" {
		message = string(err.Class)
	}
	writeJSON(w, status, map[string]any{"error": message, "active": active})
}

func listLength(items any) int {
	// Handles strongly typed DTO slices without endpoint-specific assertions.
	rv := reflect.ValueOf(items)
	if rv.Kind() == reflect.Slice {
		return rv.Len()
	}
	return 0
}
