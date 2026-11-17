package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

// decodeStrictJSONBody accepts exactly one JSON value within the byte limit.
// Callers retain their endpoint-specific validation and public error messages.
func decodeStrictJSONBody(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return false
	}
	var extra any
	return errors.Is(decoder.Decode(&extra), io.EOF)
}

func (s *Server) handleResourcePresence(w http.ResponseWriter, r *http.Request) {
	if s.dp == nil {
		writeErrorResponse(w, http.StatusServiceUnavailable, "dataplane unavailable")
		return
	}
	var req dataplane.ResourcePresenceRequest
	if !decodeStrictJSONBody(w, r, 128<<10, &req) {
		writeErrorResponse(w, http.StatusBadRequest, "invalid resource presence request")
		return
	}
	if len(req.Identities) == 0 || len(req.Identities) > dataplane.ResourcePresenceMaxItems {
		writeErrorResponse(w, http.StatusBadRequest, "invalid resource presence request")
		return
	}
	for _, identity := range req.Identities {
		if err := identity.Validate(); err != nil || !validResourceMapIdentityQuery(identity) {
			writeErrorResponse(w, http.StatusBadRequest, "invalid resource presence request")
			return
		}
	}
	response, err := s.dp.ResourcePresence(s.readContextName(r), req)
	if errors.Is(err, dataplane.ErrResourceMapPlaneUnavailable) {
		writeErrorResponse(w, http.StatusServiceUnavailable, "resource presence unavailable")
		return
	}
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "failed to resolve resource presence")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleResourceOwnership(w http.ResponseWriter, r *http.Request) {
	if s.dp == nil {
		writeErrorResponse(w, http.StatusServiceUnavailable, "dataplane unavailable")
		return
	}
	var req dataplane.ResourceOwnershipRequest
	if !decodeStrictJSONBody(w, r, 128<<10, &req) {
		writeErrorResponse(w, http.StatusBadRequest, "invalid resource ownership request")
		return
	}
	if req.Depth < 0 || req.Depth > dataplane.ResourceOwnershipMaxDepth || len(req.Identities) == 0 || len(req.Identities) > dataplane.ResourcePresenceMaxItems {
		writeErrorResponse(w, http.StatusBadRequest, "invalid resource ownership request")
		return
	}
	for _, identity := range req.Identities {
		if err := identity.Validate(); err != nil || !validResourceMapIdentityQuery(identity) {
			writeErrorResponse(w, http.StatusBadRequest, "invalid resource ownership request")
			return
		}
	}
	response, err := s.dp.ResourceOwnership(s.readContextName(r), req)
	if errors.Is(err, dataplane.ErrResourceMapPlaneUnavailable) {
		writeErrorResponse(w, http.StatusServiceUnavailable, "resource ownership unavailable")
		return
	}
	if err != nil {
		writeErrorResponse(w, http.StatusInternalServerError, "failed to resolve resource ownership")
		return
	}
	writeJSON(w, http.StatusOK, response)
}
