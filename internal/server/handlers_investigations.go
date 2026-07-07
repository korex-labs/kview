package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/korex-labs/kview/v5/internal/investigation"
)

func (s *Server) registerInvestigationRoutes(api chi.Router) {
	api.Get("/investigations/snapshots", func(w http.ResponseWriter, r *http.Request) {
		store := s.investigationStore()
		filter := investigation.ListFilter{
			Context:   firstNonEmptyServerString(r.URL.Query().Get("context"), s.readContextName(r)),
			Kind:      r.URL.Query().Get("kind"),
			Namespace: r.URL.Query().Get("namespace"),
			Name:      r.URL.Query().Get("name"),
		}
		items, err := store.List(filter)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list investigation snapshots"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": filter.Context, "items": items})
	})

	api.Post("/investigations/snapshots", func(w http.ResponseWriter, r *http.Request) {
		store := s.investigationStore()
		var snapshot investigation.Snapshot
		if err := json.NewDecoder(r.Body).Decode(&snapshot); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid investigation snapshot"})
			return
		}
		if strings.TrimSpace(snapshot.Context) == "" {
			snapshot.Context = s.readContextName(r)
		}
		saved, err := store.Save(snapshot)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": saved.Context, "item": saved})
	})

	api.Get("/investigations/snapshots/{id}", func(w http.ResponseWriter, r *http.Request) {
		store := s.investigationStore()
		snapshot, ok, err := store.Get(chi.URLParam(r, "id"))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to get investigation snapshot"})
			return
		}
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "investigation snapshot not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": snapshot.Context, "item": snapshot})
	})

	api.Delete("/investigations/snapshots/{id}", func(w http.ResponseWriter, r *http.Request) {
		store := s.investigationStore()
		if err := store.Delete(chi.URLParam(r, "id")); err != nil {
			if errors.Is(err, investigation.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "investigation snapshot not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to delete investigation snapshot"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func (s *Server) investigationStore() investigation.Store {
	if s.investigations == nil {
		s.investigations = investigation.NewFileStore("")
	}
	return s.investigations
}
