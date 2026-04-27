package dataplane

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
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

// aggregateClusterDashboard rolls up workload totals and signals only from namespaces that already
// have cached dataplane list snapshots (typically from visiting those namespaces or row enrichment),
// intersected with the current namespace list snapshot. No alphabetical sampling and no implicit cluster-wide totals.
func (m *manager) aggregateClusterDashboard(plane *clusterPlane, nsNamesSorted []string, nsTotal int, nodesSnap NodesSnapshot, nodeState string, opts ClusterDashboardListOptions) (ClusterDashboardResourcesPanel, ClusterDashboardSignalsPanel, ClusterDashboardDerivedPanel, ClusterDashboardCoverage) {
	opts = normalizeClusterDashboardListOptions(opts)
	cov := m.buildDashboardCoverage(plane.name, nsNamesSorted, nsTotal)
	p := m.EffectivePolicy(plane.name)
	policy := p.Dashboard
	thresholds := signalThresholdsFromPolicy(p)

	knownNS := visibleNamespacesWithCachedDataplaneLists(plane, nsNamesSorted)
	cov.NamespacesInResourceTotals = len(knownNS)
	cov.ResourceTotalsCompleteness = resourceTotalsCompletenessLabel(nsTotal, len(knownNS))
	derived := buildDerivedDashboardProjections(plane, knownNS, thresholds.PodRestartCount, nodesSnap, nodeState)

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

	for _, ns := range knownNS {
		s := buildSnapshotSetForNamespace(plane, ns, thresholds)
		if s.podsOK {
			res.Pods += len(s.pods.Items)
			aggregateMetas = append(aggregateMetas, s.pods.Meta)
		}
		if s.depsOK {
			res.Deployments += len(s.deps.Items)
		}
		if s.dsOK {
			res.DaemonSets += len(s.ds.Items)
			aggregateMetas = append(aggregateMetas, s.ds.Meta)
		}
		if s.stsOK {
			res.StatefulSets += len(s.sts.Items)
			aggregateMetas = append(aggregateMetas, s.sts.Meta)
		}
		if s.rsOK {
			res.ReplicaSets += len(s.rs.Items)
			aggregateMetas = append(aggregateMetas, s.rs.Meta)
		}
		if s.jobsOK {
			res.Jobs += len(s.jobs.Items)
			aggregateMetas = append(aggregateMetas, s.jobs.Meta)
		}
		if s.cjsOK {
			res.CronJobs += len(s.cjs.Items)
			aggregateMetas = append(aggregateMetas, s.cjs.Meta)
		}
		if s.hpasOK {
			res.HorizontalPodAutoscalers += len(s.hpas.Items)
			aggregateMetas = append(aggregateMetas, s.hpas.Meta)
		}
		if s.svcsOK {
			res.Services += len(s.svcs.Items)
			aggregateMetas = append(aggregateMetas, s.svcs.Meta)
		}
		if s.ingsOK {
			res.Ingresses += len(s.ings.Items)
			aggregateMetas = append(aggregateMetas, s.ings.Meta)
		}
		if s.pvcsOK {
			res.PersistentVolumeClaims += len(s.pvcs.Items)
			aggregateMetas = append(aggregateMetas, s.pvcs.Meta)
		}
		if s.cmsOK {
			res.ConfigMaps += len(s.cms.Items)
			aggregateMetas = append(aggregateMetas, s.cms.Meta)
		}
		if s.secsOK {
			res.Secrets += len(s.secs.Items)
			aggregateMetas = append(aggregateMetas, s.secs.Meta)
		}
		if s.sasOK {
			res.ServiceAccounts += len(s.sas.Items)
			aggregateMetas = append(aggregateMetas, s.sas.Meta)
		}
		if s.rolesOK {
			res.Roles += len(s.roles.Items)
			aggregateMetas = append(aggregateMetas, s.roles.Meta)
		}
		if s.roleBindingsOK {
			res.RoleBindings += len(s.roleBindings.Items)
			aggregateMetas = append(aggregateMetas, s.roleBindings.Meta)
		}
		if s.helmOK {
			res.HelmReleases += len(s.helmReleases.Items)
			aggregateMetas = append(aggregateMetas, s.helmReleases.Meta)
		}
		if s.quotasOK {
			res.ResourceQuotas += len(s.resourceQuotas.Items)
			aggregateMetas = append(aggregateMetas, s.resourceQuotas.Meta)
		}
		if s.limitRangesOK {
			res.LimitRanges += len(s.limitRanges.Items)
			aggregateMetas = append(aggregateMetas, s.limitRanges.Meta)
		}
		signals.Add(m.attachSignalHistory(plane.name, now, applySignalPolicy(detectDashboardSignals(now, ns, s), p, plane.name)...)...)
	}
	signals.Add(m.attachSignalHistory(plane.name, now, applySignalPolicy(detectNodeResourcePressureSignals(now, plane, nodesSnap, thresholds.NodeResourcePressurePct), p, plane.name)...)...)

	if len(aggregateMetas) > 0 {
		wf := string(WorstFreshnessFromSnapshots(aggregateMetas...))
		wd := string(WorstDegradationFromSnapshots(aggregateMetas...))
		res.AggregateFreshness = wf
		res.AggregateDegradation = wd
		signalPanel.AggregateFreshness = wf
		signalPanel.AggregateDegradation = wd
	}
	signalNote := signalPanel.Note
	signalPanel = signals.Summary(policy.SignalLimit, opts)
	signalPanel.Note = signalNote
	signalPanel.AggregateFreshness = res.AggregateFreshness
	signalPanel.AggregateDegradation = res.AggregateDegradation

	return res, signalPanel, derived, cov
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
	cmSnap, cmOK := plane.cmsStore.getCached(ns)
	secSnap, secOK := plane.secsStore.getCached(ns)
	saSnap, saOK := plane.saStore.getCached(ns)
	rolesSnap, rolesOK := plane.rolesStore.getCached(ns)
	roleBindingsSnap, roleBindingsOK := plane.roleBindingsStore.getCached(ns)
	helmReleasesSnap, helmReleasesOK := plane.helmReleasesStore.getCached(ns)
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

	pods           PodsSnapshot
	podsOK         bool
	deps           DeploymentsSnapshot
	depsOK         bool
	ds             DaemonSetsSnapshot
	dsOK           bool
	sts            StatefulSetsSnapshot
	stsOK          bool
	rs             ReplicaSetsSnapshot
	rsOK           bool
	jobs           JobsSnapshot
	jobsOK         bool
	cjs            CronJobsSnapshot
	cjsOK          bool
	hpas           HPAsSnapshot
	hpasOK         bool
	svcs           ServicesSnapshot
	svcsOK         bool
	ings           IngressesSnapshot
	ingsOK         bool
	pvcs           PVCsSnapshot
	pvcsOK         bool
	cms            ConfigMapsSnapshot
	cmsOK          bool
	secs           SecretsSnapshot
	secsOK         bool
	sas            ServiceAccountsSnapshot
	sasOK          bool
	roles          RolesSnapshot
	rolesOK        bool
	roleBindings   RoleBindingsSnapshot
	roleBindingsOK bool
	helmReleases   HelmReleasesSnapshot
	helmOK         bool
	resourceQuotas ResourceQuotasSnapshot
	quotasOK       bool
	limitRanges    LimitRangesSnapshot
	limitRangesOK  bool
	podMetrics     PodMetricsSnapshot
	podMetricsOK   bool
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
	return out
}

