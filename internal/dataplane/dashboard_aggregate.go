package dataplane

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

const (
	// Restart severity is a coarse operator hint, not predictive analytics.
	restartSeverityHigh   = "high"
	restartSeverityMedium = "medium"
	restartSeverityLow    = "low"
)

// resourceTotalsCompletenessLabel returns complete | partial | unknown for visible vs cached dataplane-list namespaces.
func resourceTotalsCompletenessLabel(visible, withCachedDataplaneLists int) string {
	if visible <= 0 {
		return "unknown"
	}
	if withCachedDataplaneLists <= 0 {
		return "unknown"
	}
	if withCachedDataplaneLists >= visible {
		return "complete"
	}
	return "partial"
}

// aggregateClusterDashboard rolls up the legacy combined resources/signals projection.
func (m *manager) aggregateClusterDashboard(plane *clusterPlane, namespaceSnapshot NamespaceSnapshot, nsNamesSorted []string, nsTotal int, nodesSnap NodesSnapshot, nodeState string, opts ClusterDashboardListOptions) (ClusterDashboardResourcesPanel, ClusterDashboardSignalsPanel, ClusterDashboardDerivedPanel, ClusterDashboardCoverage) {
	return m.aggregateClusterDashboardParts(plane, namespaceSnapshot, nsNamesSorted, nsTotal, nodesSnap, nodeState, opts, true, true)
}

// aggregateClusterDashboardParts rolls up workload totals and optional signals only from namespaces that already
// have cached dataplane list snapshots (typically from visiting those namespaces or row enrichment),
// intersected with the current namespace list snapshot. No alphabetical sampling and no implicit cluster-wide totals.
func (m *manager) aggregateClusterDashboardParts(plane *clusterPlane, namespaceSnapshot NamespaceSnapshot, nsNamesSorted []string, nsTotal int, nodesSnap NodesSnapshot, nodeState string, opts ClusterDashboardListOptions, includeResources, includeSignals bool) (ClusterDashboardResourcesPanel, ClusterDashboardSignalsPanel, ClusterDashboardDerivedPanel, ClusterDashboardCoverage) {
	opts = normalizeClusterDashboardListOptions(opts)
	cov := m.buildDashboardCoverage(plane.name, nsNamesSorted, nsTotal)
	p := m.EffectivePolicy(plane.name)
	policy := p.Dashboard
	thresholds := signalThresholdsFromPolicy(p)

	knownNS := visibleNamespacesWithCachedDataplaneLists(plane, nsNamesSorted)
	cov.NamespacesInResourceTotals = len(knownNS)
	cov.PersistenceHydrating = plane.persistHydrating.Load()
	cov.ResourceTotalsCompleteness = resourceTotalsCompletenessLabel(nsTotal, len(knownNS))
	var derived ClusterDashboardDerivedPanel
	if includeSignals {
		derived = buildDerivedDashboardProjections(plane, knownNS, thresholds.PodRestartCount, nodesSnap, nodeState)
	} else {
		// Preserve the denied-node-list fallback without building signal-oriented
		// node severity/restart projections or Helm projections.
		derived.Nodes.Total = cachedPodNodeTotal(plane, knownNS)
	}

	res := ClusterDashboardResourcesPanel{
		TotalNamespaces: nsTotal,
	}
	signalPanel := ClusterDashboardSignalsPanel{}

	if nsTotal == 0 || len(knownNS) == 0 || plane == nil {
		if nsTotal > 0 && len(knownNS) == 0 {
			res.Note = "No cached dataplane list snapshots yet for visible namespaces; totals stay at zero until namespaces are opened or row enrichment fills caches."
			signalPanel.Note = res.Note
			cov.ResourceTotalsNote = res.Note
		} else if nsTotal == 0 {
			res.Note = "No namespaces visible in snapshot; resource totals are zero."
			signalPanel.Note = res.Note
		}
		return res, signalPanel, derived, cov
	}

	if cov.ResourceTotalsCompleteness == "partial" {
		t := "Resource totals and signals sum only namespaces where the dataplane already has cached list snapshots; some visible namespaces are not included yet."
		res.Note = t
		signalPanel.Note = t
		cov.ResourceTotalsNote = t
	} else {
		cov.ResourceTotalsNote = "Totals include every visible namespace that has at least one cached dataplane list snapshot."
	}

	var aggregateMetas []SnapshotMetadata
	signals := newDashboardSignalStore()
	now := time.Now()
	namespaceMetadata := namespaceSignalMetadataIndex(namespaceSnapshot)

	for _, ns := range knownNS {
		s := buildSnapshotSetForNamespace(plane, ns, thresholds)
		if includeResources && s.podsOK {
			res.Pods += len(s.pods.Items)
		}
		if s.podsOK {
			aggregateMetas = append(aggregateMetas, s.pods.Meta)
		}
		if includeResources && s.depsOK {
			res.Deployments += len(s.deps.Items)
		}
		if includeResources && s.dsOK {
			res.DaemonSets += len(s.ds.Items)
		}
		if s.dsOK {
			aggregateMetas = append(aggregateMetas, s.ds.Meta)
		}
		if includeResources && s.stsOK {
			res.StatefulSets += len(s.sts.Items)
		}
		if s.stsOK {
			aggregateMetas = append(aggregateMetas, s.sts.Meta)
		}
		if includeResources && s.rsOK {
			res.ReplicaSets += len(s.rs.Items)
		}
		if s.rsOK {
			aggregateMetas = append(aggregateMetas, s.rs.Meta)
		}
		if includeResources && s.jobsOK {
			res.Jobs += len(s.jobs.Items)
		}
		if s.jobsOK {
			aggregateMetas = append(aggregateMetas, s.jobs.Meta)
		}
		if includeResources && s.cjsOK {
			res.CronJobs += len(s.cjs.Items)
		}
		if s.cjsOK {
			aggregateMetas = append(aggregateMetas, s.cjs.Meta)
		}
		if includeResources && s.hpasOK {
			res.HorizontalPodAutoscalers += len(s.hpas.Items)
		}
		if s.hpasOK {
			aggregateMetas = append(aggregateMetas, s.hpas.Meta)
		}
		if includeResources && s.svcsOK {
			res.Services += len(s.svcs.Items)
		}
		if s.svcsOK {
			aggregateMetas = append(aggregateMetas, s.svcs.Meta)
		}
		if includeResources && s.ingsOK {
			res.Ingresses += len(s.ings.Items)
		}
		if s.ingsOK {
			aggregateMetas = append(aggregateMetas, s.ings.Meta)
		}
		if includeResources && s.pvcsOK {
			res.PersistentVolumeClaims += len(s.pvcs.Items)
		}
		if s.pvcsOK {
			aggregateMetas = append(aggregateMetas, s.pvcs.Meta)
		}
		if includeResources && s.cmsOK {
			res.ConfigMaps += len(s.cms.Items)
		}
		if s.cmsOK {
			aggregateMetas = append(aggregateMetas, s.cms.Meta)
		}
		if includeResources && s.secsOK {
			res.Secrets += len(s.secs.Items)
		}
		if s.secsOK {
			aggregateMetas = append(aggregateMetas, s.secs.Meta)
		}
		if includeResources && s.sasOK {
			res.ServiceAccounts += len(s.sas.Items)
		}
		if s.sasOK {
			aggregateMetas = append(aggregateMetas, s.sas.Meta)
		}
		if includeResources && s.rolesOK {
			res.Roles += len(s.roles.Items)
		}
		if s.rolesOK {
			aggregateMetas = append(aggregateMetas, s.roles.Meta)
		}
		if includeResources && s.roleBindingsOK {
			res.RoleBindings += len(s.roleBindings.Items)
		}
		if s.roleBindingsOK {
			aggregateMetas = append(aggregateMetas, s.roleBindings.Meta)
		}
		if includeResources && s.helmOK {
			res.HelmReleases += len(s.helmReleases.Items)
		}
		if s.helmOK {
			aggregateMetas = append(aggregateMetas, s.helmReleases.Meta)
		}
		if includeResources && s.customResourcesOK {
			res.CustomResources += len(s.customResources.Items)
		}
		if s.customResourcesOK {
			aggregateMetas = append(aggregateMetas, s.customResources.Meta)
		}
		if includeResources && s.quotasOK {
			res.ResourceQuotas += len(s.resourceQuotas.Items)
		}
		if s.quotasOK {
			aggregateMetas = append(aggregateMetas, s.resourceQuotas.Meta)
		}
		if includeResources && s.limitRangesOK {
			res.LimitRanges += len(s.limitRanges.Items)
		}
		if s.limitRangesOK {
			aggregateMetas = append(aggregateMetas, s.limitRanges.Meta)
		}
		if includeSignals {
			rawSignals := enrichSignalsFromMetadataIndex(detectDashboardSignals(now, ns, s), namespaceMetadata)
			signals.Add(m.attachSignalHistory(plane.name, now, applySignalPolicy(rawSignals, p, plane.name)...)...)
		}
	}
	if includeSignals {
		signals.Add(m.attachSignalHistory(plane.name, now, applySignalPolicy(enrichNodeSignalMetadata(detectNodeResourcePressureSignals(now, plane, nodesSnap, thresholds.NodeResourcePressurePct), nodesSnap), p, plane.name)...)...)
	}

	if len(aggregateMetas) > 0 {
		wf := string(WorstFreshnessFromSnapshots(aggregateMetas...))
		wd := string(WorstDegradationFromSnapshots(aggregateMetas...))
		res.AggregateFreshness = wf
		res.AggregateDegradation = wd
		if includeSignals {
			signalPanel.AggregateFreshness = wf
			signalPanel.AggregateDegradation = wd
		}
	}
	if includeSignals {
		signalNote := signalPanel.Note
		opts.NewestSignalLimit = policy.NewestSignalLimit
		signalPanel = signals.Summary(policy.SignalLimit, opts)
		signalPanel.Note = signalNote
		signalPanel.AggregateFreshness = res.AggregateFreshness
		signalPanel.AggregateDegradation = res.AggregateDegradation
	}

	return res, signalPanel, derived, cov
}

