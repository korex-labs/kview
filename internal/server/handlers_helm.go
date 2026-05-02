package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/v5/internal/cluster"
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

	// --- Helm mutation endpoints ---

	api.Post("/helm/uninstall", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body kubehelm.HelmUninstallRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmUninstall)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
			return
		}

		result, err := kubehelm.HelmUninstall(ctx, clients, body)
		if err != nil {
			status, apiErr := mapHelmError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
	})

	api.Post("/helm/upgrade", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body kubehelm.HelmUpgradeRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
			return
		}

		result, err := kubehelm.HelmUpgrade(ctx, clients, body)
		if err != nil {
			status, apiErr := mapHelmError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
	})

	api.Post("/helm/install", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body kubehelm.HelmInstallRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
			return
		}

		result, err := kubehelm.HelmInstall(ctx, clients, body)
		if err != nil {
			status, apiErr := mapHelmError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
	})

	api.Post("/helm/reinstall", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body kubehelm.HelmReinstallRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
			return
		}

		result, err := kubehelm.HelmReinstall(ctx, clients, body)
		if err != nil {
			status, apiErr := mapHelmError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
	})
}
