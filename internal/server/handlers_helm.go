package server

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	kubehelm "github.com/korex-labs/kview/v5/internal/kube/resource/helm"
)

func (s *Server) registerHelmRoutes(api chi.Router) {
	api.Get("/namespaces/{ns}/helmreleases", dataplaneNamespacedListHandler(s, s.dp.HelmReleasesSnapshot, func(items []dto.HelmReleaseDTO) any {
		return dataplane.EnrichHelmReleaseListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/helmreleases/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := kubehelm.GetHelmReleaseDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
	})

	api.Get("/helmcharts", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()

		active := s.readContextName(r)
		clients, active, err := s.mgr.GetClientsForContext(ctx, active)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, err := kubehelm.ListHelmCharts(ctx, clients)
		if err != nil {
			if derived, derr := s.dp.DerivedHelmChartsSnapshot(ctx, active); derr == nil {
				writeJSON(w, http.StatusOK, map[string]any{
					"active":   active,
					"items":    derived.Items,
					"observed": derived.Meta.ObservedAt,
					"meta": map[string]any{
						"freshness":    derived.Meta.Freshness,
						"coverage":     derived.Meta.Coverage,
						"degradation":  derived.Meta.Degradation,
						"completeness": derived.Meta.Completeness,
						"state":        dataplane.CoarseState(derived.Err, len(derived.Items)),
					},
				})
				return
			}
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
	})

}