func cachedPodNodeTotal(plane *clusterPlane, knownNS []string) int {
	if plane == nil {
		return 0
	}
	nodes := map[string]struct{}{}
	for _, ns := range knownNS {
		snap, ok := plane.podsStore.getCached(ns)
		if !ok || snap.Err != nil {
			continue
		}
		for _, pod := range snap.Items {
			name := strings.TrimSpace(pod.Node)
			if name == "" {
				name = "(unscheduled)"
			}
			nodes[name] = struct{}{}
		}
	}
	return len(nodes)
}

// buildSnapshotSetForNamespace fetches all cached dataplane list snapshots for
// a single namespace and returns a fully populated dashboardSnapshotSet ready
// for signal detection and resource counting. Adding a new resource kind only
// requires touching this function and the struct definition below.
func buildSnapshotSetForNamespace(plane *clusterPlane, ns string, thresholds resolvedSignalThresholds) dashboardSnapshotSet {
	podsSnap, podsOK := plane.podsStore.getCached(ns)
	depsSnap, depsOK := plane.depsStore.getCached(ns)
	dsSnap, dsOK := plane.dsStore.getCached(ns)
	stsSnap, stsOK := plane.stsStore.getCached(ns)
	rsSnap, rsOK := plane.rsStore.getCached(ns)
	jobsSnap, jobsOK := plane.jobsStore.getCached(ns)
	cjSnap, cjOK := plane.cjStore.getCached(ns)
	hpaSnap, hpaOK := plane.hpaStore.getCached(ns)
	svcsSnap, svcsOK := plane.svcsStore.getCached(ns)
	ingsSnap, ingsOK := plane.ingStore.getCached(ns)
	pvcSnap, pvcOK := plane.pvcsStore.getCached(ns)
	pvSnap, pvOK := peekClusterSnapshot(&plane.persistentVolumesStore)
	cmSnap, cmOK := plane.cmsStore.getCached(ns)
	secSnap, secOK := plane.secsStore.getCached(ns)
	saSnap, saOK := plane.saStore.getCached(ns)
	rolesSnap, rolesOK := plane.rolesStore.getCached(ns)
	roleBindingsSnap, roleBindingsOK := plane.roleBindingsStore.getCached(ns)
	helmReleasesSnap, helmReleasesOK := plane.helmReleasesStore.getCached(ns)
	customResourcesSnap, customResourcesOK := plane.customResourcesStore.getCached(ns)
	rqSnap, rqOK := plane.rqStore.getCached(ns)
	lrSnap, lrOK := plane.lrStore.getCached(ns)
	podMetricsSnap, podMetricsOK := plane.podMetricsStore.getCached(ns)
	return dashboardSnapshotSet{
		restartThreshold:       thresholds.PodRestartCount,
		pods:                   podsSnap,
		podsOK:                 podsOK && podsSnap.Err == nil,
		deps:                   depsSnap,
		depsOK:                 depsOK && depsSnap.Err == nil,
		ds:                     dsSnap,
		dsOK:                   dsOK && dsSnap.Err == nil,
		sts:                    stsSnap,
		stsOK:                  stsOK && stsSnap.Err == nil,
		rs:                     rsSnap,
		rsOK:                   rsOK && rsSnap.Err == nil,
		jobs:                   jobsSnap,
		jobsOK:                 jobsOK && jobsSnap.Err == nil,
		cjs:                    cjSnap,
		cjsOK:                  cjOK && cjSnap.Err == nil,
		hpas:                   hpaSnap,
		hpasOK:                 hpaOK && hpaSnap.Err == nil,
		svcs:                   svcsSnap,
		svcsOK:                 svcsOK && svcsSnap.Err == nil,
		ings:                   ingsSnap,
		ingsOK:                 ingsOK && ingsSnap.Err == nil,
		pvcs:                   pvcSnap,
		pvcsOK:                 pvcOK && pvcSnap.Err == nil,
		pvs:                    pvSnap,
		pvsOK:                  pvOK && pvSnap.Err == nil,
		cms:                    cmSnap,
		cmsOK:                  cmOK && cmSnap.Err == nil,
		secs:                   secSnap,
		secsOK:                 secOK && secSnap.Err == nil,
		sas:                    saSnap,
		sasOK:                  saOK && saSnap.Err == nil,
		roles:                  rolesSnap,
		rolesOK:                rolesOK && rolesSnap.Err == nil,
		roleBindings:           roleBindingsSnap,
		roleBindingsOK:         roleBindingsOK && roleBindingsSnap.Err == nil,
		helmReleases:           helmReleasesSnap,
		helmOK:                 helmReleasesOK && helmReleasesSnap.Err == nil,
		customResources:        customResourcesSnap,
		customResourcesOK:      customResourcesOK && customResourcesSnap.Err == nil,
		resourceQuotas:         rqSnap,
		quotasOK:               rqOK && rqSnap.Err == nil,
		limitRanges:            lrSnap,
		limitRangesOK:          lrOK && lrSnap.Err == nil,
		podMetrics:             podMetricsSnap,
		podMetricsOK:           podMetricsOK && podMetricsSnap.Err == nil,
		containerNearLimitPct:  thresholds.ContainerNearLimitPct,
		longRunningJobDuration: thresholds.LongRunningJobDuration,
		cronJobNoSuccessAge:    thresholds.CronJobNoSuccessDuration,
		staleHelmReleaseAge:    thresholds.StaleHelmReleaseDuration,
		unusedResourceAge:      thresholds.UnusedResourceAge,
		quotaWarnRatio:         thresholds.QuotaWarnRatio,
		quotaCritRatio:         thresholds.QuotaCritRatio,
	}
}

