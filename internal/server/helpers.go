package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/runtime"
)

func missingTemplateRefsFromDataplane(ctx context.Context, dp dataplane.DataPlaneManager, clusterName, namespace string, template dto.PodTemplateSummaryDTO, volumes []dto.VolumeDTO) []dto.MissingReferenceDTO {
	secretRefs := map[string]string{}
	configMapRefs := map[string]string{}
	for _, name := range template.ImagePullSecrets {
		name = strings.TrimSpace(name)
		if name != "" {
			secretRefs[name] = "imagePullSecret"
		}
	}
	for _, volume := range volumes {
		source := strings.TrimSpace(volume.Source)
		if source == "" {
			continue
		}
		switch strings.ToLower(volume.Type) {
		case "secret":
			if _, exists := secretRefs[source]; !exists {
				secretRefs[source] = "volume/" + volume.Name
			}
		case "configmap":
			configMapRefs[source] = "volume/" + volume.Name
		}
	}

	out := []dto.MissingReferenceDTO{}
	if len(secretRefs) > 0 {
		if snap, err := dp.SecretsSnapshot(ctx, clusterName, namespace); err == nil {
			existing := map[string]struct{}{}
			for _, item := range snap.Items {
				existing[item.Name] = struct{}{}
			}
			for name, source := range secretRefs {
				if _, ok := existing[name]; !ok {
					out = append(out, dto.MissingReferenceDTO{Kind: "Secret", Name: name, Source: source})
				}
			}
		}
	}
	if len(configMapRefs) > 0 {
		if snap, err := dp.ConfigMapsSnapshot(ctx, clusterName, namespace); err == nil {
			existing := map[string]struct{}{}
			for _, item := range snap.Items {
				existing[item.Name] = struct{}{}
			}
			for name, source := range configMapRefs {
				if _, ok := existing[name]; !ok {
					out = append(out, dto.MissingReferenceDTO{Kind: "ConfigMap", Name: name, Source: source})
				}
			}
		}
	}
	return out
}

func detailSignalsResponse(signals []dataplane.ClusterDashboardSignal) []dto.NamespaceInsightSignalDTO {
	out := dataplane.NamespaceInsightSignalsFromDashboard(signals)
	if out == nil {
		return []dto.NamespaceInsightSignalDTO{}
	}
	return out
}

// nodeMetricsIndexOrNil returns a cluster node metrics index if one is
// cached for the given cluster, or nil. This function is cache-only by design:
// list/detail enrichment must NEVER trigger a synchronous metrics.k8s.io
// fetch, otherwise a missing or RBAC-denied metrics-server (or a slow
// aggregator) could block the underlying list/detail response for every
// request. Cache population is handled by the background metrics warmer
// (see runMetricsWarmer in the dataplane) and by the dedicated
// /api/nodemetrics route. Every failure mode (dataplane down, cache cold,
// capability unknown) collapses to nil so rows render without usage columns.
func nodeMetricsIndexOrNil(s *Server, clusterName string) dataplane.NodeMetricsByName {
	if s == nil || s.dp == nil {
		return nil
	}
	snap, ok := s.dp.NodeMetricsCachedSnapshot(clusterName)
	if !ok || len(snap.Items) == 0 {
		return nil
	}
	return dataplane.BuildNodeMetricsIndex(snap.Items)
}

// podMetricsIndexOrNil returns a namespaced pod metrics index from the cache, or nil.
// Cache-only by the same rules as nodeMetricsIndexOrNil.
func podMetricsIndexOrNil(s *Server, clusterName, namespace string) dataplane.PodMetricsByKey {
	if s == nil || s.dp == nil {
		return nil
	}
	snap, ok := s.dp.PodMetricsCachedSnapshot(clusterName, namespace)
	if !ok || len(snap.Items) == 0 {
		return nil
	}
	return dataplane.BuildPodMetricsIndex(snap.Items)
}

// warmPodMetricsAsync fires a background fetch for the namespace pod metrics
// snapshot without blocking the caller. The scheduler internally dedupes
// concurrent work for the same key and respects the configured TTL, so hot
// lists (and their auto-refresh loops) converge on one in-flight fetch per
// TTL window without per-request cost.
//
// Errors are silent on purpose: metrics-server being unavailable or RBAC-denied
// must never poison the underlying pod list. We gate on policy to avoid
// churning scheduler slots when the operator disabled metrics explicitly.
func warmPodMetricsAsync(s *Server, clusterName, namespace string) {
	if s == nil || s.dp == nil {
		return
	}
	if !s.dp.EffectivePolicy(clusterName).Metrics.Enabled {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), ctxTimeoutList)
		defer cancel()
		_, _ = s.dp.PodMetricsSnapshot(ctx, clusterName, namespace)
	}()
}

// warmNodeMetricsAsync is the cluster-scoped counterpart to warmPodMetricsAsync.
func warmNodeMetricsAsync(s *Server, clusterName string) {
	if s == nil || s.dp == nil {
		return
	}
	if !s.dp.EffectivePolicy(clusterName).Metrics.Enabled {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), ctxTimeoutList)
		defer cancel()
		_, _ = s.dp.NodeMetricsSnapshot(ctx, clusterName)
	}()
}

func parseClusterDashboardListOptions(r *http.Request) dataplane.ClusterDashboardListOptions {
	q := r.URL.Query()
	return dataplane.ClusterDashboardListOptions{
		SignalsFilter: q.Get("signalsFilter"),
		SignalsQuery:  q.Get("signalsQ"),
		SignalsSort:   q.Get("signalsSort"),
		SignalsOffset: parseNonNegativeQueryInt(q.Get("signalsOffset")),
		SignalsLimit:  parseNonNegativeQueryInt(q.Get("signalsLimit")),
	}
}

func parseNonNegativeQueryInt(raw string) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// logStructured writes a runtime log with a consistent key=value prefix for observability.
// Outcome is one of: start, success, failure. Optional kv pairs (key, value) follow outcome.
// Example: "outcome=success session_id=abc kind=terminal namespace=default name=pod-1 | created terminal session"
func logStructured(rt runtime.RuntimeManager, level runtime.LogLevel, source, outcome string, msg string, kv ...string) {
	var b strings.Builder
	b.WriteString("outcome=")
	b.WriteString(outcome)
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i] == "" || kv[i+1] == "" {
			continue
		}
		b.WriteString(" ")
		b.WriteString(kv[i])
		b.WriteString("=")
		b.WriteString(kv[i+1])
	}
	if msg != "" {
		b.WriteString(" | ")
		b.WriteString(msg)
	}
	rt.Log(level, source, b.String())
}
