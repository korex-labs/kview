package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube"
)

func (s *Server) registerCapabilitiesAndActionsRoutes(api chi.Router) {
	api.Post("/capabilities", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body struct {
			Group     string `json:"group"`
			Resource  string `json:"resource"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Resource == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{
					"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()},
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": &APIError{Code: ErrCodeInternal, Message: err.Error()},
			})
			return
		}

		caps, err := kube.CheckCapabilities(ctx, clients, kube.CapabilitiesRequest{
			Group:     body.Group,
			Resource:  body.Resource,
			Namespace: body.Namespace,
			Name:      body.Name,
		})
		if err != nil {
			status, apiErr := mapKubeError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "capabilities": caps})
	})

	api.Post("/actions", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}

		var body kube.ActionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Resource == "" || body.Action == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
		defer cancel()

		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{
					"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()},
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": &APIError{Code: ErrCodeInternal, Message: err.Error()},
			})
			return
		}

		result, err := s.actions.Execute(ctx, clients, body)
		if err != nil {
			if errors.Is(err, kube.ErrUnknownAction) {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"context": ctxName,
					"error":   validationError(err.Error()),
				})
				return
			}

			status, apiErr := mapKubeError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}

		if body.Resource == "helmreleases" && body.Namespace != "" {
			_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
		}
		if body.Action == "resource.yaml.apply" && body.Namespace != "" {
			switch body.Resource {
			case "deployments":
				_ = s.dp.InvalidateDeploymentsSnapshot(ctx, ctxName, body.Namespace)
			case "configmaps":
				_ = s.dp.InvalidateConfigMapsSnapshot(ctx, ctxName, body.Namespace)
			case "services":
				_ = s.dp.InvalidateServicesSnapshot(ctx, ctxName, body.Namespace)
			case "secrets":
				_ = s.dp.InvalidateSecretsSnapshot(ctx, ctxName, body.Namespace)
			case "ingresses":
				_ = s.dp.InvalidateIngressesSnapshot(ctx, ctxName, body.Namespace)
			case "statefulsets":
				_ = s.dp.InvalidateStatefulSetsSnapshot(ctx, ctxName, body.Namespace)
			case "daemonsets":
				_ = s.dp.InvalidateDaemonSetsSnapshot(ctx, ctxName, body.Namespace)
			}
		}
		if body.Resource == "jobs" && body.Namespace != "" {
			_ = s.dp.InvalidateJobsSnapshot(ctx, ctxName, body.Namespace)
		}
		if body.Action == "cronjob.run" && body.Namespace != "" {
			_ = s.dp.InvalidateJobsSnapshot(ctx, ctxName, body.Namespace)
		}

		writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
	})
}
