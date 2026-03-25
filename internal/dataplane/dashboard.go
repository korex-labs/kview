package dataplane

import (
	"context"
	"sort"
	"strings"

	"kview/internal/kube/dto"
)

const (
	restartElevatedThreshold = int32(3)
)

// ClusterDashboardSummary is a bounded Stage 5C operator overview derived from dataplane snapshots.
type ClusterDashboardSummary struct {
	Plane         ClusterDashboardPlane             `json:"plane"`
	Visibility    ClusterDashboardVisibilityPanel   `json:"visibility"`
	Resources     ClusterDashboardResourcesPanel    `json:"resources"`
	Hotspots      ClusterDashboardHotspotsPanel     `json:"hotspots"`
	WorkloadHints ClusterDashboardWorkloadHints     `json:"workloadHints"`
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

// ClusterDashboardResourcesPanel is summed from a bounded alphabetical namespace sample (see Partial/Note).
type ClusterDashboardResourcesPanel struct {
	Pods                   int    `json:"pods"`
	Deployments            int    `json:"deployments"`
	Services               int    `json:"services"`
	Ingresses              int    `json:"ingresses"`
	PersistentVolumeClaims int    `json:"persistentVolumeClaims"`
	SampledNamespaces      int    `json:"sampledNamespaces"`
	TotalNamespaces        int    `json:"totalNamespaces"`
	Partial                bool   `json:"partial"`
	Note                   string `json:"note,omitempty"`
	SampleFreshness        string `json:"sampleFreshness,omitempty"`
	SampleDegradation      string `json:"sampleDegradation,omitempty"`
}

// ClusterDashboardProblematicNamespace ranks namespaces by in-sample problematic resource count.
type ClusterDashboardProblematicNamespace struct {
	Namespace string `json:"namespace"`
	Score     int    `json:"score"`
}

// ClusterDashboardHotspotsPanel is derived from the same bounded sample as Resources (not cluster-complete when Partial).
type ClusterDashboardHotspotsPanel struct {
	UnhealthyNamespaces        int                                    `json:"unhealthyNamespaces"`
	SampledNamespaces          int                                    `json:"sampledNamespaces"`
	DegradedDeployments        int                                    `json:"degradedDeployments"`
	PodsWithElevatedRestarts   int                                    `json:"podsWithElevatedRestarts"`
	ProblematicResources       int                                    `json:"problematicResources"`
	TopProblematicNamespaces   []ClusterDashboardProblematicNamespace `json:"topProblematicNamespaces,omitempty"`
	TopPodRestartHotspots      []dto.PodRestartHotspotDTO             `json:"topPodRestartHotspots,omitempty"`
	Partial                    bool                                   `json:"partial"`
	Note                       string                                 `json:"note,omitempty"`
	SampleFreshness            string                                 `json:"sampleFreshness,omitempty"`
	SampleDegradation          string                                 `json:"sampleDegradation,omitempty"`
	HighSeverityHotspotsInTopN int                                    `json:"highSeverityHotspotsInTopN"`
}

// ClusterDashboardWorkloadHints is a bounded, visibility-aware workload signal from pod snapshots.
// Populated from the same aggregate pass as Hotspots for backward compatibility with older UI chips.
type ClusterDashboardWorkloadHints struct {
	TotalNamespacesVisible int `json:"totalNamespacesVisible"`
	NamespacesPodSampled   int `json:"namespacesPodSampled"`
	// TopPodRestartHotspots merges hotspots from sampled namespaces (global sort by restarts).
	TopPodRestartHotspots []dto.PodRestartHotspotDTO `json:"topPodRestartHotspots,omitempty"`
	// PodsWithElevatedRestarts counts pods with restarts >= 3 across sampled namespaces only.
	PodsWithElevatedRestarts int `json:"podsWithElevatedRestarts"`
	// HighSeverityHotspotsInTopN counts how many entries in TopPodRestartHotspots have severity "high".
	HighSeverityHotspotsInTopN int    `json:"highSeverityHotspotsInTopN"`
	SampleCoverageNote         string `json:"sampleCoverageNote,omitempty"`
	SampleFreshness            string `json:"sampleFreshness,omitempty"`
	SampleDegradation          string `json:"sampleDegradation,omitempty"`
}

// DashboardSummary builds a bounded cluster dashboard from cached snapshots.
func (m *manager) DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	nsSnap, _ := plane.NamespacesSnapshot(ctx, m.scheduler, m.clients)
	nodesSnap, _ := plane.NodesSnapshot(ctx, m.scheduler, m.clients)

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

	resPanel, hotPanel, wh := m.aggregateClusterDashboard(ctx, plane, nsNames, nsTotal, nsUnhealthy)

	trust := "Namespace and node blocks reflect cluster-wide list snapshots. Resource totals and hotspot rollups use a bounded alphabetical namespace sample (see resources.partial / resources.note)."
	if resPanel.Partial {
		trust += " Overview is not cluster-complete for workload aggregates."
	}

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
		Resources:     resPanel,
		Hotspots:      hotPanel,
		WorkloadHints: wh,
	}
}
