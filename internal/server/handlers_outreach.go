package server

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/korex-labs/kview/v5/internal/buildinfo"
	"github.com/korex-labs/kview/v5/internal/outreach"
)

// Shared across routers/tabs in this process, initialized without I/O.
var defaultOutreach = sync.OnceValue(outreach.New)

func (s *Server) registerOutreachRoutes(api chi.Router) {
	api.Get("/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		release, err := defaultOutreach().Latest(r.Context())
		if err != nil {
			writeErrorResponse(w, http.StatusServiceUnavailable, "release metadata unavailable")
			return
		}
		writeJSON(w, http.StatusOK, release)
	})
	api.Post("/statistics", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Consent bool `json:"consent"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF || !body.Consent {
			writeErrorResponse(w, http.StatusBadRequest, "explicit statistics consent required")
			return
		}
		// Best effort; errors never affect cluster operations or update checks. No identity in response/logs.
		if defaultOutreach().Send(r.Context(), buildinfo.Version) != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
