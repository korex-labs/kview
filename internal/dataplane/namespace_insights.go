package dataplane

import (
	"context"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// NamespaceInsightsProjection is a dataplane-backed namespace observability view.
type NamespaceInsightsProjection struct {
	Insights dto.NamespaceInsightsDTO
	Meta     SnapshotMetadata
	Err      *NormalizedError
}

// NamespaceInsightsProjection builds namespace observability details from dataplane snapshots only.
func (m *manager) NamespaceInsightsProjection(ctx context.Context, clusterName, namespace string) (NamespaceInsightsProjection, error) {
	var out NamespaceInsightsProjection

	if m.clients == nil {
		proj, err := m.NamespaceSummaryProjection(ctx, clusterName, namespace)
		out.Meta = proj.Meta
		out.Err = proj.Err
		out.Insights.Summary = proj.Resources
		return out, err
	}

	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceProjection)
	if _, _, err := m.clients.GetClientsForContext(ctx, clusterName); err != nil {
		proj, summaryErr := m.NamespaceSummaryProjection(ctx, clusterName, namespace)
		out.Meta = proj.Meta
		out.Err = proj.Err
		out.Insights.Summary = proj.Resources
		if summaryErr != nil {
			return out, summaryErr
		}
		return out, err
	}

	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	prio := WorkPriorityHigh
	snaps := m.loadNamespaceProjectionSnapshots(ctx, plane, namespace, prio)

	proj, err := buildNamespaceSummaryProjectionFromSnapshots(snaps)
	out.Meta = proj.Meta
	out.Err = proj.Err
	out.Insights.Summary = proj.Resources
	if err != nil {
		return out, err
	}

	policy := m.EffectivePolicy(clusterName)
	thresholds := signalThresholdsFromPolicy(policy)

	if snaps.rqErr == nil {
		out.Insights.ResourceQuotas = append(out.Insights.ResourceQuotas, snaps.rq.Items...)
	}
	if snaps.lrErr == nil {
		out.Insights.LimitRanges = append(out.Insights.LimitRanges, snaps.lr.Items...)
	}
	// Optional pod metrics rollup: cache-only read. The insights drawer must
	// never be able to block on metrics-server being down or RBAC-denied, so
	// we read from the already-warmed cache and silently omit the usage
	// panel if nothing has been observed yet. The background metrics warmer
	// populates this cache when capability is healthy; the capability probe
	// surfaces the "unavailable" state to the UI separately.
	if pmSnap, ok := plane.podMetricsStore.getCached(namespace); ok && len(pmSnap.Items) > 0 {
		usage := &dto.NamespaceResourceUsageDTO{}
		for _, pm := range pmSnap.Items {
			usage.Pods++
			for _, cm := range pm.Containers {
				usage.CPUMilli += cm.CPUMilli
				usage.MemoryBytes += cm.MemoryBytes
			}
		}
		if !pmSnap.Meta.ObservedAt.IsZero() {
			usage.ObservedAt = pmSnap.Meta.ObservedAt.Unix()
		}
		out.Insights.ResourceUsage = usage
	}

	signals := newDashboardSignalStore()
	now := time.Now()
	signals.Add(m.attachSignalHistory(clusterName, now, applySignalPolicy(detectDashboardSignals(now, namespace, dashboardSnapshotSet{
		restartThreshold:       thresholds.PodRestartCount,
		pods:                   snaps.pods,
		podsOK:                 snaps.podsErr == nil,
		deps:                   snaps.deps,
		depsOK:                 snaps.depsErr == nil,
		ds:                     snaps.ds,
		dsOK:                   snaps.dsErr == nil,
		sts:                    snaps.sts,
		stsOK:                  snaps.stsErr == nil,
		rs:                     snaps.rs,
		rsOK:                   snaps.rsErr == nil,
		jobs:                   snaps.jobs,
		jobsOK:                 snaps.jobsErr == nil,
		cjs:                    snaps.cj,
		cjsOK:                  snaps.cjErr == nil,
		hpas:                   snaps.hpa,
		hpasOK:                 snaps.hpaErr == nil,
		svcs:                   snaps.svcs,
		svcsOK:                 snaps.svcsErr == nil,
		ings:                   snaps.ing,
		ingsOK:                 snaps.ingErr == nil,
		pvcs:                   snaps.pvcs,
		pvcsOK:                 snaps.pvcsErr == nil,
		cms:                    snaps.cms,
		cmsOK:                  snaps.cmsErr == nil,
		secs:                   snaps.secs,
		secsOK:                 snaps.secsErr == nil,
		sas:                    snaps.sa,
		sasOK:                  snaps.saErr == nil,
		roles:                  snaps.roles,
		rolesOK:                snaps.rolesErr == nil,
		roleBindings:           snaps.roleBindings,
		roleBindingsOK:         snaps.roleBindingsErr == nil,
		helmReleases:           snaps.helm,
		helmOK:                 snaps.helmErr == nil,
		resourceQuotas:         snaps.rq,
		quotasOK:               snaps.rqErr == nil,
		limitRanges:            snaps.lr,
		limitRangesOK:          snaps.lrErr == nil,
		containerNearLimitPct:  thresholds.ContainerNearLimitPct,
		longRunningJobDuration: thresholds.LongRunningJobDuration,
		cronJobNoSuccessAge:    thresholds.CronJobNoSuccessDuration,
		staleHelmReleaseAge:    thresholds.StaleHelmReleaseDuration,
		unusedResourceAge:      thresholds.UnusedResourceAge,
		quotaWarnRatio:         thresholds.QuotaWarnRatio,
		quotaCritRatio:         thresholds.QuotaCritRatio,
	}), policy, clusterName)...)...)
	sorted := signals.Summary(signals.Len(), ClusterDashboardListOptions{SignalsLimit: signals.Len()})
	out.Insights.Signals = namespaceInsightSignalsFromDashboard(sorted.Items)
	out.Insights.ResourceSignals = namespaceInsightResourceSignalsFromDashboard(signals.ResourceSignals())
	return out, nil
}

