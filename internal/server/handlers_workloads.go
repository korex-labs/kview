package server

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	cronjobs "github.com/korex-labs/kview/v5/internal/kube/resource/cronjobs"
	daemonsets "github.com/korex-labs/kview/v5/internal/kube/resource/daemonsets"
	deployments "github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
	hpas "github.com/korex-labs/kview/v5/internal/kube/resource/horizontalpodautoscalers"
	jobs "github.com/korex-labs/kview/v5/internal/kube/resource/jobs"
	pods "github.com/korex-labs/kview/v5/internal/kube/resource/pods"
	replicasets "github.com/korex-labs/kview/v5/internal/kube/resource/replicasets"
	statefulsets "github.com/korex-labs/kview/v5/internal/kube/resource/statefulsets"
	"github.com/korex-labs/kview/v5/internal/stream"
)

func (s *Server) registerWorkloadRoutes(api chi.Router) {
	api.Get("/namespaces/{ns}/pods", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		if ns == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()
		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		// Warm pod metrics cache in the background so the NEXT render
		// has live usage. Current render reads from cache (may be empty
		// on cold start). The scheduler dedupes concurrent warmups and
		// honors TTL so auto-refreshing lists don't pile up work.
		warmPodMetricsAsync(s, active, ns)
		snap, err := s.dp.PodsSnapshot(ctx, active, ns)
		if err != nil && listLength(snap.Items) == 0 {
			writeDataplaneListError(w, active, err)
			return
		}
		// Best-effort pod metrics merge. The pod list DTO carries
		// pod-aggregated request/limit totals populated at list time so
		// percent-of-request and percent-of-limit can be computed here
		// without re-reading pod specs. The drawer merges per-container
		// usage against each container's own spec in the detail handler.
		var podMetricsItems []dto.PodMetricsDTO
		if msnap, ok := s.dp.PodMetricsCachedSnapshot(active, ns); ok && len(msnap.Items) > 0 {
			podMetricsItems = msnap.Items
		}
		items := dataplane.EnrichPodListItemsWithMetrics(snap.Items, dataplane.BuildPodMetricsIndex(podMetricsItems))
		items = dataplane.EnrichPodListItemsWithSignalSummary(items, ns, podMetricsItems, s.dp.EffectivePolicy(active), time.Now())
		writeDataplaneListResponse(w, active, items, snap.Meta, snap.Err)
	})

	// /namespaces/{ns}/podmetrics returns point-in-time pod usage from
	// metrics.k8s.io in the same list envelope as other dataplane kinds.
	// Rows omit request/limit percent here because those are merged into
	// the standard pods list via EnrichPodListItemsForAPI instead.
	api.Get("/namespaces/{ns}/podmetrics", dataplaneNamespacedListHandler(s, s.dp.PodMetricsSnapshot, nil))

	api.Get("/namespaces/{ns}/pods/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := pods.GetPodDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		// Best-effort merge of cached per-container usage. Cache-only on
		// purpose (see nodeMetricsIndexOrNil for the rationale): a missing
		// or RBAC-denied metrics-server must never be able to block this
		// detail response. Cache is warmed asynchronously below so the
		// NEXT open (or a drawer refresh) picks up fresh numbers.
		warmPodMetricsAsync(s, active, ns)
		if s.dp != nil {
			if snap, ok := s.dp.PodMetricsCachedSnapshot(active, ns); ok && len(snap.Items) > 0 {
				dataplane.MergePodDetailsUsage(det, snap.Items)
			}
		}

		// Detail-level signals for the drawer's signals-first Overview.
		// We pull the pod's events best-effort: an RBAC denial on events
		// must not break rendering the pod drawer, so we silently drop
		// event-derived signals if the list call fails.
		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			evs, evErr := kubeevents.ListEventsForPod(ctx, clients, ns, name)
			if evErr != nil {
				evs = nil
			}
			policy := s.dp.EffectivePolicy(active)
			signals := dataplane.DetectPodDetailSignals(time.Now(), ns, *det, evs, dataplane.SignalThresholdsFromPolicy(policy))
			signals = dataplane.ApplySignalPolicy(signals, policy, active)
			detailSignals = dataplane.NamespaceInsightSignalsFromDashboard(signals)
		}
		if detailSignals == nil {
			detailSignals = []dto.NamespaceInsightSignalDTO{}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active":        active,
			"item":          det,
			"detailSignals": detailSignals,
		})
	})

	api.Get("/namespaces/{ns}/pods/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForPodPage(ctx, clients, ns, name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/pods/{name}/services", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		items, err := pods.ListServicesSelectingPod(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/pods/{name}/logs/ws", (&stream.LogsWS{Mgr: s.mgr}).ServeHTTP)

	// Namespaced workload list routes below (daemonsets, statefulsets, replicasets, jobs, cronjobs, HPAs) are
	// dataplane-backed: s.dp.*Snapshot + writeDataplaneListResponse. kube.List* for these kinds runs only
	// inside internal/dataplane snapshot executors, not in handlers. Detail/events/yaml stay direct-read.
	api.Get("/namespaces/{ns}/deployments", dataplaneNamespacedListHandler(s, s.dp.DeploymentsSnapshot, func(items []dto.DeploymentListItemDTO) any {
		return dataplane.EnrichDeploymentListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/deployments/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := deployments.GetDeploymentDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		var detailSignals []dto.NamespaceInsightSignalDTO
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.PodTemplate, det.Spec.Volumes)
			policy := s.dp.EffectivePolicy(active)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectDeploymentDetailSignals(time.Now(), ns, *det, dataplane.SignalThresholdsFromPolicy(policy)), policy, active))
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"active":        active,
			"item":          det,
			"detailSignals": detailSignals,
		})
	})

	api.Get("/namespaces/{ns}/deployments/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Deployment", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/daemonsets", dataplaneNamespacedListHandler(s, s.dp.DaemonSetsSnapshot, func(items []dto.DaemonSetDTO) any {
		return dataplane.EnrichDaemonSetListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/daemonsets/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := daemonsets.GetDaemonSetDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.PodTemplate, det.Spec.Volumes)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectDaemonSetDetailSignals(ns, *det), s.dp.EffectivePolicy(active), active))
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det, "detailSignals": detailSignals})
	})

	api.Get("/namespaces/{ns}/daemonsets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "DaemonSet", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/daemonsets/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := daemonsets.GetDaemonSetYAML(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/statefulsets", dataplaneNamespacedListHandler(s, s.dp.StatefulSetsSnapshot, func(items []dto.StatefulSetDTO) any {
		return dataplane.EnrichStatefulSetListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/statefulsets/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := statefulsets.GetStatefulSetDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.PodTemplate, det.Spec.Volumes)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectStatefulSetDetailSignals(ns, *det), s.dp.EffectivePolicy(active), active))
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det, "detailSignals": detailSignals})
	})

	api.Get("/namespaces/{ns}/statefulsets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "StatefulSet", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/statefulsets/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		y, err := statefulsets.GetStatefulSetYAML(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/replicasets", dataplaneNamespacedListHandler(s, s.dp.ReplicaSetsSnapshot, func(items []dto.ReplicaSetDTO) any {
		return dataplane.EnrichReplicaSetListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/replicasets/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := replicasets.GetReplicaSetDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.PodTemplate, det.Spec.Volumes)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectReplicaSetDetailSignals(ns, *det), s.dp.EffectivePolicy(active), active))
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det, "detailSignals": detailSignals})
	})

	api.Get("/namespaces/{ns}/replicasets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "ReplicaSet", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/jobs", dataplaneNamespacedListHandler(s, s.dp.JobsSnapshot, func(items []dto.JobDTO) any {
		return dataplane.EnrichJobListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/jobs/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := jobs.GetJobDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.PodTemplate, det.Spec.Volumes)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectJobDetailSignals(ns, *det), s.dp.EffectivePolicy(active), active))
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det, "detailSignals": detailSignals})
	})

	api.Get("/namespaces/{ns}/jobs/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "Job", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/cronjobs", dataplaneNamespacedListHandler(s, s.dp.CronJobsSnapshot, func(items []dto.CronJobDTO) any {
		return dataplane.EnrichCronJobListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/cronjobs/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := cronjobs.GetCronJobDetails(ctx, clients, ns, name)
		if err != nil {
			status := http.StatusInternalServerError
			if apierrors.IsForbidden(err) {
				status = http.StatusForbidden
			}
			writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
			return
		}

		detailSignals := []dto.NamespaceInsightSignalDTO{}
		if det != nil {
			det.Spec.MissingReferences = missingTemplateRefsFromDataplane(ctx, s.dp, active, ns, det.Spec.JobTemplate, det.Spec.Volumes)
			detailSignals = detailSignalsResponse(dataplane.ApplySignalPolicy(dataplane.DetectCronJobDetailSignals(ns, *det), s.dp.EffectivePolicy(active), active))
		}

		writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det, "detailSignals": detailSignals})
	})

	api.Get("/namespaces/{ns}/cronjobs/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "CronJob", name, readEventListOptions(r))
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

	api.Get("/namespaces/{ns}/horizontalpodautoscalers", dataplaneNamespacedListHandler(s, s.dp.HPAsSnapshot, func(items []dto.HorizontalPodAutoscalerDTO) any {
		return dataplane.EnrichHorizontalPodAutoscalerListItemsForAPI(items)
	}))

	api.Get("/namespaces/{ns}/horizontalpodautoscalers/{name}", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		det, err := hpas.GetHorizontalPodAutoscalerDetails(ctx, clients, ns, name)
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

	api.Get("/namespaces/{ns}/horizontalpodautoscalers/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		name := chi.URLParam(r, "name")

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		result, err := kubeevents.ListEventsForObjectPage(ctx, clients, ns, "HorizontalPodAutoscaler", name, readEventListOptions(r))
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
