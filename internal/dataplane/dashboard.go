package dataplane

import (
	"context"
	"sort"
	"strings"
	"time"

	"kview/internal/kube/dto"
)

const (
	restartElevatedThreshold = int32(3)
)

// ClusterDashboardSummary is a bounded Stage 5C operator overview derived from dataplane snapshots.
type ClusterDashboardSummary struct {
	Plane         ClusterDashboardPlane           `json:"plane"`
	Visibility    ClusterDashboardVisibilityPanel `json:"visibility"`
	Coverage      ClusterDashboardCoverage        `json:"coverage"`
	Resources     ClusterDashboardResourcesPanel  `json:"resources"`
	Hotspots      ClusterDashboardHotspotsPanel   `json:"hotspots"`
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
	VisibleNamespaces            int    `json:"visibleNamespaces"`
	ListOnlyNamespaces           int    `json:"listOnlyNamespaces"`
	DetailEnrichedNamespaces     int    `json:"detailEnrichedNamespaces"`
	RelatedEnrichedNamespaces    int    `json:"relatedEnrichedNamespaces"`
	AwaitingRelatedRowProjection int    `json:"awaitingRelatedRowProjection"`
	EnrichmentTargets            int    `json:"enrichmentTargets,omitempty"`
	HasActiveEnrichmentSession   bool   `json:"hasActiveEnrichmentSession,omitempty"`
	ResourceTotalsCompleteness   string `json:"resourceTotalsCompleteness"`
	NamespacesInResourceTotals   int    `json:"namespacesInResourceTotals"`
	ResourceTotalsNote           string `json:"resourceTotalsNote,omitempty"`
	Note                         string `json:"note,omitempty"`
}

// ClusterDashboardResourcesPanel sums workloads only for namespaces with cached dataplane list snapshots.
type ClusterDashboardResourcesPanel struct {
	Pods                   int    `json:"pods"`
	Deployments            int    `json:"deployments"`
	Services               int    `json:"services"`
	Ingresses              int    `json:"ingresses"`
	PersistentVolumeClaims int    `json:"persistentVolumeClaims"`
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
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	nsSnap, _ := plane.NamespacesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityMedium)
	nodesSnap, _ := plane.NodesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityMedium)

	nsObs := "not_loaded"
	nodeObs := "not_loaded"
	plane.obsMu.Lock()
	if plane.observers != nil {
		if plane.observers.namespacesState != "" {
			nsObs = string(plane.observers.namespacesState)
		}
		if plane.observers.nodesState != "" {
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
	resourceScope := "first_wave_defaults"
	if len(scope.ResourceKinds) > 0 {
		resourceScope = strings.Join(scope.ResourceKinds, ",")
	}

	resPanel, hotPanel, wh, cov := m.aggregateClusterDashboard(plane, nsNames, nsTotal, nsUnhealthy)

	trust := "Namespace and node blocks reflect cluster-wide list snapshots. Workload totals and hotspots use only namespaces where the dataplane already has cached list snapshots (see coverage.resourceTotalsCompleteness and coverage.namespacesInResourceTotals)."

	return ClusterDashboardSummary{
		Plane: ClusterDashboardPlane{
			Profile:              string(plane.Profile()),
			DiscoveryMode:        string(plane.DiscoveryMode()),
			ActivationMode:       "lazy_endpoint_driven",
			ProfilesImplemented:  []string{string(ProfileFocused)},
			DiscoveryImplemented: []string{string(DiscoveryModeTargeted)},
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
		WorkloadHints: wh,
	}
}

// formatSnapshotTime returns RFC3339 or empty when unset.
func formatSnapshotTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