// NamespaceInsightSignalsFromDashboard converts dashboard signal items into
// the transport DTO shape used by both namespace insights and per-resource
// signal responses. Public wrapper so packages outside dataplane (e.g. the
// HTTP server) can marshal signals produced by the detail-level detectors
// directly into their response envelopes without duplicating the conversion.
func NamespaceInsightSignalsFromDashboard(items []ClusterDashboardSignal) []dto.NamespaceInsightSignalDTO {
	return namespaceInsightSignalsFromDashboard(items)
}

func namespaceInsightSignalsFromDashboard(items []ClusterDashboardSignal) []dto.NamespaceInsightSignalDTO {
	out := make([]dto.NamespaceInsightSignalDTO, 0, len(items))
	observedAt := time.Now().UTC().Unix()
	for _, item := range items {
		firstSeenAt := item.FirstSeenAt
		if firstSeenAt <= 0 {
			firstSeenAt = observedAt
		}
		lastSeenAt := item.LastSeenAt
		if lastSeenAt <= 0 {
			lastSeenAt = observedAt
		}
		out = append(out, dto.NamespaceInsightSignalDTO{
			Kind:            item.Kind,
			Namespace:       item.Namespace,
			Name:            item.Name,
			Severity:        item.Severity,
			Score:           item.Score,
			Reason:          item.Reason,
			LikelyCause:     item.LikelyCause,
			SuggestedAction: item.SuggestedAction,
			Confidence:      item.Confidence,
			Section:         item.Section,
			SignalType:      item.SignalType,
			ResourceKind:    item.ResourceKind,
			ResourceName:    item.ResourceName,
			Scope:           item.Scope,
			ScopeLocation:   item.ScopeLocation,
			ActualData:      item.ActualData,
			CalculatedData:  item.CalculatedData,
			FirstSeenAt:     firstSeenAt,
			LastSeenAt:      lastSeenAt,
		})
	}
	return out
}

func namespaceInsightResourceSignalsFromDashboard(items []dashboardSignalResourceSignals) []dto.NamespaceResourceSignalsDTO {
	out := make([]dto.NamespaceResourceSignalsDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dto.NamespaceResourceSignalsDTO{
			ResourceKind:  item.ResourceKind,
			ResourceName:  item.ResourceName,
			Scope:         item.Scope,
			ScopeLocation: item.ScopeLocation,
			Signals:       namespaceInsightSignalsFromDashboard(item.Signals),
		})
	}
	return out
}
