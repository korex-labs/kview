package dataplane

import (
	"context"
	"sort"
	"strings"
	"time"

	"kview/internal/kube/dto"
)

// ClusterDashboardSummary is a bounded Stage 5C operator overview derived from dataplane snapshots.
type ClusterDashboardSummary struct {
	Plane         ClusterDashboardPlane           `json:"plane"`
	Visibility    ClusterDashboardVisibilityPanel `json:"visibility"`
	Coverage      ClusterDashboardCoverage        `json:"coverage"`
	Resources     ClusterDashboardResourcesPanel  `json:"resources"`
	Hotspots      ClusterDashboardHotspotsPanel   `json:"hotspots"`
	Findings      ClusterDashboardFindingsPanel   `json:"findings"`
	Derived       ClusterDashboardDerivedPanel    `json:"derived"`
	WorkloadHints ClusterDashboardWorkloadHints   `json:"workloadHints"`
	Dataplane     ClusterDashboardDataplaneStats  `json:"dataplane"`
}

type ClusterDashboardPlane struct {
	Profile              string                     `json:"profile"`
	DiscoveryMode        string                     `json:"discoveryMode"`
	ActivationMode       string                     `json:"activationMode"`
	ProfilesImplemented  []string                   `json:"profilesImplemented"`
	DiscoveryImplemented []string                   `json:"discoveryImplemented"`
	Scope                ClusterDashboardPlaneScope `json:"scope"`
}

type ClusterDashboardPlaneScope struct {
	Namespaces    string `json:"namespaces"`
	ResourceKinds string `json:"resourceKinds"`
}

type ClusterDashboardNamespaces struct {
	Total         int    `json:"total"`
	Unhealthy     int    `json:"unhealthy"`
	Freshness     string `json:"freshness"`
	Coverage      string `json:"coverage"`
	Degradation   string `json:"degradation"`
	Completeness  string `json:"completeness"`
	State         string `json:"state"`
	ObserverState string `json:"observerState"`
}

type ClusterDashboardNodes struct {
	Total         int    `json:"total"`
	Freshness     string `json:"freshness"`
	Coverage      string `json:"coverage"`
	Degradation   string `json:"degradation"`
	Completeness  string `json:"completeness"`
	State         string `json:"state"`
	ObserverState string `json:"observerState"`
}

// ClusterDashboardVisibilityPanel groups namespace/node observation with snapshot timestamps.
type ClusterDashboardVisibilityPanel struct {
	Namespaces           ClusterDashboardNamespaces `json:"namespaces"`
	Nodes                ClusterDashboardNodes      `json:"nodes"`
	NamespacesObservedAt string                     `json:"namespacesObservedAt,omitempty"`
	NodesObservedAt      string                     `json:"nodesObservedAt,omitempty"`
	TrustNote            string                     `json:"trustNote,omitempty"`
}

// ClusterDashboardCoverage describes namespace visibility, row-enrichment progress, and workload-total scope.
type ClusterDashboardCoverage struct {
	VisibleNamespaces             int    `json:"visibleNamespaces"`
	ListOnlyNamespaces            int    `json:"listOnlyNamespaces"`
	DetailEnrichedNamespaces      int    `json:"detailEnrichedNamespaces"`
	RelatedEnrichedNamespaces     int    `json:"relatedEnrichedNamespaces"`
	AwaitingRelatedRowProjection  int    `json:"awaitingRelatedRowProjection"`
	EnrichmentTargets             int    `json:"enrichmentTargets,omitempty"`
	HasActiveEnrichmentSession    bool   `json:"hasActiveEnrichmentSession,omitempty"`
	RowProjectionCachedNamespaces int    `json:"rowProjectionCachedNamespaces"`
	ResourceTotalsCompleteness    string `json:"resourceTotalsCompleteness"`
	NamespacesInResourceTotals    int    `json:"namespacesInResourceTotals"`
	ResourceTotalsNote            string `json:"resourceTotalsNote,omitempty"`
	Note                          string `json:"note,omitempty"`
}

