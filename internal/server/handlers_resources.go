package server

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	configmaps "github.com/korex-labs/kview/v5/internal/kube/resource/configmaps"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
	ingresses "github.com/korex-labs/kview/v5/internal/kube/resource/ingresses"
	pvcs "github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumeclaims"
	rolebindings "github.com/korex-labs/kview/v5/internal/kube/resource/rolebindings"
	roles "github.com/korex-labs/kview/v5/internal/kube/resource/roles"
	secrets "github.com/korex-labs/kview/v5/internal/kube/resource/secrets"
	serviceaccounts "github.com/korex-labs/kview/v5/internal/kube/resource/serviceaccounts"
	svcs "github.com/korex-labs/kview/v5/internal/kube/resource/services"
)

func (s *Server) registerNamespacedResourceRoutes(api chi.Router) {
	api.Get("/namespaces/{ns}/services", dataplaneNamespacedListHandler(s, s.dp.ServicesSnapshot, func(items []dto.ServiceListItemDTO) any {
		return dataplane.EnrichServiceListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/services/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := svcs.GetServiceDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/services/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Service", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/services/{name}/ingresses", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, err := ingresses.ListIngressesForService(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
	})

	api.Get("/namespaces/{ns}/configmaps", dataplaneNamespacedListHandler(s, s.dp.ConfigMapsSnapshot, func(items []dto.ConfigMapDTO) any {
		return dataplane.EnrichConfigMapListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/configmaps/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := configmaps.GetConfigMapDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/configmaps/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "ConfigMap", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/serviceaccounts", dataplaneNamespacedListHandler(s, s.dp.ServiceAccountsSnapshot, func(items []dto.ServiceAccountListItemDTO) any {
		return dataplane.EnrichServiceAccountListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/serviceaccounts/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := serviceaccounts.GetServiceAccountDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/serviceaccounts/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "ServiceAccount", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/serviceaccounts/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := serviceaccounts.GetServiceAccountYAML(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
	})

	api.Get("/namespaces/{ns}/serviceaccounts/{name}/rolebindings", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, err := serviceaccounts.ListRoleBindingsForServiceAccount(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
	})

	api.Get("/namespaces/{ns}/roles", dataplaneNamespacedListHandler(s, s.dp.RolesSnapshot, func(items []dto.RoleListItemDTO) any {
		return dataplane.EnrichRoleListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/roles/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := roles.GetRoleDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/roles/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Role", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/roles/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := roles.GetRoleYAML(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
	})

	api.Get("/namespaces/{ns}/rolebindings", dataplaneNamespacedListHandler(s, s.dp.RoleBindingsSnapshot, func(items []dto.RoleBindingListItemDTO) any {
		return dataplane.EnrichRoleBindingListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/rolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := rolebindings.GetRoleBindingDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/rolebindings/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "RoleBinding", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/rolebindings/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := rolebindings.GetRoleBindingYAML(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
	})

	api.Get("/namespaces/{ns}/persistentvolumeclaims", dataplaneNamespacedListHandler(s, s.dp.PVCsSnapshot, func(items []dto.PersistentVolumeClaimDTO) any {
		return dataplane.EnrichPVCListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := pvcs.GetPersistentVolumeClaimDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "PersistentVolumeClaim", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := pvcs.GetPersistentVolumeClaimYAML(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
	})

	api.Get("/namespaces/{ns}/secrets", dataplaneNamespacedListHandler(s, s.dp.SecretsSnapshot, func(items []dto.SecretDTO) any {
		return dataplane.EnrichSecretListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/secrets/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := secrets.GetSecretDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/secrets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Secret", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})

	api.Get("/namespaces/{ns}/ingresses", dataplaneNamespacedListHandler(s, s.dp.IngressesSnapshot, func(items []dto.IngressListItemDTO) any {
		return dataplane.EnrichIngressListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/ingresses/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := ingresses.GetIngressDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/ingresses/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Ingress", name, readEventListOptions(r))
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeEventListResponse(w, active, result)
	})
}
