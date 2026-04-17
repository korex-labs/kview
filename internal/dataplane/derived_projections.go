package dataplane

import (
	"context"
	"sort"
	"strings"
	"time"

	"kview/internal/kube/dto"
)

const (
	derivedSourcePods       = "derived_from_cached_pod_snapshots"
	derivedSourceHelm       = "derived_from_cached_helm_release_snapshots"
	derivedCoverageSparse   = "sparse"
	derivedCompletenessHint = "inexact"
)

// ClusterDashboardDerivedPanel groups clearly labeled projections that are useful
// when direct cluster-scope reads are denied or intentionally unavailable.
type ClusterDashboardDerivedPanel struct {
	Nodes      ClusterDashboardDerivedNodesPanel      `json:"nodes"`
	HelmCharts ClusterDashboardDerivedHelmChartsPanel `json:"helmCharts"`
}

type ClusterDashboardDerivedProjectionMeta struct {
	Source          string `json:"source"`
	Freshness       string `json:"freshness,omitempty"`
	Coverage        string `json:"coverage"`
	Degradation     string `json:"degradation,omitempty"`
	Completeness    string `json:"completeness"`
	ObservedAt      string `json:"observedAt,omitempty"`
	NamespacesScope int    `json:"namespacesScope"`
	Note            string `json:"note,omitempty"`
}

type ClusterDashboardDerivedNodesPanel struct {
	Meta                    ClusterDashboardDerivedProjectionMeta `json:"meta"`
	DirectNodeSnapshotState string                                `json:"directNodeSnapshotState,omitempty"`
	DirectNodeSnapshotTotal int                                   `json:"directNodeSnapshotTotal,omitempty"`
	Nodes                   []ClusterDashboardDerivedNode         `json:"nodes,omitempty"`
	Total                   int                                   `json:"total"`
	Pods                    int                                   `json:"pods"`
	ElevatedRestartPods     int                                   `json:"elevatedRestartPods"`
	ProblematicPods         int                                   `json:"problematicPods"`
}

type ClusterDashboardDerivedNode struct {
	Name                string   `json:"name"`
	Namespaces          []string `json:"namespaces,omitempty"`
	NamespaceCount      int      `json:"namespaceCount"`
	Pods                int      `json:"pods"`
	RunningPods         int      `json:"runningPods"`
	NonRunningPods      int      `json:"nonRunningPods"`
	RestartCount        int32    `json:"restartCount"`
	ElevatedRestartPods int      `json:"elevatedRestartPods"`
	ProblematicPods     int      `json:"problematicPods"`
	Severity            string   `json:"severity"`
}

type ClusterDashboardDerivedHelmChartsPanel struct {
	Meta   ClusterDashboardDerivedProjectionMeta `json:"meta"`
	Charts []ClusterDashboardDerivedHelmChart    `json:"charts,omitempty"`
	Total  int                                   `json:"total"`
	Status map[string]int                        `json:"status,omitempty"`
}

type ClusterDashboardDerivedHelmChart struct {
	ChartName      string                    `json:"chartName"`
	Releases       int                       `json:"releases"`
	Namespaces     []string                  `json:"namespaces,omitempty"`
	NamespaceCount int                       `json:"namespaceCount"`
	Statuses       []string                  `json:"statuses,omitempty"`
	NeedsAttention int                       `json:"needsAttention,omitempty"`
	Versions       []dto.HelmChartVersionDTO `json:"versions,omitempty"`
}

func buildDerivedDashboardProjections(plane *clusterPlane, knownNS []string, restartThreshold int32, directNodes NodesSnapshot, directNodeState string) ClusterDashboardDerivedPanel {
	return ClusterDashboardDerivedPanel{
		Nodes:      buildDerivedNodesProjection(plane, knownNS, restartThreshold, directNodes, directNodeState),
		HelmCharts: buildDerivedHelmChartsProjection(plane, knownNS),
	}
}