// ClusterDashboardResourcesPanel sums workloads only for namespaces with cached dataplane list snapshots.
type ClusterDashboardResourcesPanel struct {
	Pods                   int    `json:"pods"`
	Deployments            int    `json:"deployments"`
	DaemonSets             int    `json:"daemonSets"`
	StatefulSets           int    `json:"statefulSets"`
	ReplicaSets            int    `json:"replicaSets"`
	Jobs                   int    `json:"jobs"`
	CronJobs               int    `json:"cronJobs"`
	Services               int    `json:"services"`
	Ingresses              int    `json:"ingresses"`
	PersistentVolumeClaims int    `json:"persistentVolumeClaims"`
	ConfigMaps             int    `json:"configMaps"`
	Secrets                int    `json:"secrets"`
	ServiceAccounts        int    `json:"serviceAccounts"`
	Roles                  int    `json:"roles"`
	RoleBindings           int    `json:"roleBindings"`
	HelmReleases           int    `json:"helmReleases"`
	ResourceQuotas         int    `json:"resourceQuotas"`
	LimitRanges            int    `json:"limitRanges"`
	TotalNamespaces        int    `json:"totalNamespaces"`
	Note                   string `json:"note,omitempty"`
	AggregateFreshness     string `json:"aggregateFreshness,omitempty"`
	AggregateDegradation   string `json:"aggregateDegradation,omitempty"`
}

// ClusterDashboardProblematicNamespace ranks namespaces by problematic resource count within the cached workload scope.
type ClusterDashboardProblematicNamespace struct {
	Namespace string `json:"namespace"`
	Score     int    `json:"score"`
}

// ClusterDashboardHotspotsPanel is derived from the same cached-namespace scope as Resources.
type ClusterDashboardHotspotsPanel struct {
	UnhealthyNamespaces        int                                    `json:"unhealthyNamespaces"`
	DegradedDeployments        int                                    `json:"degradedDeployments"`
	PodsWithElevatedRestarts   int                                    `json:"podsWithElevatedRestarts"`
	ProblematicResources       int                                    `json:"problematicResources"`
	TopProblematicNamespaces   []ClusterDashboardProblematicNamespace `json:"topProblematicNamespaces,omitempty"`
	TopPodRestartHotspots      []dto.PodRestartHotspotDTO             `json:"topPodRestartHotspots,omitempty"`
	RestartHotspotsTotal       int                                    `json:"restartHotspotsTotal"`
	RestartHotspotsOffset      int                                    `json:"restartHotspotsOffset"`
	RestartHotspotsLimit       int                                    `json:"restartHotspotsLimit"`
	RestartHotspotsQuery       string                                 `json:"restartHotspotsQuery,omitempty"`
	RestartHotspotsHasMore     bool                                   `json:"restartHotspotsHasMore,omitempty"`
	Note                       string                                 `json:"note,omitempty"`
	AggregateFreshness         string                                 `json:"aggregateFreshness,omitempty"`
	AggregateDegradation       string                                 `json:"aggregateDegradation,omitempty"`
	HighSeverityHotspotsInTopN int                                    `json:"highSeverityHotspotsInTopN"`
}

