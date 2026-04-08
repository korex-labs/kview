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
	WorkloadHints ClusterDashboardWorkloadHints   `json:"workloadHints"`
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
	Top                   []ClusterDashboardFinding `json:"top,omitempty"`
	Items                 []ClusterDashboardFinding `json:"items,omitempty"`
	Note                  string                    `json:"note,omitempty"`
	AggregateFreshness    string                    `json:"aggregateFreshness,omitempty"`
	AggregateDegradation  string                    `json:"aggregateDegradation,omitempty"`
}

type ClusterDashboardFinding struct {
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name,omitempty"`
	Severity   string `json:"severity"`
	Score      int    `json:"score"`
	Reason     string `json:"reason"`
	Confidence string `json:"confidence,omitempty"`
	Section    string `json:"section,omitempty"`
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

// DashboardSummary builds a bounded cluster dashboard from cached snapshots.
func (m *manager) DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary {
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

	resPanel, hotPanel, findingsPanel, wh, cov := m.aggregateClusterDashboard(plane, nsNames, nsTotal, nsUnhealthy)
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
		WorkloadHints: wh,
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