func buildDerivedNodesProjection(plane *clusterPlane, knownNS []string, restartThreshold int32, directNodes NodesSnapshot, directNodeState string) ClusterDashboardDerivedNodesPanel {
	out := ClusterDashboardDerivedNodesPanel{
		DirectNodeSnapshotState: directNodeState,
		DirectNodeSnapshotTotal: len(directNodes.Items),
	}
	if restartThreshold <= 0 {
		restartThreshold = 5
	}
	if plane == nil || len(knownNS) == 0 {
		out.Meta = derivedProjectionMeta(derivedSourcePods, nil, 0, "No cached pod snapshots are available yet, so node rollups cannot be inferred.")
		return out
	}

	type agg struct {
		item ClusterDashboardDerivedNode
		ns   map[string]struct{}
	}
	byNode := map[string]*agg{}
	var metas []SnapshotMetadata
	for _, ns := range knownNS {
		snap, ok := plane.podsStore.getCached(ns)
		if !ok || snap.Err != nil {
			continue
		}
		metas = append(metas, snap.Meta)
		for _, pod := range snap.Items {
			nodeName := strings.TrimSpace(pod.Node)
			if nodeName == "" {
				nodeName = "(unscheduled)"
			}
			a := byNode[nodeName]
			if a == nil {
				a = &agg{
					item: ClusterDashboardDerivedNode{Name: nodeName},
					ns:   map[string]struct{}{},
				}
				byNode[nodeName] = a
			}
			a.item.Pods++
			a.item.RestartCount += pod.Restarts
			a.ns[ns] = struct{}{}
			if strings.EqualFold(pod.Phase, "running") {
				a.item.RunningPods++
			} else {
				a.item.NonRunningPods++
				a.item.ProblematicPods++
			}
			if pod.Restarts >= restartThreshold {
				a.item.ElevatedRestartPods++
				a.item.ProblematicPods++
			}
		}
	}

	out.Nodes = make([]ClusterDashboardDerivedNode, 0, len(byNode))
	for _, a := range byNode {
		for ns := range a.ns {
			a.item.Namespaces = append(a.item.Namespaces, ns)
		}
		sort.Strings(a.item.Namespaces)
		a.item.NamespaceCount = len(a.item.Namespaces)
		a.item.Severity = derivedNodeSeverity(a.item)
		out.Pods += a.item.Pods
		out.ElevatedRestartPods += a.item.ElevatedRestartPods
		out.ProblematicPods += a.item.ProblematicPods
		out.Nodes = append(out.Nodes, a.item)
	}
	sort.Slice(out.Nodes, func(i, j int) bool {
		if out.Nodes[i].ProblematicPods != out.Nodes[j].ProblematicPods {
			return out.Nodes[i].ProblematicPods > out.Nodes[j].ProblematicPods
		}
		if out.Nodes[i].ElevatedRestartPods != out.Nodes[j].ElevatedRestartPods {
			return out.Nodes[i].ElevatedRestartPods > out.Nodes[j].ElevatedRestartPods
		}
		if out.Nodes[i].Pods != out.Nodes[j].Pods {
			return out.Nodes[i].Pods > out.Nodes[j].Pods
		}
		return out.Nodes[i].Name < out.Nodes[j].Name
	})
	out.Total = len(byNode)
	note := "Derived from cached pod snapshots only; this is useful when direct node reads are denied, but it does not include allocatable CPU/memory or pods outside cached namespaces."
	out.Meta = derivedProjectionMeta(derivedSourcePods, metas, len(knownNS), note)
	return out
}

func derivedNodeSeverity(n ClusterDashboardDerivedNode) string {
	switch {
	case n.ElevatedRestartPods >= derivedNodeElevatedRestartMin || n.NonRunningPods >= derivedNodeNonRunningMin:
		return "high"
	case n.ElevatedRestartPods > 0 || n.NonRunningPods > 0:
		return "medium"
	default:
		return "low"
	}
}