// ClusterDashboardFindingsPanel groups heuristic dataplane findings from cached namespace snapshots.
type ClusterDashboardFindingsPanel struct {
	Total                 int                       `json:"total"`
	High                  int                       `json:"high"`
	Medium                int                       `json:"medium"`
	Low                   int                       `json:"low"`
	EmptyNamespaces       int                       `json:"emptyNamespaces"`
	StuckHelmReleases     int                       `json:"stuckHelmReleases"`
	AbnormalJobs          int                       `json:"abnormalJobs"`
	AbnormalCronJobs      int                       `json:"abnormalCronJobs"`
	EmptyConfigMaps       int                       `json:"emptyConfigMaps"`
	EmptySecrets          int                       `json:"emptySecrets"`
	PotentiallyUnusedPVCs int                       `json:"potentiallyUnusedPVCs"`
	PotentiallyUnusedSAs  int                       `json:"potentiallyUnusedServiceAccounts"`
	QuotaWarnings         int                       `json:"quotaWarnings"`
	ServiceWarnings       int                       `json:"serviceWarnings"`
	IngressWarnings       int                       `json:"ingressWarnings"`
	PVCWarnings           int                       `json:"pvcWarnings"`
	RoleWarnings          int                       `json:"roleWarnings"`
	RoleBindingWarnings   int                       `json:"roleBindingWarnings"`
	Top                   []ClusterDashboardFinding `json:"top,omitempty"`
	Items                 []ClusterDashboardFinding `json:"items,omitempty"`
	ItemsTotal            int                       `json:"itemsTotal"`
	ItemsOffset           int                       `json:"itemsOffset"`
	ItemsLimit            int                       `json:"itemsLimit"`
	ItemsFilter           string                    `json:"itemsFilter,omitempty"`
	ItemsQuery            string                    `json:"itemsQuery,omitempty"`
	ItemsHasMore          bool                      `json:"itemsHasMore,omitempty"`
	Note                  string                    `json:"note,omitempty"`
	AggregateFreshness    string                    `json:"aggregateFreshness,omitempty"`
	AggregateDegradation  string                    `json:"aggregateDegradation,omitempty"`
}

type ClusterDashboardFinding struct {
	Kind            string `json:"kind"`
	Namespace       string `json:"namespace,omitempty"`
	Name            string `json:"name,omitempty"`
	Severity        string `json:"severity"`
	Score           int    `json:"score"`
	Reason          string `json:"reason"`
	LikelyCause     string `json:"likelyCause,omitempty"`
	SuggestedAction string `json:"suggestedAction,omitempty"`
	Confidence      string `json:"confidence,omitempty"`
	Section         string `json:"section,omitempty"`
}

type ClusterDashboardListOptions struct {
	FindingsFilter        string
	FindingsQuery         string
	FindingsOffset        int
	FindingsLimit         int
	RestartHotspotsQuery  string
	RestartHotspotsOffset int
	RestartHotspotsLimit  int
}

// ClusterDashboardWorkloadHints mirrors Hotspots for compact UI chips.
type ClusterDashboardWorkloadHints struct {
	TotalNamespacesVisible      int                        `json:"totalNamespacesVisible"`
	NamespacesWithWorkloadCache int                        `json:"namespacesWithWorkloadCache"`
	TopPodRestartHotspots       []dto.PodRestartHotspotDTO `json:"topPodRestartHotspots,omitempty"`
	PodsWithElevatedRestarts    int                        `json:"podsWithElevatedRestarts"`
	HighSeverityHotspotsInTopN  int                        `json:"highSeverityHotspotsInTopN"`
	AggregateFreshness          string                     `json:"aggregateFreshness,omitempty"`
	AggregateDegradation        string                     `json:"aggregateDegradation,omitempty"`
}

type ClusterDashboardDataplaneStats struct {
	StartedAt string                                  `json:"startedAt,omitempty"`
	UptimeSec int64                                   `json:"uptimeSec"`
	Requests  ClusterDashboardDataplaneRequestStats   `json:"requests"`
	Cache     ClusterDashboardDataplaneCacheStats     `json:"cache"`
	Traffic   ClusterDashboardDataplaneTrafficStats   `json:"traffic"`
	Execution ClusterDashboardDataplaneExecutionStats `json:"execution"`
	Sources   []ClusterDashboardDataplaneSourceStats  `json:"sources,omitempty"`
	Kinds     []ClusterDashboardDataplaneKindStats    `json:"kinds,omitempty"`
}