type dashboardSnapshotSet struct {
	// restartThreshold is the minimum restart count to raise a pod restart signal.
	// Set from policy.Signals.Detectors.PodRestarts.RestartCount.
	restartThreshold int32

	pods              PodsSnapshot
	podsOK            bool
	deps              DeploymentsSnapshot
	depsOK            bool
	ds                DaemonSetsSnapshot
	dsOK              bool
	sts               StatefulSetsSnapshot
	stsOK             bool
	rs                ReplicaSetsSnapshot
	rsOK              bool
	jobs              JobsSnapshot
	jobsOK            bool
	cjs               CronJobsSnapshot
	cjsOK             bool
	hpas              HPAsSnapshot
	hpasOK            bool
	svcs              ServicesSnapshot
	svcsOK            bool
	ings              IngressesSnapshot
	ingsOK            bool
	pvcs              PVCsSnapshot
	pvcsOK            bool
	pvs               PersistentVolumesSnapshot
	pvsOK             bool
	cms               ConfigMapsSnapshot
	cmsOK             bool
	secs              SecretsSnapshot
	secsOK            bool
	sas               ServiceAccountsSnapshot
	sasOK             bool
	roles             RolesSnapshot
	rolesOK           bool
	roleBindings      RoleBindingsSnapshot
	roleBindingsOK    bool
	helmReleases      HelmReleasesSnapshot
	helmOK            bool
	customResources   CustomResourcesSnapshot
	customResourcesOK bool
	resourceQuotas    ResourceQuotasSnapshot
	quotasOK          bool
	limitRanges       LimitRangesSnapshot
	limitRangesOK     bool
	podMetrics        PodMetricsSnapshot
	podMetricsOK      bool
	// containerNearLimitPct is the minimum percent-of-limit required to raise
	// a container_near_limit signal. Set from policy.Signals.Detectors.ContainerNearLimit.Percent.
	containerNearLimitPct  int
	longRunningJobDuration time.Duration
	cronJobNoSuccessAge    time.Duration
	staleHelmReleaseAge    time.Duration
	unusedResourceAge      time.Duration
	quotaWarnRatio         float64
	quotaCritRatio         float64
}

func detectDashboardSignals(now time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	var out []ClusterDashboardSignal
	for _, detector := range dashboardSignalDetectors {
		out = append(out, detector.Detect(now, ns, s)...)
	}
	return enrichDashboardSignalMetadata(out, s)
}

func dashboardSignalItem(signalType, kind, namespace, name, severity string, score int, reason, confidence, section string) ClusterDashboardSignal {
	def := dashboardSignalDefinitionForType(signalType)
	if def.ActualData == "" {
		def.ActualData = reason
	}
	resourceName := name
	scope := "namespace"
	scopeLocation := namespace
	if kind == "Namespace" {
		resourceName = namespace
		scope = "cluster"
		scopeLocation = ""
	}
	return ClusterDashboardSignal{
		Kind:            kind,
		Namespace:       namespace,
		Name:            name,
		Severity:        severity,
		Score:           score,
		Reason:          reason,
		LikelyCause:     def.LikelyCause,
		SuggestedAction: def.SuggestedAction,
		Confidence:      confidence,
		Section:         section,
		SignalType:      def.Type,
		SignalPriority:  def.Priority,
		ResourceKind:    kind,
		ResourceName:    resourceName,
		Scope:           scope,
		ScopeLocation:   scopeLocation,
		Focus:           dashboardSignalFocusHint(kind, namespace, resourceName),
		ActualData:      def.ActualData,
		CalculatedData:  def.CalculatedData,
	}
}

func dashboardSignalFocusHint(kind, namespace, name string) *ClusterDashboardSignalFocus {
	resource, ok := dashboardSignalKindResourceKey(kind)
	if !ok || resource == "" {
		return nil
	}
	filter := strings.TrimSpace(name)
	if filter == "" {
		filter = strings.TrimSpace(namespace)
	}
	hint := &ClusterDashboardSignalFocus{
		Resource: resource,
		Filter:   filter,
		Label:    filter,
	}
	if !dashboardResourceTagClusterScoped(resource) {
		hint.Namespace = namespace
	}
	return hint
}

func dashboardPodRestartSignal(namespace string, pod dto.PodListItemDTO, threshold int32) ClusterDashboardSignal {
	severity := restartSeverityFromCount(pod.Restarts)
	score := 61
	if severity == restartSeverityHigh {
		score = 83
	}
	f := dashboardSignalItem("pod_restarts", "Pod", namespace, pod.Name, severity, score, "Pod has elevated restart count.", "high", "pods")
	f.ActualData = fmt.Sprintf("%d restarts", pod.Restarts)
	if pod.AgeSec > 0 {
		f.ActualData = fmt.Sprintf("%s · age %.1fd", f.ActualData, float64(pod.AgeSec)/float64((24*time.Hour).Seconds()))
	}
	if threshold <= 0 {
		threshold = signalRestartMinThreshold
	}
	f.CalculatedData = fmt.Sprintf("restart count is at least %d (rate %.1f/day)", threshold, restartRatePerDay(pod.Restarts, pod.AgeSec))
	return f
}