func dashboardSignalItem(signalType, kind, namespace, name, severity string, score int, reason, confidence, section string) ClusterDashboardSignal {
	def := dashboardSignalDefinitionForType(signalType)
	if def.ActualData == "" {
		def.ActualData = reason
	}
	if def.CalculatedData == "" {
		def.CalculatedData = reason
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
		ActualData:      def.ActualData,
		CalculatedData:  def.CalculatedData,
	}
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
	out.Filters = buildDashboardSignalFilters(signals, len(out.Top), out)
	pageSource := filterDashboardSignals(signals, opts.SignalsFilter, opts.SignalsQuery)
	if opts.SignalsFilter == "" || opts.SignalsFilter == "top" {
		if len(pageSource) > limit {
			pageSource = pageSource[:limit]
		}
	}
	out.ItemsTotal = len(pageSource)
	out.ItemsOffset = opts.SignalsOffset
	out.ItemsLimit = opts.SignalsLimit
	out.ItemsFilter = opts.SignalsFilter
	out.ItemsQuery = opts.SignalsQuery
	out.ItemsSort = opts.SignalsSort
	sortDashboardSignalsForItems(pageSource, opts.SignalsSort)
	out.Items = append(out.Items, paginateDashboardSignals(pageSource, opts.SignalsOffset, opts.SignalsLimit)...)
	out.ItemsHasMore = out.ItemsOffset+len(out.Items) < out.ItemsTotal
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

func buildDashboardSignalFilters(signals []ClusterDashboardSignal, topCount int, summary ClusterDashboardSignalsPanel) []ClusterDashboardSignalFilter {
	filters := []ClusterDashboardSignalFilter{
		{ID: "top", Label: "Top priority", Count: topCount, Category: "priority"},
		{ID: "high", Label: "High severity", Count: summary.High, Category: "severity", Severity: "high"},
		{ID: "medium", Label: "Medium severity", Count: summary.Medium, Category: "severity", Severity: "medium"},
		{ID: "low", Label: "Low severity", Count: summary.Low, Category: "severity", Severity: "low"},
	}

	kindFilters := map[string]dashboardCountedFilter{}
	namespaceFilters := map[string]dashboardCountedFilter{}
	type signalTypeCount struct {
		id       string
		count    int
		severity string
		priority int
	}
	byType := map[string]signalTypeCount{}
	for _, signal := range signals {
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
	return filters
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
	opts.SignalsQuery = strings.TrimSpace(opts.SignalsQuery)
	opts.SignalsSort = strings.TrimSpace(opts.SignalsSort)
	opts.SignalsOffset = normalizeDashboardOffset(opts.SignalsOffset)
	opts.SignalsLimit = normalizeDashboardLimit(opts.SignalsLimit)
	return opts
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

func filterDashboardSignals(signals []ClusterDashboardSignal, filter, query string) []ClusterDashboardSignal {
	filter = strings.TrimSpace(filter)
	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]ClusterDashboardSignal, 0, len(signals))
	for _, f := range signals {
		if filter != "" && filter != "top" {
			if filter == "high" || filter == "medium" || filter == "low" {
				if f.Severity != filter {
					continue
				}
			} else if strings.HasPrefix(filter, "kind:") {
				if f.Kind != strings.TrimPrefix(filter, "kind:") {
					continue
				}
			} else if strings.HasPrefix(filter, "signal:") {
				if f.SignalType != strings.TrimPrefix(filter, "signal:") {
					continue
				}
			} else if strings.HasPrefix(filter, "namespace:") {
				if f.Namespace != strings.TrimPrefix(filter, "namespace:") {
					continue
				}
			} else if f.SignalType == filter {
				// keep
			} else if f.Kind != filter {
				continue
			}
		}
		if query != "" && !dashboardSignalMatchesQuery(f, query) {
			continue
		}
		out = append(out, f)
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
