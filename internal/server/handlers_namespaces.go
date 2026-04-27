package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/internal/dataplane"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
	kubeevents "github.com/korex-labs/kview/internal/kube/resource/events"
	namespaces "github.com/korex-labs/kview/internal/kube/resource/namespaces"
)

func (s *Server) registerNamespaceRoutes(api chi.Router) {
	api.Get("/namespaces", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutExec)
		defer cancel()

		active := s.readContextName(r)

		// Warm dataplane observers for the active cluster so snapshots stay reasonably fresh.
		s.dp.EnsureObservers(ctx, active)

		snap, err := s.dp.NamespacesSnapshot(ctx, active)
		if err != nil {
			if len(snap.Items) == 0 {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}
		}

		state := dataplane.CoarseState(snap.Err, len(snap.Items))

		items := snap.Items
		cachedItems, cachedEnriched := s.dp.MergeCachedNamespaceRowProjection(ctx, active, items)
		items = cachedItems
		hints := dataplane.ParseNamespaceEnrichHints(r.URL.Query())
		rev := s.dp.BeginNamespaceListProgressiveEnrichment(active, items, hints)
		policy := s.dp.Policy().NamespaceEnrichment
		rowProj := dto.NamespaceListRowProjectionMetaDTO{
			TotalRows:    len(items),
			EnrichedRows: cachedEnriched,
			Cap:          policy.MaxTargets,
			Revision:     rev,
			Loading:      rev != 0,
			Stage:        "list",
			Note:         "Pod and deployment counts for current, recent, and favourite namespaces appear shortly after you stop interacting with the app.",
		}
		if err != nil {
			rowProj.Note = "Namespace list is using cached data because the latest refresh failed. Row metrics may update after the next successful refresh."
		}
		if rev == 0 {
			rowProj.Loading = false
			if len(items) > 0 && err == nil {
				if !policy.Enabled {
					rowProj.Note = "Namespace row enrichment is disabled in settings."
				} else {
					rowProj.Note = "Row metrics run only for current, recent, and favourite namespaces after idle. Select a namespace, browse resources, or star namespaces."
				}
			}
		} else if policy.Sweep.Enabled {
			rowProj.Note = "Focused namespace enrichment is active; the opt-in background sweep may add a few extra idle namespaces per cycle."
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active":        active,
			"limited":       false,
			"items":         items,
			"rowProjection": rowProj,
			"observed":      snap.Meta.ObservedAt,
			"meta": map[string]any{
				"revision":     strconv.FormatUint(snap.Meta.Revision, 10),
				"freshness":    snap.Meta.Freshness,
				"coverage":     snap.Meta.Coverage,
				"degradation":  snap.Meta.Degradation,
				"completeness": snap.Meta.Completeness,
				"state":        state,
			},
		})
	})

	api.Get("/namespaces/enrichment", func(w http.ResponseWriter, r *http.Request) {
		active := s.readContextName(r)
		revStr := r.URL.Query().Get("revision")
		rev, err := strconv.ParseUint(revStr, 10, 64)
		if err != nil || rev == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid or missing revision query parameter", "active": active})
			return
		}

		poll := s.dp.NamespaceListEnrichmentPoll(active, rev)
		writeJSON(w, http.StatusOK, poll)
	})

	api.Get("/namespaces/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
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

		det, err := namespaces.GetNamespaceDetails(ctx, clients, name)
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

	api.Get("/namespaces/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		evs, err := kubeevents.ListEventsForNamespace(ctx, clients, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
	})

	// Per-resource signals — namespace-scoped.
	// Returns dashboard signals attributed to a single resource from the
	// dataplane's cached snapshots only. Safe to poll. Detail-level signals
	// (computed from a resource's full DetailsDTO) are embedded by the
	// per-kind detail endpoints during drawer migration; this endpoint
	// only surfaces snapshot/aggregate signals.
	api.Get("/namespaces/{ns}/{kind}/{name}/signals", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		route := chi.URLParam(r, "kind")
		name := chi.URLParam(r, "name")
		if ns == "" || route == "" || name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace, kind, or name"})
			return
		}
		kind, ok := dataplane.ResourceSignalKindFromRoute(dataplane.ResourceSignalsScopeNamespace, route)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "unknown resource kind for signals", "kind": route})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()
		active := s.readContextName(r)

		res, err := s.dp.ResourceSignals(ctx, active, dataplane.ResourceSignalsScopeNamespace, ns, kind, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active":  active,
			"signals": res.Signals,
			"meta": map[string]any{
				"freshness":   string(res.Meta.Freshness),
				"degradation": string(res.Meta.Degradation),
			},
		})
	})

	// Per-resource signals — cluster-scoped.
	// Same contract as the namespace-scoped variant for cluster-level
	// resources (Node, PersistentVolume, ClusterRole, …). Lives under the
	// /cluster/ prefix to keep the URL surface unambiguous against the
	// existing top-level cluster resource routes.
	api.Get("/cluster/{kind}/{name}/signals", func(w http.ResponseWriter, r *http.Request) {
		route := chi.URLParam(r, "kind")
		name := chi.URLParam(r, "name")
		if route == "" || name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing kind or name"})
			return
		}
		kind, ok := dataplane.ResourceSignalKindFromRoute(dataplane.ResourceSignalsScopeCluster, route)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "unknown cluster resource kind for signals", "kind": route})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()
		active := s.readContextName(r)

		res, err := s.dp.ResourceSignals(ctx, active, dataplane.ResourceSignalsScopeCluster, "", kind, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active":  active,
			"signals": res.Signals,
			"meta": map[string]any{
				"freshness":   string(res.Meta.Freshness),
				"degradation": string(res.Meta.Degradation),
			},
		})
	})

	api.Get("/namespaces/{name}/insights", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()

		active := s.readContextName(r)

		proj, err := s.dp.NamespaceInsightsProjection(ctx, active, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   proj.Insights,
		})
	})

	api.Get("/namespaces/{name}/summary", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()

		active := s.readContextName(r)

		proj, err := s.dp.NamespaceSummaryProjection(ctx, active, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   proj.Resources,
		})
	})

	api.Get("/namespaces/{name}/resourcequotas", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)

		snap, err := s.dp.ResourceQuotasSnapshot(ctx, active, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeDataplaneListResponse(w, active, snap.Items, snap.Meta, snap.Err)
	})

	api.Get("/namespaces/{name}/limitranges", func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		snap, err := s.dp.LimitRangesSnapshot(ctx, active, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeDataplaneListResponse(w, active, snap.Items, snap.Meta, snap.Err)
	})

	api.Post("/auth/can-i", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Verb      string  `json:"verb"`
			Resource  string  `json:"resource"`
			Group     string  `json:"group"`
			Namespace *string `json:"namespace"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Verb == "" || body.Resource == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		res, err := kube.SelfSubjectAccessReview(ctx, clients, kube.AccessReviewRequest{
			Verb:      body.Verb,
			Resource:  body.Resource,
			Group:     body.Group,
			Namespace: body.Namespace,
		})
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"allowed": res.Allowed, "reason": res.Reason})
	})
}