// restartSeverityFromCount maps restart counts to coarse severity buckets.
// signalRestartMedThreshold (20) and signalRestartMinThreshold (5) are fixed
// presentation thresholds here; the policy knob RestartElevatedThreshold
// governs when a pod restart signal is raised (see detectPodRestartSignals).
func restartSeverityFromCount(restarts int32) string {
	switch {
	case restarts >= signalRestartMedThreshold:
		return restartSeverityHigh
	case restarts >= signalRestartMinThreshold:
		return restartSeverityMedium
	default:
		return restartSeverityLow
	}
}

func restartRatePerDay(restarts int32, ageSec int64) float64 {
	if restarts <= 0 || ageSec <= 0 {
		return 0
	}
	rate := float64(restarts) * 86400 / float64(ageSec)
	return math.Round(rate*10) / 10
}

func isEmptyLookingNamespace(s dashboardSnapshotSet) bool {
	requiredOK := s.podsOK && s.depsOK && s.dsOK && s.stsOK && s.rsOK && s.jobsOK && s.cjsOK && s.svcsOK && s.ingsOK && s.pvcsOK && s.cmsOK && s.secsOK && s.helmOK
	if !requiredOK {
		return false
	}
	return len(s.pods.Items) == 0 &&
		len(s.deps.Items) == 0 &&
		len(s.ds.Items) == 0 &&
		len(s.sts.Items) == 0 &&
		len(s.rs.Items) == 0 &&
		len(s.jobs.Items) == 0 &&
		len(s.cjs.Items) == 0 &&
		(!s.hpasOK || len(s.hpas.Items) == 0) &&
		len(s.svcs.Items) == 0 &&
		len(s.ings.Items) == 0 &&
		len(s.pvcs.Items) == 0 &&
		nonSystemConfigMapCount(s.cms.Items) == 0 &&
		len(s.secs.Items) == 0 &&
		len(s.helmReleases.Items) == 0
}

func nonSystemConfigMapCount(items []dto.ConfigMapDTO) int {
	n := 0
	for _, item := range items {
		if item.Name == "kube-root-ca.crt" {
			continue
		}
		n++
	}
	return n
}

func isTransitionalHelmStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending-install", "pending-upgrade", "pending-rollback", "uninstalling":
		return true
	default:
		return false
	}
}

func summarizeDashboardSignals(signals []ClusterDashboardSignal, limit int, opts ClusterDashboardListOptions) ClusterDashboardSignalsPanel {
	signals = normalizeDashboardSignalSeenTimestamps(signals)
	opts = normalizeClusterDashboardListOptions(opts)
	if limit <= 0 {
		limit = 10
	}
	sort.Slice(signals, func(i, j int) bool {
		return dashboardSignalLess(signals[i], signals[j])
	})
	out := ClusterDashboardSignalsPanel{Total: len(signals)}
	for _, f := range signals {
		switch f.Severity {
		case "high":
			out.High++
		case "medium":
			out.Medium++
		default:
			out.Low++
		}
		out.incrementSignalCounter(dashboardSignalDefinitionForType(f.SignalType).SummaryCounter)
	}
	if len(signals) > limit {
		out.Top = append(out.Top, signals[:limit]...)
	} else {
		out.Top = append(out.Top, signals...)
	}
	out.Filters = buildDashboardSignalFilters(signals, len(out.Top), out, opts)
	pageSource := filterDashboardSignals(signals, opts.SignalsFilters, opts.SignalsQuery, opts)
	if len(opts.SignalsFilters) == 0 || (len(opts.SignalsFilters) == 1 && opts.SignalsFilters[0] == "top") {
		if len(pageSource) > limit {
			pageSource = pageSource[:limit]
		}
	}
	out.ItemsTotal = len(pageSource)
	out.ItemsOffset = opts.SignalsOffset
	out.ItemsLimit = opts.SignalsLimit
	out.ItemsFilter = opts.SignalsFilter
	out.ItemsQuery = opts.SignalsQuery
	itemSort := opts.SignalsSort
	if dashboardSignalHasFilter(opts.SignalsFilters, "newest") && (itemSort == "" || itemSort == "priority") {
		itemSort = "discovered_desc"
	}
	out.ItemsSort = itemSort
	sortDashboardSignalsForItems(pageSource, itemSort)
	out.Items = append(out.Items, paginateDashboardSignals(pageSource, opts.SignalsOffset, opts.SignalsLimit)...)
	out.ItemsHasMore = out.ItemsOffset+len(out.Items) < out.ItemsTotal
	return out
}

func normalizeDashboardSignalSeenTimestamps(signals []ClusterDashboardSignal) []ClusterDashboardSignal {
	if len(signals) == 0 {
		return signals
	}
	out := make([]ClusterDashboardSignal, len(signals))
	copy(out, signals)
	for i := range out {
		if out[i].FirstSeenAt <= 0 && out[i].LastSeenAt > 0 {
			out[i].FirstSeenAt = out[i].LastSeenAt
		}
		if out[i].LastSeenAt <= 0 && out[i].FirstSeenAt > 0 {
			out[i].LastSeenAt = out[i].FirstSeenAt
		}
	}
	return out
}

func (p *ClusterDashboardSignalsPanel) incrementSignalCounter(counter string) {
	switch counter {
	case "empty_namespaces":
		p.EmptyNamespaces++
	case "stuck_helm_releases":
		p.StuckHelmReleases++
	case "abnormal_jobs":
		p.AbnormalJobs++
	case "abnormal_cronjobs":
		p.AbnormalCronJobs++
	case "empty_configmaps":
		p.EmptyConfigMaps++
	case "empty_secrets":
		p.EmptySecrets++
	case "potentially_unused_pvcs":
		p.PotentiallyUnusedPVCs++
	case "potentially_unused_serviceaccounts":
		p.PotentiallyUnusedSAs++
	case "quota_warnings":
		p.QuotaWarnings++
	case "pod_restart_signals":
		p.PodRestartSignals++
	case "workload_warnings":
		p.WorkloadWarnings++
	case "service_warnings":
		p.ServiceWarnings++
	case "ingress_warnings":
		p.IngressWarnings++
	case "pvc_warnings":
		p.PVCWarnings++
	case "role_warnings":
		p.RoleWarnings++
	case "rolebinding_warnings":
		p.RoleBindingWarnings++
	case "hpa_warnings":
		p.HPAWarnings++
	case "container_near_limit":
		p.ContainerNearLimit++
	case "node_resource_pressure":
		p.NodeResourcePressure++
	}
}

