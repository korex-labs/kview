package server

import (
	"context"
	"net/http"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func (s *Server) workloadLiveHandler(kind dataplane.ResourceKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.handleResourceLive(w, r, kind)
	}
}

// Revision delivery must branch before the generic handler: that handler admits
// observers and snapshot work. Cache misses must not create or hydrate a plane.
func workloadListHandler[I any](s *Server, kind dataplane.ResourceKind,
	fetch func(context.Context, string, string) (dataplane.Snapshot[I], error),
	transform func([]I) any,
) http.HandlerFunc {
	normal := dataplaneNamespacedListHandler(s, fetch, transform)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("refresh") != "revision" {
			if r.URL.Query().Get("refresh") == "manual" {
				// The backend's existing refresh intent also requests bounded Live resync.
				r = r.WithContext(dataplane.WithPodManualRefresh(r.Context()))
			}
			normal(w, r)
			return
		}
		name, ns, ok := s.podLiveScope(w, r)
		if !ok {
			return
		}
		snap, ok := s.dp.CachedResourceSnapshot(name, ns, kind)
		if !ok {
			writeErrorResponse(w, http.StatusServiceUnavailable, "resource snapshot unavailable")
			return
		}
		items, ok := snap.Items.([]I)
		if !ok {
			writeErrorResponse(w, http.StatusServiceUnavailable, "resource snapshot unavailable")
			return
		}
		var response any = items
		if transform != nil {
			response = transform(items)
		}
		writeDataplaneListResponse(w, name, response, snap.Meta, snap.Err)
	}
}