func buildDerivedHelmChartsProjection(plane *clusterPlane, knownNS []string) ClusterDashboardDerivedHelmChartsPanel {
	out := ClusterDashboardDerivedHelmChartsPanel{Status: map[string]int{}}
	if plane == nil || len(knownNS) == 0 {
		out.Meta = derivedProjectionMeta(derivedSourceHelm, nil, 0, "No cached Helm release snapshots are available yet, so chart catalog rows cannot be inferred.")
		return out
	}

	type agg struct {
		item          ClusterDashboardDerivedHelmChart
		ns            map[string]struct{}
		statuses      map[string]struct{}
		versions      map[string]*dto.HelmChartVersionDTO
		versionNS     map[string]map[string]struct{}
		versionStatus map[string]map[string]struct{}
	}
	charts := map[string]*agg{}
	var metas []SnapshotMetadata
	for _, ns := range knownNS {
		snap, ok := plane.helmReleasesStore.getCached(ns)
		if !ok || snap.Err != nil {
			continue
		}
		metas = append(metas, snap.Meta)
		for _, rel := range EnrichHelmReleaseListItemsForAPI(snap.Items) {
			name := rel.ChartName
			if name == "" {
				name = rel.Chart
			}
			if name == "" {
				name = "(unknown chart)"
			}
			releaseNamespace := rel.Namespace
			if releaseNamespace == "" {
				releaseNamespace = ns
			}
			key := name
			a := charts[key]
			if a == nil {
				a = &agg{
					item: ClusterDashboardDerivedHelmChart{
						ChartName: name,
					},
					ns:            map[string]struct{}{},
					statuses:      map[string]struct{}{},
					versions:      map[string]*dto.HelmChartVersionDTO{},
					versionNS:     map[string]map[string]struct{}{},
					versionStatus: map[string]map[string]struct{}{},
				}
				charts[key] = a
			}
			a.item.Releases++
			a.ns[releaseNamespace] = struct{}{}
			versionKey := rel.ChartVersion
			v := a.versions[versionKey]
			if v == nil {
				v = &dto.HelmChartVersionDTO{ChartVersion: rel.ChartVersion, AppVersion: rel.AppVersion}
				a.versions[versionKey] = v
				a.versionNS[versionKey] = map[string]struct{}{}
				a.versionStatus[versionKey] = map[string]struct{}{}
			}
			v.Releases++
			a.versionNS[versionKey][releaseNamespace] = struct{}{}
			if rel.Status != "" {
				out.Status[rel.Status]++
				a.statuses[rel.Status] = struct{}{}
				a.versionStatus[versionKey][rel.Status] = struct{}{}
			}
			if rel.NeedsAttention {
				a.item.NeedsAttention++
				v.NeedsAttention++
			}
		}
	}

	out.Charts = make([]ClusterDashboardDerivedHelmChart, 0, len(charts))
	for _, a := range charts {
		for ns := range a.ns {
			a.item.Namespaces = append(a.item.Namespaces, ns)
		}
		for status := range a.statuses {
			a.item.Statuses = append(a.item.Statuses, status)
		}
		for versionKey, version := range a.versions {
			for ns := range a.versionNS[versionKey] {
				version.Namespaces = append(version.Namespaces, ns)
			}
			for status := range a.versionStatus[versionKey] {
				version.Statuses = append(version.Statuses, status)
			}
			sort.Strings(version.Namespaces)
			sort.Strings(version.Statuses)
			a.item.Versions = append(a.item.Versions, *version)
		}
		sort.Strings(a.item.Namespaces)
		sort.Strings(a.item.Statuses)
		sort.Slice(a.item.Versions, func(i, j int) bool {
			return a.item.Versions[i].ChartVersion < a.item.Versions[j].ChartVersion
		})
		a.item.NamespaceCount = len(a.item.Namespaces)
		out.Charts = append(out.Charts, a.item)
	}
	sort.Slice(out.Charts, func(i, j int) bool {
		if out.Charts[i].NeedsAttention != out.Charts[j].NeedsAttention {
			return out.Charts[i].NeedsAttention > out.Charts[j].NeedsAttention
		}
		if out.Charts[i].Releases != out.Charts[j].Releases {
			return out.Charts[i].Releases > out.Charts[j].Releases
		}
		return out.Charts[i].ChartName < out.Charts[j].ChartName
	})
	out.Total = len(charts)
	if len(out.Status) == 0 {
		out.Status = nil
	}
	note := "Derived from cached Helm release snapshots only; it is not a live cluster-scoped Helm chart catalog and may omit namespaces that have not been observed."
	out.Meta = derivedProjectionMeta(derivedSourceHelm, metas, len(knownNS), note)
	return out
}