type ClusterDashboardDataplaneRequestStats struct {
	Total      uint64  `json:"total"`
	FreshHits  uint64  `json:"freshHits"`
	Misses     uint64  `json:"misses"`
	Fetches    uint64  `json:"fetches"`
	Errors     uint64  `json:"errors"`
	HitRatio   float64 `json:"hitRatio"`
	FetchRatio float64 `json:"fetchRatio"`
}

type ClusterDashboardDataplaneCacheStats struct {
	SnapshotsStored     uint64 `json:"snapshotsStored"`
	CurrentBytes        uint64 `json:"currentBytes"`
	AvgBytesPerSnapshot uint64 `json:"avgBytesPerSnapshot"`
}

type ClusterDashboardDataplaneTrafficStats struct {
	LiveBytes        uint64  `json:"liveBytes"`
	HydratedBytes    uint64  `json:"hydratedBytes"`
	AvgBytesPerFetch uint64  `json:"avgBytesPerFetch"`
	RequestsPerMin   float64 `json:"requestsPerMin"`
	LiveBytesPerMin  float64 `json:"liveBytesPerMin"`
}

type ClusterDashboardDataplaneExecutionStats struct {
	Runs        uint64 `json:"runs"`
	AvgRunMs    uint64 `json:"avgRunMs"`
	MaxRunMs    uint64 `json:"maxRunMs"`
	Preemptions uint64 `json:"preemptions"`
}

type ClusterDashboardDataplaneSourceStats struct {
	Source    string `json:"source"`
	Requests  uint64 `json:"requests"`
	FreshHits uint64 `json:"freshHits"`
	Misses    uint64 `json:"misses"`
	Fetches   uint64 `json:"fetches"`
	Errors    uint64 `json:"errors"`
}

type ClusterDashboardDataplaneKindStats struct {
	Kind         string `json:"kind"`
	Fetches      uint64 `json:"fetches"`
	CurrentBytes uint64 `json:"currentBytes"`
	Snapshots    uint64 `json:"snapshots"`
	LiveBytes    uint64 `json:"liveBytes"`
}

