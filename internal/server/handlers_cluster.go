package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/dynamic"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	crbindings "github.com/korex-labs/kview/v5/internal/kube/resource/clusterrolebindings"
	clusterroles "github.com/korex-labs/kview/v5/internal/kube/resource/clusterroles"
	crds "github.com/korex-labs/kview/v5/internal/kube/resource/customresourcedefinitions"
	crs "github.com/korex-labs/kview/v5/internal/kube/resource/customresources"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
	nodes "github.com/korex-labs/kview/v5/internal/kube/resource/nodes"
	pvs "github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumes"
)

func (s *Server) registerClusterResourceRoutes(api chi.Router) {
	api.Get("/nodes", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		// Warm the node metrics cache in the background so the NEXT list
		// render has usage columns. Current render reads whatever is in
		// cache right now (may be empty on cold start). The warmer is a
		// no-op when policy disables metrics.
		warmNodeMetricsAsync(s, active)
		snap, err := s.dp.NodesSnapshot(ctx, active)
		// Pull cached node metrics best-effort; errors (including RBAC
		// denial or missing metrics-server) degrade silently — the node
		// list still renders without usage columns.
		nodeMetricsIndex := nodeMetricsIndexOrNil(s, active)
		if derived, derr := s.dp.DerivedNodesSnapshot(ctx, active); derr == nil && len(derived.Items) > 0 {
			if len(snap.Items) == 0 {
				writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsWithMetrics(derived.Items, nodeMetricsIndex), derived.Meta, derived.Err)
				return
			}
			merged := dataplane.MergeDirectAndDerivedNodeListItems(snap.Items, derived.Items)
			if len(merged) > len(snap.Items) {
				meta := snap.Meta
				meta.Coverage = dataplane.CoverageClassPartial
				meta.Completeness = dataplane.CompletenessClassInexact
				if meta.Degradation == dataplane.DegradationClassNone || meta.Degradation == "" {
					meta.Degradation = dataplane.DegradationClassMinor
				}
				writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsWithMetrics(merged, nodeMetricsIndex), meta, snap.Err)
				return
			}
		}
		if listLength(snap.Items) == 0 {
			if err != nil {
				writeDataplaneListError(w, active, err)
				return
			}
			if snap.Err != nil {
				writeDataplaneNormalizedListError(w, active, snap.Err)
				return
			}
		}
		writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsWithMetrics(snap.Items, nodeMetricsIndex), snap.Meta, snap.Err)
	})

	api.Get("/nodes/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing node name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		clients, active, err := s.mgr.GetClientsForContext(ctx, active)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := nodes.GetNodeDetails(ctx, clients, name)
		if err != nil {
			if derived, ok, derr := s.dp.DerivedNodeDetails(ctx, active, name); derr == nil && ok {
				writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": derived})
				return
			}
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		// Merge cached node usage from the dataplane node metrics snapshot.
		// Cache-only on purpose — never trigger a live metrics.k8s.io fetch
		// here, otherwise a missing/denied metrics-server (or slow
		// aggregator) would block the detail page for every request.
		// The background warmer populates the cache when the capability is
		// available; when not, the detail view renders without usage.
		warmNodeMetricsAsync(s, active)
		if s.dp != nil {
			if snap, ok := s.dp.NodeMetricsCachedSnapshot(active); ok && len(snap.Items) > 0 {
				dataplane.MergeNodeDetailsUsage(det, snap.Items)
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
	})

	// /nodemetrics is a dataplane-backed cluster list of point-in-time node
	// usage from metrics.k8s.io. When metrics-server is missing or RBAC
	// denies list, the standard list envelope carries a degraded/state
	// classification and the UI hides metric widgets via the capability
	// endpoint.
	api.Get("/nodemetrics", dataplaneClusterListHandler(s, s.dp.NodeMetricsSnapshot, nil))

	api.Get("/clusterroles", dataplaneClusterListHandler(s, s.dp.ClusterRolesSnapshot, func(items []dto.ClusterRoleListItemDTO) any {
		return dataplane.EnrichClusterRoleListItemsForAPI(items)
	}))

	api.Get("/clusterroles/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := clusterroles.GetClusterRoleDetails(ctx, clients, name)
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

	api.Get("/clusterroles/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, "", "ClusterRole", name, readEventListOptions(r))
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

	api.Get("/clusterroles/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := clusterroles.GetClusterRoleYAML(ctx, clients, name)
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

	api.Get("/clusterrolebindings", dataplaneClusterListHandler(s, s.dp.ClusterRoleBindingsSnapshot, func(items []dto.ClusterRoleBindingListItemDTO) any {
		return dataplane.EnrichClusterRoleBindingListItemsForAPI(items)
	}))

	api.Get("/clusterrolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := crbindings.GetClusterRoleBindingDetails(ctx, clients, name)
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

	api.Get("/clusterrolebindings/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, "", "ClusterRoleBinding", name, readEventListOptions(r))
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

	api.Get("/clusterrolebindings/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := crbindings.GetClusterRoleBindingYAML(ctx, clients, name)
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

	api.Get("/customresourcedefinitions", dataplaneClusterListHandler(s, s.dp.CRDsSnapshot, func(items []dto.CRDListItemDTO) any {
		return dataplane.EnrichCRDListItemsForAPI(items)
	}))

	api.Get("/customresourcedefinitions/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := crds.GetCustomResourceDefinitionDetails(ctx, clients, name)
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

	api.Get("/customresourcedefinitions/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, "", "CustomResourceDefinition", name, readEventListOptions(r))
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

	api.Get("/customresourcedefinitions/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := crds.GetCustomResourceDefinitionYAML(ctx, clients, name)
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

	// Resolve group+kind → plural resource name and storage version from the CRD snapshot.
	// Used by the frontend when constructing a CRRef from a Helm manifest resource that only
	// carries apiVersion+kind (no plural). Cheap cache read, no live kube call.
	api.Get("/customresources/resolve", func(w http.ResponseWriter, r *http.Request) {
		group := strings.TrimSpace(r.URL.Query().Get("group"))
		kind := strings.TrimSpace(r.URL.Query().Get("kind"))
		if group == "" || kind == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "group and kind are required"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		active := s.readContextName(r)
		snap, err := s.dp.CRDsSnapshot(ctx, active)
		if err != nil && len(snap.Items) == 0 {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "CRD snapshot unavailable", "active": active})
			return
		}

		for _, crd := range snap.Items {
			if crd.Group == group && crd.Kind == kind && crd.Plural != "" && crd.StorageVersion != "" {
				writeJSON(w, http.StatusOK, map[string]any{
					"active":         active,
					"resource":       crd.Plural,
					"storageVersion": crd.StorageVersion,
					"scope":          crd.Scope,
				})
				return
			}
		}

		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no CRD found for group/kind", "active": active})
	})

	// Aggregated custom resource instances — fans out over the CRD dataplane snapshot, no
	// individual CRD detail access required. Uses concurrent dynamic-client list calls bounded
	// by a semaphore; RBAC-denied kinds are silently skipped and reported in meta.
	api.Get("/namespaces/{ns}/customresources", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		if ns == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		crdSnap, err := s.dp.CRDsSnapshot(ctx, active)
		if err != nil && len(crdSnap.Items) == 0 {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "CRD snapshot unavailable: " + err.Error(), "active": active})
			return
		}

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		dynClient, err := dynamic.NewForConfig(clients.RestConfig)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, meta, _ := crs.ListAllNamespacedCRs(ctx, dynClient, crdSnap.Items, ns)
		if items == nil {
			items = []dto.CustomResourceInstanceDTO{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items, "meta": meta})
	})

	api.Get("/customresources/instances", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		crdSnap, err := s.dp.CRDsSnapshot(ctx, active)
		if err != nil && len(crdSnap.Items) == 0 {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "CRD snapshot unavailable: " + err.Error(), "active": active})
			return
		}

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		dynClient, err := dynamic.NewForConfig(clients.RestConfig)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, meta, _ := crs.ListAllClusterCRs(ctx, dynClient, crdSnap.Items)
		if items == nil {
			items = []dto.CustomResourceInstanceDTO{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items, "meta": meta})
	})

	// Single CR instance detail — group/version/resource from the aggregated list row;
	// namespace query param for namespaced kinds, omit for cluster-scoped.
	api.Get("/customresources/{group}/{version}/{resource}/{name}", func(w http.ResponseWriter, r *http.Request) {
		group := chi.URLParam(r, "group")
		version := chi.URLParam(r, "version")
		resource := chi.URLParam(r, "resource")
		name := chi.URLParam(r, "name")
		namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		dynClient, err := dynamic.NewForConfig(clients.RestConfig)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := crs.GetCustomResourceDetails(ctx, dynClient, group, version, resource, namespace, name)
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

	api.Get("/persistentvolumes", dataplaneClusterListHandler(s, s.dp.PersistentVolumesSnapshot, func(items []dto.PersistentVolumeDTO) any {
		return dataplane.EnrichPersistentVolumeListItemsForAPI(items)
	}))

	api.Get("/persistentvolumes/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := pvs.GetPersistentVolumeDetails(ctx, clients, name)
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

	api.Get("/persistentvolumes/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, "", "PersistentVolume", name, readEventListOptions(r))
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

	api.Get("/persistentvolumes/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.clientsForRequest(ctx, r)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := pvs.GetPersistentVolumeYAML(ctx, clients, name)
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
}