func buildDashboardSignalFilters(signals []ClusterDashboardSignal, topCount int, summary ClusterDashboardSignalsPanel, opts ClusterDashboardListOptions) []ClusterDashboardSignalFilter {
	countSource := signals
	if opts.SignalsCombined && len(opts.SignalsFilters) > 0 {
		countSource = filterDashboardSignals(signals, opts.SignalsFilters, "", opts)
		summary = summarizeDashboardSignalCounts(countSource)
		if len(countSource) < topCount {
			topCount = len(countSource)
		}
	}
	openCount := 0
	ackCount := 0
	for _, signal := range countSource {
		if signal.Acknowledged {
			ackCount++
		} else {
			openCount++
		}
	}
	filters := []ClusterDashboardSignalFilter{
		{ID: "top", Label: "Top priority", Count: topCount, Category: "priority"},
		{ID: "newest", Label: "Newest", Count: minInt(len(countSource), opts.NewestSignalLimit), Category: "priority"},
		{ID: "open", Label: "Open", Count: openCount, Category: "acknowledgement"},
		{ID: "acknowledged", Label: "Acknowledged", Count: ackCount, Category: "acknowledgement"},
		{ID: "high", Label: "High severity", Count: summary.High, Category: "severity", Severity: "high"},
		{ID: "medium", Label: "Medium severity", Count: summary.Medium, Category: "severity", Severity: "medium"},
		{ID: "low", Label: "Low severity", Count: summary.Low, Category: "severity", Severity: "low"},
	}
	filters = append(filters, dashboardSignalTagFilters(countSource, opts)...)

	kindFilters := map[string]dashboardCountedFilter{}
	namespaceFilters := map[string]dashboardCountedFilter{}
	type signalTypeCount struct {
		id       string
		count    int
		severity string
		priority int
	}
	byType := map[string]signalTypeCount{}
	for _, signal := range countSource {
		if signal.Kind != "" {
			id := "kind:" + signal.Kind
			current := kindFilters[id]
			current.id = id
			current.label = signal.Kind
			current.count++
			current.severity = worstSignalSeverity(current.severity, signal.Severity)
			current.priority = dashboardSignalKindPriority(signal.Kind)
			kindFilters[id] = current
		}
		if signal.Namespace != "" {
			id := "namespace:" + signal.Namespace
			current := namespaceFilters[id]
			current.id = id
			current.label = signal.Namespace
			current.count++
			current.severity = worstSignalSeverity(current.severity, signal.Severity)
			namespaceFilters[id] = current
		}
		if signal.SignalType == "" {
			continue
		}
		id := "signal:" + signal.SignalType
		current := byType[id]
		current.id = id
		current.count++
		current.severity = worstSignalSeverity(current.severity, signal.Severity)
		current.priority = dashboardSignalPriority(signal)
		byType[id] = current
	}
	kinds := countedFiltersFromMap(kindFilters)
	sort.Slice(kinds, func(i, j int) bool {
		if si, sj := dashboardSignalSeverityPriority(kinds[i].severity), dashboardSignalSeverityPriority(kinds[j].severity); si != sj {
			return si < sj
		}
		if kinds[i].priority != kinds[j].priority {
			return kinds[i].priority < kinds[j].priority
		}
		return kinds[i].label < kinds[j].label
	})
	for _, item := range kinds {
		filters = append(filters, ClusterDashboardSignalFilter{
			ID:       item.id,
			Label:    item.label,
			Count:    item.count,
			Category: "kind",
			Severity: item.severity,
		})
	}
	signalTypes := make([]signalTypeCount, 0, len(byType))
	for _, item := range byType {
		signalTypes = append(signalTypes, item)
	}
	sort.Slice(signalTypes, func(i, j int) bool {
		if si, sj := dashboardSignalSeverityPriority(signalTypes[i].severity), dashboardSignalSeverityPriority(signalTypes[j].severity); si != sj {
			return si < sj
		}
		if pi, pj := signalTypes[i].priority, signalTypes[j].priority; pi != pj {
			return pi < pj
		}
		return signalTypes[i].id < signalTypes[j].id
	})
	for _, item := range signalTypes {
		if item.count <= 0 {
			continue
		}
		filters = append(filters, ClusterDashboardSignalFilter{
			ID:       item.id,
			Label:    dashboardSignalTypeLabel(strings.TrimPrefix(item.id, "signal:")),
			Count:    item.count,
			Category: "signal_type",
			Severity: item.severity,
		})
	}
	namespaces := countedFiltersFromMap(namespaceFilters)
	sort.Slice(namespaces, func(i, j int) bool {
		if si, sj := dashboardSignalSeverityPriority(namespaces[i].severity), dashboardSignalSeverityPriority(namespaces[j].severity); si != sj {
			return si < sj
		}
		if namespaces[i].count != namespaces[j].count {
			return namespaces[i].count > namespaces[j].count
		}
		return namespaces[i].label < namespaces[j].label
	})
	if len(namespaces) > 5 {
		namespaces = namespaces[:5]
	}
	for _, item := range namespaces {
		filters = append(filters, ClusterDashboardSignalFilter{
			ID:       item.id,
			Label:    item.label,
			Count:    item.count,
			Category: "namespace",
			Severity: item.severity,
		})
	}
	filters = appendRequestedNamespaceFilters(filters, "namespace_favourite", "namespace_favourite:all", "All", opts.SignalsFavouriteNamespaces, namespaceFilters)
	filters = appendRequestedNamespaceFilters(filters, "namespace_recent", "namespace_recent:all", "All", opts.SignalsRecentNamespaces, namespaceFilters)
	return filters
}

func summarizeDashboardSignalCounts(signals []ClusterDashboardSignal) ClusterDashboardSignalsPanel {
	out := ClusterDashboardSignalsPanel{Total: len(signals)}
	for _, f := range signals {
		switch f.Severity {
		case "high":
			out.High++
		case "medium":
			out.Medium++
		default:
			out.Low++
		}
		out.incrementSignalCounter(dashboardSignalDefinitionForType(f.SignalType).SummaryCounter)
	}
	return out
}

func appendRequestedNamespaceFilters(filters []ClusterDashboardSignalFilter, category, allID, allLabel string, namespaces []string, counted map[string]dashboardCountedFilter) []ClusterDashboardSignalFilter {
	seen := map[string]struct{}{}
	all := dashboardCountedFilter{id: allID, label: allLabel}
	group := make([]ClusterDashboardSignalFilter, 0, len(namespaces)+1)
	for _, namespace := range namespaces {
		namespace = strings.TrimSpace(namespace)
		if namespace == "" {
			continue
		}
		id := "namespace:" + namespace
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		item := counted[id]
		all.count += item.count
		all.severity = worstSignalSeverity(all.severity, item.severity)
		group = append(group, ClusterDashboardSignalFilter{
			ID:       id,
			Label:    namespace,
			Count:    item.count,
			Category: category,
			Severity: item.severity,
		})
	}
	if len(seen) > 0 {
		filters = append(filters, ClusterDashboardSignalFilter{
			ID:       all.id,
			Label:    all.label,
			Count:    all.count,
			Category: category,
			Severity: all.severity,
		})
		filters = append(filters, group...)
	}
	return filters
}

