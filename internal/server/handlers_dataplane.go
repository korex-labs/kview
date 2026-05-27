package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/runtime"
)

func (s *Server) registerActivityAndDataplaneRoutes(api chi.Router) {
	api.Get("/activity", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		activities, err := runtime.ListActivitiesSorted(ctx, s.rt.Registry())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list activities"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"items": activities,
		})
	})

	api.Get("/dataplane/work/live", func(w http.ResponseWriter, _ *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, s.dp.SchedulerLiveWork())
	})

	api.Get("/dataplane/metrics/status", func(w http.ResponseWriter, r *http.Request) {
		// Always return 200 with the canonical {active, enabled, capability}
		// shape the UI expects. Returning 5xx here would flip the UI's
		// backend-health signal to unhealthy and hide every resource list,
		// which is a much worse UX than "metrics quietly unavailable".
		active := s.readContextName(r)
		resp := map[string]any{
			"active":     active,
			"enabled":    false,
			"capability": dataplane.MetricsCapability{},
		}
		if s.dp == nil {
			writeJSON(w, http.StatusOK, resp)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()
		resp["capability"] = s.dp.MetricsCapability(ctx, active)
		resp["enabled"] = s.dp.EffectivePolicy(active).Metrics.Enabled
		writeJSON(w, http.StatusOK, resp)
	})

	api.Get("/dataplane/search", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		res, err := s.dp.SearchCachedResources(r.Context(), s.readContextName(r), r.URL.Query().Get("q"), limit, offset)
		if err != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "failed to search dataplane cache")
			return
		}
		writeJSON(w, http.StatusOK, res)
	})

	api.Get("/dataplane/config", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		active := s.readContextName(r)
		bundle := s.dp.PolicyBundle()
		effective := bundle.EffectivePolicy(active)
		writeJSON(w, http.StatusOK, map[string]any{
			"active":    active,
			"bundle":    bundle,
			"item":      effective,
			"effective": effective,
		})
	})

	api.Get("/dataplane/signals/catalog", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		contextName := s.readContextName(r)
		writeJSON(w, http.StatusOK, map[string]any{
			"active": contextName,
			"items":  dataplane.DashboardSignalCatalog(s.dp.EffectivePolicy(contextName), contextName),
		})
	})

	api.Post("/dataplane/signals/investigate", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		var req dataplane.SignalInvestigationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid signal investigation request"})
			return
		}
		if strings.TrimSpace(req.Signal.Kind) == "" && strings.TrimSpace(req.Signal.ResourceKind) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing signal resource kind"})
			return
		}

		active := s.readContextName(r)
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
		defer cancel()

		scope := strings.TrimSpace(req.Signal.Scope)
		namespace := firstNonEmptyServerString(req.Signal.Namespace, req.Signal.ScopeLocation)
		if scope == "" {
			if namespace != "" {
				scope = dataplane.ResourceSignalsScopeNamespace
			} else {
				scope = dataplane.ResourceSignalsScopeCluster
			}
		}
		kind := firstNonEmptyServerString(req.Signal.ResourceKind, req.Signal.Kind)
		name := firstNonEmptyServerString(req.Signal.ResourceName, req.Signal.Name, req.Signal.Namespace)
		if strings.EqualFold(kind, "Namespace") {
			scope = dataplane.ResourceSignalsScopeCluster
			namespace = ""
			name = firstNonEmptyServerString(req.Signal.ResourceName, req.Signal.Name, req.Signal.Namespace, req.Signal.ScopeLocation)
		}

		resourceResult, resourceErr := s.dp.ResourceSignals(ctx, active, scope, namespace, kind, name)
		if resourceErr != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "failed to load resource signals")
			return
		}
		namespaceSignals := resourceResult.Signals
		if scope == dataplane.ResourceSignalsScopeNamespace && namespace != "" {
			nsResult, err := s.dp.NamespaceInsightsProjection(ctx, active, namespace)
			if err == nil {
				namespaceSignals = append(namespaceSignals, nsResult.Insights.Signals...)
			}
		}
		item := dataplane.BuildSignalInvestigation(req.Signal, resourceResult.Signals, namespaceSignals, resourceResult.Meta)
		if clients, _, err := s.clientsForRequest(ctx, r); err == nil {
			helpers := runSignalInvestigationHelpers(ctx, clients, item.PrimaryResource)
			dataplane.ApplySignalInvestigationHelpers(&item, helpers)
		} else {
			dataplane.ApplySignalInvestigationHelpers(&item, []dataplane.SignalInvestigationHelperRun{{
				Name:   "resource helpers",
				Status: "unavailable",
				Unknowns: []dataplane.SignalInvestigationItem{{
					Label: "Cluster client",
					Value: err.Error(),
				}},
			}})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   item,
		})
	})

	api.Get("/dataplane/signals/ack/export", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		active := s.readContextName(r)
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"items":  s.dp.ExportSignalAcknowledgements(active),
		})
	})

	api.Post("/dataplane/signals/ack/import", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		var req struct {
			Strategy string                                                      `json:"strategy"`
			Contexts map[string]map[string]dataplane.SignalAcknowledgementRecord `json:"contexts"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid signal acknowledgement import"})
			return
		}
		strategy := strings.TrimSpace(req.Strategy)
		if strategy != "keepMine" && strategy != "useImported" && strategy != "replaceSections" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid merge strategy"})
			return
		}
		results := map[string]dataplane.SignalAcknowledgementImportResult{}
		for contextName, records := range req.Contexts {
			contextName = strings.TrimSpace(contextName)
			if contextName == "" {
				continue
			}
			result, err := s.dp.ImportSignalAcknowledgements(contextName, records, strategy)
			if err != nil {
				writeErrorResponse(w, http.StatusInternalServerError, "failed to import signal acknowledgements")
				return
			}
			results[contextName] = result
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": results,
		})
	})

	api.Post("/dataplane/signals/ack", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		var req dataplane.SignalAcknowledgementRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid signal acknowledgement"})
			return
		}
		req.HistoryKey = strings.TrimSpace(req.HistoryKey)
		if req.HistoryKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing historyKey"})
			return
		}
		active := s.readContextName(r)
		rec, err := s.dp.AcknowledgeSignal(active, req)
		if err != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "failed to acknowledge signal")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   rec,
		})
	})

	api.Delete("/dataplane/signals/ack", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		var req dataplane.SignalAcknowledgementRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid signal acknowledgement"})
			return
		}
		req.HistoryKey = strings.TrimSpace(req.HistoryKey)
		if req.HistoryKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing historyKey"})
			return
		}
		active := s.readContextName(r)
		if err := s.dp.UnacknowledgeSignal(active, req.HistoryKey); err != nil {
			writeErrorResponse(w, http.StatusInternalServerError, "failed to clear signal acknowledgement")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"ok":     true,
		})
	})

	api.Post("/dataplane/config", func(w http.ResponseWriter, r *http.Request) {
		if s.dp == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
			return
		}
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid dataplane config"})
			return
		}
		var bundle dataplane.DataplanePolicyBundle
		if _, isBundle := raw["global"]; isBundle {
			if payload, err := json.Marshal(raw); err != nil || json.Unmarshal(payload, &bundle) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid dataplane config"})
				return
			}
		} else {
			var policy dataplane.DataplanePolicy
			if payload, err := json.Marshal(raw); err != nil || json.Unmarshal(payload, &policy) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid dataplane config"})
				return
			}
			bundle = s.dp.PolicyBundle()
			bundle.Global = policy
		}
		next := s.dp.SetPolicyBundle(bundle)
		writeJSON(w, http.StatusOK, map[string]any{
			"bundle": next,
			"item":   next.Global,
		})
	})

	api.Get("/activity/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing activity id"})
			return
		}

		// Phase 2A: only runtime/system activity exposes logs.
		if id != runtime.RuntimeActivityID {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "logs not available for this activity"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		logs := s.rt.Logs().List(ctx)
		writeJSON(w, http.StatusOK, map[string]any{"items": logs})
	})

	api.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":            true,
			"activeContext": s.mgr.ActiveContext(),
		})
	})

	api.Get("/status", func(w http.ResponseWriter, r *http.Request) {
		status := s.buildStatus(r.Context(), s.readContextName(r))
		writeJSON(w, http.StatusOK, status)
	})

	api.Get("/dashboard/cluster", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()

		active := s.readContextName(r)

		// Ensure observers are running for the active cluster so snapshots stay reasonably fresh.
		s.dp.EnsureObservers(ctx, active)
		// Warm node metrics so the next dashboard render has cluster-wide
		// usage rollup. Pod metrics warmups are driven by the namespace
		// pod list since they are namespace-scoped and the dashboard only
		// rolls up namespaces that already have cached pod metrics.
		warmNodeMetricsAsync(s, active)

		summary := s.dp.DashboardSummary(ctx, active, parseClusterDashboardListOptions(r))
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   summary,
		})
	})

	api.Post("/dashboard/cluster/query", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()

		active := s.readContextName(r)
		opts := parseClusterDashboardListOptions(r)
		var body struct {
			ResourceTags dataplane.ClusterDashboardResourceTagsOptions `json:"resourceTags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid dashboard query payload"})
			return
		}
		opts.ResourceTags = body.ResourceTags
		opts.ResourceTags.Context = active

		s.dp.EnsureObservers(ctx, active)
		warmNodeMetricsAsync(s, active)

		summary := s.dp.DashboardSummary(ctx, active, opts)
		writeJSON(w, http.StatusOK, map[string]any{
			"active": active,
			"item":   summary,
		})
	})

	api.Get("/dataplane/revision", func(w http.ResponseWriter, r *http.Request) {
		kindStr := strings.TrimSpace(r.URL.Query().Get("kind"))
		kind, ok := dataplane.ParseListRevisionResourceKind(kindStr)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":  "unknown or missing kind query parameter",
				"active": s.readContextName(r),
			})
			return
		}
		ns := strings.TrimSpace(r.URL.Query().Get("namespace"))
		if dataplane.ListRevisionKindNeedsNamespace(kind) && ns == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":  "namespace query parameter is required for this kind",
				"active": s.readContextName(r),
			})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		active := s.readContextName(r)
		env, err := s.dp.ListSnapshotRevision(ctx, active, kind, ns)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}
		writeJSON(w, http.StatusOK, env)
	})

	api.Get("/contexts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"active":         s.mgr.ActiveContext(),
			"contexts":       s.mgr.ListContexts(),
			"kubeconfig":     s.mgr.KubeconfigInfo(),
			"cacheMigration": s.dp.PersistenceMigrationStatus(),
		})
	})

	api.Post("/context/select", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
		previous := s.mgr.ActiveContext()
		if err := s.mgr.SetActiveContext(body.Name); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		active := s.mgr.ActiveContext()
		if previous != active {
			s.stopConnectivityActivityIfUnused(previous)
		}
		writeJSON(w, http.StatusOK, map[string]any{"active": active})
	})
}

func firstNonEmptyServerString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