func derivedProjectionMeta(source string, metas []SnapshotMetadata, namespacesScope int, note string) ClusterDashboardDerivedProjectionMeta {
	meta := ClusterDashboardDerivedProjectionMeta{
		Source:          source,
		Coverage:        derivedCoverageSparse,
		Completeness:    derivedCompletenessHint,
		NamespacesScope: namespacesScope,
		Note:            note,
	}
	if len(metas) == 0 {
		meta.Freshness = string(FreshnessClassUnknown)
		meta.Degradation = string(DegradationClassMinor)
		return meta
	}
	meta.Freshness = string(WorstFreshnessFromSnapshots(metas...))
	meta.Degradation = string(WorstDegradationFromSnapshots(metas...))
	meta.ObservedAt = formatSnapshotTime(ObservedAtFromSnapshots(metas...))
	return meta
}

func (m *manager) DerivedNodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error) {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return NodesSnapshot{}, err
	}
	plane := planeAny.(*clusterPlane)
	knownNS := cachedPodNamespaces(plane)
	proj := buildDerivedNodesProjection(plane, knownNS, int32(m.Policy().Dashboard.RestartElevatedThreshold), NodesSnapshot{}, "derived")
	items := make([]dto.NodeListItemDTO, 0, len(proj.Nodes))
	for _, n := range proj.Nodes {
		items = append(items, dto.NodeListItemDTO{
			Name:            n.Name,
			Status:          "Derived",
			PodsCount:       n.Pods,
			HealthBucket:    n.Severity,
			NeedsAttention:  n.ProblematicPods > 0,
			Derived:         true,
			DerivedSource:   proj.Meta.Source,
			DerivedCoverage: proj.Meta.Coverage,
			DerivedNote:     proj.Meta.Note,
			NamespaceCount:  n.NamespaceCount,
			ProblematicPods: n.ProblematicPods,
			RestartCount:    n.RestartCount,
		})
	}
	return NodesSnapshot{Items: items, Meta: snapshotMetaFromDerivedProjection(proj.Meta)}, nil
}

func (m *manager) DerivedNodeDetails(ctx context.Context, clusterName, nodeName string) (dto.NodeDetailsDTO, bool, error) {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return dto.NodeDetailsDTO{}, false, err
	}
	plane := planeAny.(*clusterPlane)
	nodeName = strings.TrimSpace(nodeName)
	if nodeName == "" {
		return dto.NodeDetailsDTO{}, false, nil
	}
	knownNS := cachedPodNamespaces(plane)
	proj := buildDerivedNodesProjection(plane, knownNS, int32(m.Policy().Dashboard.RestartElevatedThreshold), NodesSnapshot{}, "derived")
	var found *ClusterDashboardDerivedNode
	for i := range proj.Nodes {
		if proj.Nodes[i].Name == nodeName {
			found = &proj.Nodes[i]
			break
		}
	}
	if found == nil {
		return dto.NodeDetailsDTO{}, false, nil
	}

	pods := make([]dto.NodePodDTO, 0, found.Pods)
	for _, ns := range knownNS {
		snap, ok := plane.podsStore.getCached(ns)
		if !ok || snap.Err != nil {
			continue
		}
		for _, pod := range snap.Items {
			podNode := strings.TrimSpace(pod.Node)
			if podNode == "" {
				podNode = "(unscheduled)"
			}
			if podNode != nodeName {
				continue
			}
			pods = append(pods, dto.NodePodDTO{
				Name:      pod.Name,
				Namespace: pod.Namespace,
				Phase:     pod.Phase,
				Ready:     pod.Ready,
				Restarts:  pod.Restarts,
				AgeSec:    pod.AgeSec,
			})
		}
	}
	sort.Slice(pods, func(i, j int) bool {
		if pods[i].Namespace != pods[j].Namespace {
			return pods[i].Namespace < pods[j].Namespace
		}
		return pods[i].Name < pods[j].Name
	})

	return dto.NodeDetailsDTO{
		Summary: dto.NodeSummaryDTO{
			Name:   nodeName,
			Status: "Derived",
		},
		Pods:       pods,
		LinkedPods: dto.NodePodsSummaryDTO{Total: len(pods)},
		Derived: &dto.DerivedMetaDTO{
			Source:       proj.Meta.Source,
			Coverage:     proj.Meta.Coverage,
			Completeness: proj.Meta.Completeness,
			Note:         proj.Meta.Note,
		},
	}, true, nil
}