func dashboardSignalTagFilters(signals []ClusterDashboardSignal, opts ClusterDashboardListOptions) []ClusterDashboardSignalFilter {
	if !opts.ResourceTags.Enabled || len(opts.ResourceTags.Definitions) == 0 {
		return nil
	}
	counts := map[string]int{}
	for _, signal := range signals {
		for _, tagID := range dashboardSignalTagIDs(signal, opts.ResourceTags) {
			counts[tagID]++
		}
	}
	out := make([]ClusterDashboardSignalFilter, 0, len(opts.ResourceTags.Definitions))
	for _, tag := range opts.ResourceTags.Definitions {
		id := strings.TrimSpace(tag.ID)
		if id == "" {
			continue
		}
		label := strings.TrimSpace(tag.Name)
		if label == "" {
			label = id
		}
		out = append(out, ClusterDashboardSignalFilter{
			ID:       "tag:" + id,
			Label:    label,
			Count:    counts[id],
			Category: "tag",
			Color:    strings.TrimSpace(tag.Color),
		})
	}
	return out
}

func dashboardSignalTagIDs(signal ClusterDashboardSignal, tags ClusterDashboardResourceTagsOptions) []string {
	if !tags.Enabled {
		return nil
	}
	target, ok := dashboardSignalResourceTagTarget(signal)
	if !ok {
		return nil
	}
	allowed := map[string]struct{}{}
	for _, tag := range tags.Definitions {
		id := strings.TrimSpace(tag.ID)
		if id != "" {
			allowed[id] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	directIDs := tags.Assignments[dashboardResourceTagTargetKey(target, tags.Context)]
	autoIDs := dashboardAutoTagIDsForTarget(target, signal.Labels, signal.Annotations, tags, allowed)
	inheritedIDs := []string(nil)
	if tags.InheritNamespaceTags && target.resource != "namespaces" && target.namespace != "" {
		namespaceTarget := dashboardResourceTagTarget{
			resource: "namespaces",
			name:     target.namespace,
		}
		inheritedIDs = append(inheritedIDs, tags.Assignments[dashboardResourceTagTargetKey(namespaceTarget, tags.Context)]...)
		inheritedIDs = append(inheritedIDs, dashboardAutoTagIDsForTarget(namespaceTarget, nil, nil, tags, allowed)...)
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, id := range append(append(append([]string{}, directIDs...), autoIDs...), inheritedIDs...) {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := allowed[id]; !ok {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func dashboardAutoTagIDsForTarget(target dashboardResourceTagTarget, labels, annotations map[string]string, tags ClusterDashboardResourceTagsOptions, allowed map[string]struct{}) []string {
	if len(tags.AutoTagRules) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, rule := range tags.AutoTagRules {
		if !dashboardAutoTagRuleMatches(target, labels, annotations, rule, tags.Context) {
			continue
		}
		for _, id := range rule.TagIDs {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, ok := allowed[id]; !ok {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

func dashboardAutoTagRuleMatches(target dashboardResourceTagTarget, labels, annotations map[string]string, rule ClusterDashboardResourceAutoTagRule, activeContext string) bool {
	if !rule.Enabled {
		return false
	}
	if context := strings.TrimSpace(rule.Context); context != "" && context != activeContext {
		return false
	}
	if len(rule.Resources) > 0 {
		matchesResource := false
		for _, resource := range rule.Resources {
			if strings.TrimSpace(resource) == target.resource {
				matchesResource = true
				break
			}
		}
		if !matchesResource {
			return false
		}
	}
	pattern := strings.TrimSpace(rule.Pattern)
	if pattern == "" {
		return false
	}
	re, err := regexp.Compile(dashboardAutoTagRegexPattern(pattern, rule.Flags))
	if err != nil {
		return false
	}
	source := strings.TrimSpace(rule.Source)
	if source == "" {
		source = "name"
	}
	switch source {
	case "name":
		return re.MatchString(target.name)
	case "label":
		return dashboardAutoTagMapMatches(labels, strings.TrimSpace(rule.Key), re)
	case "annotation":
		return dashboardAutoTagMapMatches(annotations, strings.TrimSpace(rule.Key), re)
	default:
		return false
	}
}

func dashboardAutoTagRegexPattern(pattern, flags string) string {
	prefix := ""
	if strings.Contains(flags, "i") {
		prefix += "i"
	}
	if strings.Contains(flags, "m") {
		prefix += "m"
	}
	if strings.Contains(flags, "s") {
		prefix += "s"
	}
	if prefix == "" {
		return pattern
	}
	return "(?" + prefix + ")" + pattern
}

func dashboardAutoTagMapMatches(values map[string]string, key string, re *regexp.Regexp) bool {
	if len(values) == 0 {
		return false
	}
	if key != "" {
		return re.MatchString(values[key])
	}
	for _, value := range values {
		if re.MatchString(value) {
			return true
		}
	}
	return false
}

type dashboardResourceTagTarget struct {
	resource  string
	namespace string
	name      string
}

func dashboardSignalResourceTagTarget(signal ClusterDashboardSignal) (dashboardResourceTagTarget, bool) {
	kind := signal.ResourceKind
	if kind == "" {
		kind = signal.Kind
	}
	resource, ok := dashboardSignalKindResourceKey(kind)
	if !ok {
		return dashboardResourceTagTarget{}, false
	}
	name := signal.ResourceName
	if name == "" {
		name = signal.Name
	}
	if kind == "Namespace" && name == "" {
		name = signal.Namespace
	}
	if name == "" {
		return dashboardResourceTagTarget{}, false
	}
	namespace := ""
	if !dashboardResourceTagClusterScoped(resource) {
		namespace = signal.Namespace
		if namespace == "" {
			return dashboardResourceTagTarget{}, false
		}
	}
	return dashboardResourceTagTarget{resource: resource, namespace: namespace, name: name}, true
}

func dashboardSignalKindResourceKey(kind string) (string, bool) {
	switch kind {
	case "Namespace":
		return "namespaces", true
	case "Pod":
		return "pods", true
	case "Deployment":
		return "deployments", true
	case "DaemonSet":
		return "daemonsets", true
	case "StatefulSet":
		return "statefulsets", true
	case "ReplicaSet":
		return "replicasets", true
	case "Service":
		return "services", true
	case "Ingress":
		return "ingresses", true
	case "Job":
		return "jobs", true
	case "CronJob":
		return "cronjobs", true
	case "HorizontalPodAutoscaler":
		return "horizontalpodautoscalers", true
	case "ConfigMap":
		return "configmaps", true
	case "Secret":
		return "secrets", true
	case "ServiceAccount":
		return "serviceaccounts", true
	case "Role":
		return "roles", true
	case "RoleBinding":
		return "rolebindings", true
	case "ClusterRole":
		return "clusterroles", true
	case "ClusterRoleBinding":
		return "clusterrolebindings", true
	case "PersistentVolumeClaim":
		return "persistentvolumeclaims", true
	case "PersistentVolume":
		return "persistentvolumes", true
	case "Node":
		return "nodes", true
	case "HelmRelease":
		return "helm", true
	case "ResourceQuota":
		return "resourcequotas", true
	case "LimitRange":
		return "limitranges", true
	default:
		return "", false
	}
}

func dashboardResourceTagClusterScoped(resource string) bool {
	switch resource {
	case "clusterroles", "clusterrolebindings", "persistentvolumes", "nodes", "namespaces", "customresourcedefinitions", "clusterresources", "helmcharts":
		return true
	default:
		return false
	}
}

func dashboardResourceTagTargetKey(target dashboardResourceTagTarget, context string) string {
	return dashboardResourceTagKeyPart(context) + "/" +
		dashboardResourceTagKeyPart(target.resource) + "/" +
		dashboardResourceTagKeyPart(target.namespace) + "/" +
		dashboardResourceTagKeyPart(target.name)
}

func dashboardResourceTagKeyPart(value string) string {
	return url.PathEscape(strings.TrimSpace(value))
}

type dashboardCountedFilter struct {
	id       string
	label    string
	count    int
	severity string
	priority int
}

func countedFiltersFromMap(items map[string]dashboardCountedFilter) []dashboardCountedFilter {
	out := make([]dashboardCountedFilter, 0, len(items))
	for _, item := range items {
		if item.count > 0 {
			out = append(out, item)
		}
	}
	return out
}

func worstSignalSeverity(a, b string) string {
	if a == "" {
		return b
	}
	if dashboardSignalSeverityPriority(b) < dashboardSignalSeverityPriority(a) {
		return b
	}
	return a
}

func dashboardSignalTypeLabel(signalType string) string {
	return dashboardSignalDefinitionForType(signalType).Label
}

func normalizeClusterDashboardListOptions(opts ClusterDashboardListOptions) ClusterDashboardListOptions {
	opts.SignalsFilter = strings.TrimSpace(opts.SignalsFilter)
	opts.SignalsFilters = normalizeDashboardSignalFilters(opts.SignalsFilter)
	if !opts.SignalsCombined && len(opts.SignalsFilters) > 1 {
		opts.SignalsFilters = opts.SignalsFilters[:1]
		opts.SignalsFilter = opts.SignalsFilters[0]
	}
	if len(opts.SignalsFilters) == 0 {
		opts.SignalsFilter = ""
	} else {
		opts.SignalsFilter = strings.Join(opts.SignalsFilters, ",")
	}
	opts.SignalsQuery = strings.TrimSpace(opts.SignalsQuery)
	opts.SignalsSort = strings.TrimSpace(opts.SignalsSort)
	opts.SignalsOffset = normalizeDashboardOffset(opts.SignalsOffset)
	opts.SignalsLimit = normalizeDashboardLimit(opts.SignalsLimit)
	opts.NewestSignalLimit = normalizeDashboardNewestLimit(opts.NewestSignalLimit)
	return opts
}

func normalizeDashboardSignalFilters(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		filter := strings.TrimSpace(part)
		if filter == "" {
			continue
		}
		if filter == "top" && len(out) > 0 {
			continue
		}
		if _, ok := seen[filter]; ok {
			continue
		}
		seen[filter] = struct{}{}
		out = append(out, filter)
	}
	return out
}

func normalizeDashboardOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

func normalizeDashboardLimit(limit int) int {
	switch {
	case limit <= 0:
		return 25
	case limit > 100:
		return 100
	default:
		return limit
	}
}

func normalizeDashboardNewestLimit(limit int) int {
	switch {
	case limit <= 0:
		return 10
	case limit > 100:
		return 100
	default:
		return limit
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func filterDashboardSignals(signals []ClusterDashboardSignal, filters []string, query string, opts ClusterDashboardListOptions) []ClusterDashboardSignal {
	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]ClusterDashboardSignal, 0, len(signals))
	for _, f := range signals {
		if !dashboardSignalMatchesFilters(f, filters, opts) {
			continue
		}
		if query != "" && !dashboardSignalMatchesQuery(f, query) {
			continue
		}
		out = append(out, f)
	}
	if dashboardSignalHasFilter(filters, "newest") && len(out) > 1 {
		sort.Slice(out, func(i, j int) bool {
			if out[i].FirstSeenAt != out[j].FirstSeenAt {
				return out[i].FirstSeenAt > out[j].FirstSeenAt
			}
			return dashboardSignalLess(out[i], out[j])
		})
		if len(out) > opts.NewestSignalLimit {
			out = out[:opts.NewestSignalLimit]
		}
	}
	return out
}

func dashboardSignalHasFilter(filters []string, target string) bool {
	for _, filter := range filters {
		if strings.TrimSpace(filter) == target {
			return true
		}
	}
	return false
}

func dashboardSignalMatchesFilters(f ClusterDashboardSignal, filters []string, opts ClusterDashboardListOptions) bool {
	favouriteNamespaces := dashboardNamespaceSet(opts.SignalsFavouriteNamespaces)
	recentNamespaces := dashboardNamespaceSet(opts.SignalsRecentNamespaces)
	for _, filter := range filters {
		filter = strings.TrimSpace(filter)
		if filter == "" || filter == "top" {
			continue
		}
		if filter == "newest" {
			continue
		}
		if filter == "high" || filter == "medium" || filter == "low" {
			if f.Severity != filter {
				return false
			}
		} else if filter == "open" {
			if f.Acknowledged {
				return false
			}
		} else if filter == "acknowledged" {
			if !f.Acknowledged {
				return false
			}
		} else if strings.HasPrefix(filter, "kind:") {
			if f.Kind != strings.TrimPrefix(filter, "kind:") {
				return false
			}
		} else if strings.HasPrefix(filter, "signal:") {
			if f.SignalType != strings.TrimPrefix(filter, "signal:") {
				return false
			}
		} else if strings.HasPrefix(filter, "namespace:") {
			if f.Namespace != strings.TrimPrefix(filter, "namespace:") {
				return false
			}
		} else if filter == "namespace_favourite:all" {
			if _, ok := favouriteNamespaces[f.Namespace]; !ok {
				return false
			}
		} else if filter == "namespace_recent:all" {
			if _, ok := recentNamespaces[f.Namespace]; !ok {
				return false
			}
		} else if strings.HasPrefix(filter, "tag:") {
			if !dashboardSignalHasTag(f, strings.TrimPrefix(filter, "tag:"), opts.ResourceTags) {
				return false
			}
		} else if f.SignalType != filter && f.Kind != filter {
			return false
		}
	}
	return true
}

func dashboardSignalHasTag(signal ClusterDashboardSignal, tagID string, tags ClusterDashboardResourceTagsOptions) bool {
	tagID = strings.TrimSpace(tagID)
	if tagID == "" {
		return false
	}
	for _, id := range dashboardSignalTagIDs(signal, tags) {
		if id == tagID {
			return true
		}
	}
	return false
}

func dashboardNamespaceSet(namespaces []string) map[string]struct{} {
	out := make(map[string]struct{}, len(namespaces))
	for _, namespace := range namespaces {
		namespace = strings.TrimSpace(namespace)
		if namespace != "" {
			out[namespace] = struct{}{}
		}
	}
	return out
}

func dashboardSignalMatchesQuery(f ClusterDashboardSignal, query string) bool {
	fields := []string{
		f.Kind, f.Namespace, f.Name, f.Severity, f.Reason, f.LikelyCause, f.SuggestedAction, f.Confidence, f.Section,
		f.SignalType, f.ResourceKind, f.ResourceName, f.Scope, f.ScopeLocation, f.ActualData, f.CalculatedData,
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func paginateDashboardSignals(items []ClusterDashboardSignal, offset, limit int) []ClusterDashboardSignal {
	if offset >= len(items) {
		return nil
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}

func dashboardSignalSeverityPriority(severity string) int {
	switch severity {
	case "high":
		return 0
	case "medium":
		return 1
	default:
		return 2
	}
}

func dashboardSignalKindPriority(kind string) int {
	switch kind {
	case "HelmRelease":
		return 0
	case "Deployment":
		return 1
	case "DaemonSet", "StatefulSet", "ReplicaSet":
		return 2
	case "Pod":
		return 3
	case "ResourceQuota":
		return 4
	case "Job", "CronJob", "HorizontalPodAutoscaler":
		return 5
	case "PersistentVolumeClaim", "Service", "Ingress":
		return 6
	case "ServiceAccount", "Role", "RoleBinding":
		return 7
	case "ConfigMap", "Secret":
		return 8
	case "Namespace":
		return 9
	default:
		return 10
	}
}

func dashboardSignalTypePriority(signalType string) int {
	return dashboardSignalDefinitionForType(signalType).Priority
}

func dashboardSignalPriority(signal ClusterDashboardSignal) int {
	if signal.SignalPriority > 0 {
		return signal.SignalPriority
	}
	return dashboardSignalTypePriority(signal.SignalType)
}

func visibleNamespacesWithCachedDataplaneLists(plane *clusterPlane, visibleSorted []string) []string {
	if plane == nil || len(visibleSorted) == 0 {
		return nil
	}
	out := make([]string, 0, len(visibleSorted))
	for _, ns := range visibleSorted {
		if namespaceHasCachedDataplaneList(plane, ns) {
			out = append(out, ns)
		}
	}
	return out
}

func namespaceHasCachedDataplaneList(plane *clusterPlane, ns string) bool {
	if _, ok := plane.podsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.depsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.dsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.stsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.rsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.jobsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.cjStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.hpaStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.svcsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.ingStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.pvcsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.cmsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.secsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.saStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.rolesStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.roleBindingsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.helmReleasesStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.customResourcesStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.rqStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.lrStore.getCached(ns); ok {
		return true
	}
	return false
}

func visibleNamespacesWithCachedRowProjection(plane *clusterPlane, visibleSorted []string) []string {
	if plane == nil || len(visibleSorted) == 0 {
		return nil
	}
	out := make([]string, 0, len(visibleSorted))
	for _, ns := range visibleSorted {
		if namespaceHasCachedRowProjection(plane, ns) {
			out = append(out, ns)
		}
	}
	return out
}

func namespaceHasCachedRowProjection(plane *clusterPlane, ns string) bool {
	if _, ok := plane.podsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.depsStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.customResourcesStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.rqStore.getCached(ns); ok {
		return true
	}
	if _, ok := plane.lrStore.getCached(ns); ok {
		return true
	}
	return false
}

func (m *manager) buildDashboardCoverage(cluster string, visibleSorted []string, visibleCount int) ClusterDashboardCoverage {
	cov := ClusterDashboardCoverage{
		VisibleNamespaces: visibleCount,
	}
	if visibleCount == 0 {
		cov.ListOnlyNamespaces = 0
		cov.Note = "No namespace list snapshot."
		return cov
	}

	var plane *clusterPlane
	if planeAny, err := m.PlaneForCluster(context.Background(), cluster); err == nil {
		plane, _ = planeAny.(*clusterPlane)
	}
	rowProjectionCached := visibleNamespacesWithCachedRowProjection(plane, visibleSorted)
	rowProjectionCachedSet := make(map[string]struct{}, len(rowProjectionCached))
	for _, ns := range rowProjectionCached {
		rowProjectionCachedSet[ns] = struct{}{}
	}
	cov.RowProjectionCachedNamespaces = len(rowProjectionCached)
	cov.RelatedEnrichedNamespaces = len(rowProjectionCached)
	cov.ListOnlyNamespaces = visibleCount - len(rowProjectionCached)
	if cov.ListOnlyNamespaces < 0 {
		cov.ListOnlyNamespaces = 0
	}

	m.nsEnrich.mu.Lock()
	sess, ok := m.nsEnrich.byCluster[cluster]
	m.nsEnrich.mu.Unlock()
	if !ok || sess == nil {
		cov.Note = "No active namespace row-enrichment session; row projection coverage is derived from cached pod/deployment snapshots."
		return cov
	}

	sess.mu.Lock()
	workSet := make(map[string]struct{}, len(sess.workNames)+len(sess.sweepNames))
	for _, n := range sess.workNames {
		workSet[n] = struct{}{}
	}
	for _, n := range sess.sweepNames {
		workSet[n] = struct{}{}
	}
	detailDone := sess.detailDone
	sess.mu.Unlock()

	cov.HasActiveEnrichmentSession = true
	cov.EnrichmentTargets = len(workSet)
	cov.DetailEnrichedNamespaces = detailDone
	if detailDone > cov.EnrichmentTargets {
		cov.DetailEnrichedNamespaces = cov.EnrichmentTargets
	}
	awaiting := 0
	for name := range workSet {
		if _, ok := rowProjectionCachedSet[name]; !ok {
			awaiting++
		}
	}
	cov.AwaitingRelatedRowProjection = awaiting
	return cov
}
