package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
)

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:*", "http://127.0.0.1:*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Kview-Context"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Protected API
	r.Route("/api", func(api chi.Router) {
		api.Use(s.authMiddleware)
		api.Use(s.readOnlyMiddleware)
		api.Use(s.activityAccessDeniedLogMiddleware)
		api.Use(s.dataplaneUserActivityMiddleware)

		// Read-path ownership (dataplane snapshot vs projection vs direct kube in handler):
		// Keep docs/API_READ_OWNERSHIP.md in sync when adding GET routes.
		// Projections must not perform hidden live kube reads; use snapshots only.

		s.registerActivityAndDataplaneRoutes(api)
		s.registerSessionRoutes(api)
		s.registerPerformanceRoutes(api)
		s.registerNamespaceRoutes(api)
		s.registerClusterResourceRoutes(api)
		s.registerWorkloadRoutes(api)
		s.registerNamespacedResourceRoutes(api)
		s.registerHelmRoutes(api)
		s.registerCapabilitiesAndActionsRoutes(api)
	})

	// Public UI (SPA)
	r.Get("/*", s.serveUI)

	return r
}