// DashboardSummary builds a bounded cluster dashboard from cached snapshots.
func (m *manager) DashboardSummary(ctx context.Context, clusterName string, opts ClusterDashboardListOptions) ClusterDashboardSummary {
	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceDashboard)
	policy := m.Policy()
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	nsSnap, _ := plane.NamespacesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityMedium)
	nodesSnap, _ := plane.NodesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityMedium)

	nsObs := "not_loaded"
	nodeObs := "not_loaded"
	if !policy.Observers.Enabled || !policy.Observers.NamespacesEnabled {
		nsObs = "disabled"
	}
	if !policy.Observers.Enabled || !policy.Observers.NodesEnabled {
		nodeObs = "disabled"
	}
	plane.obsMu.Lock()
	if plane.observers != nil {
		if policy.Observers.Enabled && policy.Observers.NamespacesEnabled && plane.observers.namespacesState != "" {
			nsObs = string(plane.observers.namespacesState)
		}
		if policy.Observers.Enabled && policy.Observers.NodesEnabled && plane.observers.nodesState != "" {
			nodeObs = string(plane.observers.nodesState)
		}
	}
	plane.obsMu.Unlock()

	var nsTotal, nsUnhealthy int
	nsNames := make([]string, 0, len(nsSnap.Items))
	for _, ns := range nsSnap.Items {
		nsTotal++
		nsNames = append(nsNames, ns.Name)
		if ns.HasUnhealthyConditions {
			nsUnhealthy++
		}
	}
	sort.Strings(nsNames)

	nsState := CoarseState(nsSnap.Err, nsTotal)
	nodeTotal := len(nodesSnap.Items)
	nodeState := CoarseState(nodesSnap.Err, nodeTotal)

	scope := plane.Scope()
	namespaceScope := "all_namespaces"
	if len(scope.Namespaces) > 0 {
		namespaceScope = strings.Join(scope.Namespaces, ",")
	}
	resourceScope := strings.Join(dataplaneNamespacedListResourceKindStrings(), ",")
	if len(scope.ResourceKinds) > 0 {
		resourceScope = strings.Join(scope.ResourceKinds, ",")
	}

	resPanel, hotPanel, findingsPanel, derivedPanel, wh, cov := m.aggregateClusterDashboard(plane, nsNames, nsTotal, nsUnhealthy, nodesSnap, nodeState, normalizeClusterDashboardListOptions(opts))
	dpStats := dashboardDataplaneStatsFromSnapshots(m.stats.snapshot(), m.scheduler.StatsSnapshot(), time.Now().UTC())
	if policy.NamespaceEnrichment.Enabled && policy.NamespaceEnrichment.Sweep.Enabled && len(nsSnap.Items) > 0 && !m.hasNamespaceEnrichmentInFlight(clusterName) {
		m.BeginNamespaceListProgressiveEnrichment(clusterName, nsSnap.Items, NamespaceEnrichHints{})
	}

	trust := "Namespace and node blocks reflect dataplane snapshots. Resource totals and hotspots use only namespaces where the dataplane already has cached list snapshots (see coverage.resourceTotalsCompleteness and coverage.namespacesInResourceTotals)."

	return ClusterDashboardSummary{
		Plane: ClusterDashboardPlane{
			Profile:              string(policy.Profile),
			DiscoveryMode:        string(plane.DiscoveryMode()),
			ActivationMode:       dashboardActivationMode(policy),
			ProfilesImplemented:  []string{string(DataplaneProfileManual), string(DataplaneProfileFocused), string(DataplaneProfileBalanced), string(DataplaneProfileWide), string(DataplaneProfileDiagnostic)},
			DiscoveryImplemented: []string{string(DiscoveryModeTargeted), "focused_enrichment", "background_sweep"},
			Scope: ClusterDashboardPlaneScope{
				Namespaces:    namespaceScope,
				ResourceKinds: resourceScope,
			},
		},
		Visibility: ClusterDashboardVisibilityPanel{
			Namespaces: ClusterDashboardNamespaces{
				Total:         nsTotal,
				Unhealthy:     nsUnhealthy,
				Freshness:     string(nsSnap.Meta.Freshness),
				Coverage:      string(nsSnap.Meta.Coverage),
				Degradation:   string(nsSnap.Meta.Degradation),
				Completeness:  string(nsSnap.Meta.Completeness),
				State:         nsState,
				ObserverState: nsObs,
			},
			Nodes: ClusterDashboardNodes{
				Total:         nodeTotal,
				Freshness:     string(nodesSnap.Meta.Freshness),
				Coverage:      string(nodesSnap.Meta.Coverage),
				Degradation:   string(nodesSnap.Meta.Degradation),
				Completeness:  string(nodesSnap.Meta.Completeness),
				State:         nodeState,
				ObserverState: nodeObs,
			},
			NamespacesObservedAt: formatSnapshotTime(nsSnap.Meta.ObservedAt),
			NodesObservedAt:      formatSnapshotTime(nodesSnap.Meta.ObservedAt),
			TrustNote:            trust,
		},
		Coverage:      cov,
		Resources:     resPanel,
		Hotspots:      hotPanel,
		Findings:      findingsPanel,
		Derived:       derivedPanel,
		WorkloadHints: wh,
		Dataplane:     dpStats,
	}
}

func dashboardActivationMode(policy DataplanePolicy) string {
	if !policy.NamespaceEnrichment.Enabled && !policy.Observers.Enabled {
		return "manual_dataplane_snapshots"
	}
	if policy.NamespaceEnrichment.Sweep.Enabled {
		return "focused_plus_idle_sweep"
	}
	if policy.NamespaceEnrichment.Enabled {
		return "focused_idle_enrichment"
	}
	return "dataplane_snapshots"
}

