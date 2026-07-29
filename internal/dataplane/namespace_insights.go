package dataplane

import (
	"context"
	"sort"
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
	snapshotSet := dashboardSnapshotSet{
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
	}
	rawSignals := detectDashboardSignals(now, namespace, snapshotSet)
	namespaceSnapshot, _ := peekClusterSnapshot(&plane.nsStore)
	rawSignals = enrichSignalsFromMetadataIndex(rawSignals, namespaceSignalMetadataIndex(namespaceSnapshot))
	signals.Add(m.attachSignalHistory(clusterName, now, applySignalPolicy(rawSignals, policy, clusterName)...)...)
	sorted := signals.Summary(signals.Len(), ClusterDashboardListOptions{SignalsLimit: signals.Len()})
	out.Insights.Signals = namespaceInsightSignalsFromDashboard(sorted.Items)
	fallbackSignals := namespaceFallbackSignalsForProblematic(now, namespace, out.Insights.Summary.Problematic, rawSignals, plane, policy, clusterName)
	if len(fallbackSignals) > 0 {
		out.Insights.Signals = dedupeNamespaceSignals(append(out.Insights.Signals, fallbackSignals...))
	}
	out.Insights.ResourceSignals = namespaceInsightResourceSignalsFromSignals(out.Insights.Signals)
	return out, nil
}

func namespaceFallbackSignalsForProblematic(now time.Time, namespace string, problematic []dto.ProblematicResource, rawSignals []ClusterDashboardSignal, plane *clusterPlane, policy DataplanePolicy, clusterName string) []dto.NamespaceInsightSignalDTO {
	if len(problematic) == 0 || plane == nil || namespace == "" {
		return nil
	}
	detectedResources := make(map[dashboardSignalResourceKey]struct{}, len(rawSignals))
	for _, signal := range rawSignals {
		detectedResources[dashboardSignalResourceKeyFor(signal)] = struct{}{}
	}
	out := make([]dto.NamespaceInsightSignalDTO, 0, len(problematic))
	for _, resource := range problematic {
		if resource.Kind == "" || resource.Name == "" {
			continue
		}
		key := dashboardSignalResourceKey{kind: resource.Kind, name: resource.Name, scope: ResourceSignalsScopeNamespace, scopeLocation: namespace}
		if _, detected := detectedResources[key]; detected {
			continue
		}
		out = append(out, fallbackSignalsForResource(now, ResourceSignalsScopeNamespace, namespace, resource.Kind, resource.Name, plane, 0)...)
	}
	out = applyNamespaceSignalPolicy(out, policy, clusterName)
	out = dedupeNamespaceSignals(out)
	return out
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
			ObservedDays7d:  item.ObservedDays7d,
			ObservedDays30d: item.ObservedDays30d,
			Recurring:       item.Recurring,
			HistoryKey:      item.HistoryKey,
			Acknowledged:    item.Acknowledged,
			AcknowledgedAt:  item.AcknowledgedAt,
			AckComment:      item.AckComment,
		})
	}
	return out
}

func namespaceInsightResourceSignalsFromSignals(items []dto.NamespaceInsightSignalDTO) []dto.NamespaceResourceSignalsDTO {
	if len(items) == 0 {
		return nil
	}
	type key struct {
		kind          string
		name          string
		scope         string
		scopeLocation string
	}
	grouped := make(map[key][]dto.NamespaceInsightSignalDTO)
	keys := make([]key, 0)
	for _, item := range items {
		kind := item.ResourceKind
		if kind == "" {
			kind = item.Kind
		}
		name := item.ResourceName
		if name == "" {
			name = item.Name
		}
		if kind == "" || name == "" {
			continue
		}
		scope := item.Scope
		if scope == "" {
			scope = ResourceSignalsScopeNamespace
		}
		scopeLocation := item.ScopeLocation
		if scopeLocation == "" && scope == ResourceSignalsScopeNamespace {
			scopeLocation = item.Namespace
		}
		k := key{kind: kind, name: name, scope: scope, scopeLocation: scopeLocation}
		if _, ok := grouped[k]; !ok {
			keys = append(keys, k)
		}
		grouped[k] = append(grouped[k], item)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].scope != keys[j].scope {
			return keys[i].scope < keys[j].scope
		}
		if keys[i].scopeLocation != keys[j].scopeLocation {
			return keys[i].scopeLocation < keys[j].scopeLocation
		}
		if keys[i].kind != keys[j].kind {
			return keys[i].kind < keys[j].kind
		}
		return keys[i].name < keys[j].name
	})
	out := make([]dto.NamespaceResourceSignalsDTO, 0, len(keys))
	for _, k := range keys {
		out = append(out, dto.NamespaceResourceSignalsDTO{
			ResourceKind:  k.kind,
			ResourceName:  k.name,
			Scope:         k.scope,
			ScopeLocation: k.scopeLocation,
			Signals:       grouped[k],
		})
	}
	return out
}
