package server

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	crs "github.com/korex-labs/kview/v5/internal/kube/resource/customresources"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

func (s *Server) customResourceKind(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	o := crs.ExactKindOptions{Group: chi.URLParam(r, "group"), Version: chi.URLParam(r, "version"), Resource: chi.URLParam(r, "resource"), Scope: q.Get("scope"), Namespace: q.Get("namespace"), Continue: q.Get("continue")}
	if q.Has("limit") {
		limit, err := strconv.Atoi(q.Get("limit"))
		if err != nil || limit < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("limit must be between 1 and 500")})
			return
		}
		o.Limit = limit
	}
	if err := o.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError(err.Error())})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
	defer cancel()
	clients, active, err := s.clientsForRequest(ctx, r)
	fail := func(err error) {
		status, apiErr := mapKubeError(err)
		if apierrors.IsBadRequest(err) {
			status = http.StatusBadRequest
			apiErr = validationError(err.Error())
		}
		writeJSON(w, status, map[string]any{"active": active, "error": apiErr})
	}
	if err != nil {
		fail(err)
		return
	}
	page, err := crs.ListExactKind(ctx, clients.RestConfig, o)
	if err != nil {
		fail(err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Active string `json:"active"`
		*dto.CustomResourceKindList
	}{Active: active, CustomResourceKindList: page})
}