// formatSnapshotTime returns RFC3339 or empty when unset.
func formatSnapshotTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func dashboardDataplaneStatsFromSnapshots(session DataplaneSessionStatsSnapshot, runs SchedulerRunStatsSnapshot, now time.Time) ClusterDashboardDataplaneStats {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	uptimeMin := now.Sub(session.StartedAt).Minutes()
	if session.StartedAt.IsZero() || uptimeMin < 0 {
		uptimeMin = 0
	}
	uptimeSec := int64(0)
	if !session.StartedAt.IsZero() {
		uptimeSec = int64(now.Sub(session.StartedAt).Seconds())
		if uptimeSec < 0 {
			uptimeSec = 0
		}
	}

	var totalRunCount uint64
	var totalRunDuration time.Duration
	var maxRun time.Duration
	for _, p := range runs.ByPriority {
		totalRunCount += p.Runs
		totalRunDuration += p.Total
		if p.Max > maxRun {
			maxRun = p.Max
		}
	}

	out := ClusterDashboardDataplaneStats{
		StartedAt: formatSnapshotTime(session.StartedAt),
		UptimeSec: uptimeSec,
		Requests: ClusterDashboardDataplaneRequestStats{
			Total:      session.RequestsTotal,
			FreshHits:  session.FreshHits,
			Misses:     session.Misses,
			Fetches:    session.FetchAttempts,
			Errors:     session.FetchErrors,
			HitRatio:   ratioPercent(session.FreshHits, session.RequestsTotal),
			FetchRatio: ratioPercent(session.FetchAttempts, session.RequestsTotal),
		},
		Cache: ClusterDashboardDataplaneCacheStats{
			SnapshotsStored:     session.CurrentCells,
			CurrentBytes:        session.CurrentBytes,
			AvgBytesPerSnapshot: avgUint(session.CurrentBytes, session.CurrentCells),
		},
		Traffic: ClusterDashboardDataplaneTrafficStats{
			LiveBytes:        session.LiveBytes,
			HydratedBytes:    session.HydratedBytes,
			AvgBytesPerFetch: avgUint(session.LiveBytes, session.FetchAttempts),
			RequestsPerMin:   ratePerMinute(session.RequestsTotal, uptimeMin),
			LiveBytesPerMin:  ratePerMinute(session.LiveBytes, uptimeMin),
		},
		Execution: ClusterDashboardDataplaneExecutionStats{
			Runs:        totalRunCount,
			AvgRunMs:    durationAvgMs(totalRunDuration, totalRunCount),
			MaxRunMs:    uint64(maxRun.Milliseconds()),
			Preemptions: runs.Preemptions,
		},
		Sources: make([]ClusterDashboardDataplaneSourceStats, 0, len(session.BySource)),
		Kinds:   make([]ClusterDashboardDataplaneKindStats, 0, len(session.ByKind)),
	}
	for _, src := range session.BySource {
		out.Sources = append(out.Sources, ClusterDashboardDataplaneSourceStats{
			Source:    src.Source,
			Requests:  src.Requests,
			FreshHits: src.FreshHits,
			Misses:    src.Misses,
			Fetches:   src.FetchAttempts,
			Errors:    src.FetchErrors,
		})
	}
	for _, kind := range session.ByKind {
		out.Kinds = append(out.Kinds, ClusterDashboardDataplaneKindStats{
			Kind:         string(kind.Kind),
			Fetches:      kind.FetchAttempts,
			CurrentBytes: kind.CurrentBytes,
			Snapshots:    kind.CurrentCells,
			LiveBytes:    kind.LiveBytes,
		})
	}
	return out
}

func ratioPercent(v uint64, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(v) * 100 / float64(total)
}

func ratePerMinute(v uint64, minutes float64) float64 {
	if minutes <= 0 {
		return 0
	}
	return float64(v) / minutes
}

func avgUint(v uint64, total uint64) uint64 {
	if total == 0 {
		return 0
	}
	return v / total
}

func durationAvgMs(total time.Duration, runs uint64) uint64 {
	if runs == 0 {
		return 0
	}
	return uint64(total.Milliseconds()) / runs
}