func (m *manager) DerivedHelmChartsSnapshot(ctx context.Context, clusterName string) (Snapshot[dto.HelmChartDTO], error) {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return Snapshot[dto.HelmChartDTO]{}, err
	}
	plane := planeAny.(*clusterPlane)
	knownNS := cachedHelmReleaseNamespaces(plane)
	proj := buildDerivedHelmChartsProjection(plane, knownNS)
	items := make([]dto.HelmChartDTO, 0, len(proj.Charts))
	for _, chart := range proj.Charts {
		chartVersion := ""
		appVersion := ""
		if len(chart.Versions) > 1 {
			chartVersion = "multiple"
			appVersion = "multiple"
		}
		if len(chart.Versions) == 1 {
			chartVersion = chart.Versions[0].ChartVersion
			appVersion = chart.Versions[0].AppVersion
		}
		items = append(items, dto.HelmChartDTO{
			ChartName:       chart.ChartName,
			ChartVersion:    chartVersion,
			AppVersion:      appVersion,
			Releases:        chart.Releases,
			Namespaces:      chart.Namespaces,
			Statuses:        chart.Statuses,
			NeedsAttention:  chart.NeedsAttention,
			Versions:        chart.Versions,
			Derived:         true,
			DerivedSource:   proj.Meta.Source,
			DerivedCoverage: proj.Meta.Coverage,
			DerivedNote:     proj.Meta.Note,
		})
	}
	return Snapshot[dto.HelmChartDTO]{Items: items, Meta: snapshotMetaFromDerivedProjection(proj.Meta)}, nil
}

func cachedPodNamespaces(plane *clusterPlane) []string {
	if plane == nil {
		return nil
	}
	snaps := peekAllNamespacedSnapshots(&plane.podsStore)
	out := make([]string, 0, len(snaps))
	for ns, snap := range snaps {
		if snap.Err == nil {
			out = append(out, ns)
		}
	}
	sort.Strings(out)
	return out
}

func cachedHelmReleaseNamespaces(plane *clusterPlane) []string {
	if plane == nil {
		return nil
	}
	snaps := peekAllNamespacedSnapshots(&plane.helmReleasesStore)
	out := make([]string, 0, len(snaps))
	for ns, snap := range snaps {
		if snap.Err == nil {
			out = append(out, ns)
		}
	}
	sort.Strings(out)
	return out
}

func snapshotMetaFromDerivedProjection(meta ClusterDashboardDerivedProjectionMeta) SnapshotMetadata {
	observedAt := time.Now().UTC()
	if meta.ObservedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, meta.ObservedAt); err == nil {
			observedAt = parsed
		}
	}
	return SnapshotMetadata{
		ObservedAt:   observedAt,
		Freshness:    FreshnessClass(meta.Freshness),
		Coverage:     CoverageClass(meta.Coverage),
		Degradation:  DegradationClass(meta.Degradation),
		Completeness: CompletenessClass(meta.Completeness),
	}
}
