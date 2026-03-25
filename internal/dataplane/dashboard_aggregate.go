package dataplane

import (
	"context"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"

	"kview/internal/kube/dto"
)

const (
	// clusterDashboardAggregateSampleNamespaces bounds how many namespaces contribute to
	// resource totals and hotspot rollups on the cluster dashboard (alphabetical order).
	clusterDashboardAggregateSampleNamespaces = 12
	clusterDashboardHotspotMergeLimit         = 10
	dashboardAggregateParallel                = 6
)

// aggregateClusterDashboard samples up to clusterDashboardAggregateSampleNamespaces namespaces
// (alphabetical) and aggregates pods, deployments, services, ingresses, and PVCs snapshots.
func (m *manager) aggregateClusterDashboard(ctx context.Context, plane *clusterPlane, nsNamesSorted []string, nsTotal int, nsUnhealthy int) (ClusterDashboardResourcesPanel, ClusterDashboardHotspotsPanel, ClusterDashboardWorkloadHints) {
	res := ClusterDashboardResourcesPanel{
		TotalNamespaces: nsTotal,
	}
	hot := ClusterDashboardHotspotsPanel{
		UnhealthyNamespaces: nsUnhealthy,
	}
	wh := ClusterDashboardWorkloadHints{
		TotalNamespacesVisible: nsTotal,
		SampleCoverageNote:     "aggregated_first_namespaces_alphabetical",
	}

	nSample := clusterDashboardAggregateSampleNamespaces
	if len(nsNamesSorted) < nSample {
		nSample = len(nsNamesSorted)
	}
	res.SampledNamespaces = nSample
	hot.SampledNamespaces = nSample
	wh.NamespacesPodSampled = nSample

	if nsTotal == 0 || nSample == 0 || plane == nil {
		res.Note = "No namespaces visible in snapshot; resource totals are zero."
		hot.Note = res.Note
		return res, hot, wh
	}

	partial := nsTotal > nSample
	res.Partial = partial
	hot.Partial = partial
	if partial {
		trust := "Resource totals and hotspot rollups aggregate only the first namespaces alphabetically (see sampledNamespaces vs totalNamespaces); not cluster-complete."
		res.Note = trust
		hot.Note = trust
	}

	type sample struct {
		ns   string
		pods PodsSnapshot
		deps DeploymentsSnapshot
		svcs ServicesSnapshot
		ings IngressesSnapshot
		pvcs PVCsSnapshot
	}
	samples := make([]sample, nSample)

	sem := make(chan struct{}, dashboardAggregateParallel)
	g, gctx := errgroup.WithContext(ctx)

	for i := 0; i < nSample; i++ {
		i := i
		ns := nsNamesSorted[i]
		g.Go(func() error {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			ps, _ := plane.PodsSnapshot(gctx, m.scheduler, m.clients, ns)
			ds, _ := plane.DeploymentsSnapshot(gctx, m.scheduler, m.clients, ns)
			sv, _ := plane.ServicesSnapshot(gctx, m.scheduler, m.clients, ns)
			ing, _ := plane.IngressesSnapshot(gctx, m.scheduler, m.clients, ns)
			pvc, _ := plane.PVCsSnapshot(gctx, m.scheduler, m.clients, ns)

			samples[i] = sample{ns: ns, pods: ps, deps: ds, svcs: sv, ings: ing, pvcs: pvc}
			return nil
		})
	}

	_ = g.Wait()

	var podMetas []SnapshotMetadata
	var hotspotLists [][]dto.PodRestartHotspotDTO
	type nsScore struct {
		ns    string
		score int
	}
	scores := make([]nsScore, 0, nSample)

	for _, s := range samples {
		if s.ns == "" {
			continue
		}
		if s.pods.Err == nil {
			res.Pods += len(s.pods.Items)
			hot.PodsWithElevatedRestarts += CountPodsWithRestartThreshold(s.pods, restartElevatedThreshold)
			podMetas = append(podMetas, s.pods.Meta)
			hList := ProjectRestartHotspotsFromPods(s.ns, s.pods, defaultRestartHotspotLimit)
			if len(hList.Items) > 0 {
				hotspotLists = append(hotspotLists, hList.Items)
			}
		}
		if s.deps.Err == nil {
			res.Deployments += len(s.deps.Items)
			enriched := EnrichDeploymentListItemsForAPI(s.deps.Items)
			for _, d := range enriched {
				if d.HealthBucket == deployBucketDegraded || d.RolloutNeedsAttention {
					hot.DegradedDeployments++
				}
			}
		}
		if s.svcs.Err == nil {
			res.Services += len(s.svcs.Items)
			podMetas = append(podMetas, s.svcs.Meta)
		}
		if s.ings.Err == nil {
			res.Ingresses += len(s.ings.Items)
			podMetas = append(podMetas, s.ings.Meta)
		}
		if s.pvcs.Err == nil {
			res.PersistentVolumeClaims += len(s.pvcs.Items)
			podMetas = append(podMetas, s.pvcs.Meta)
		}

		var probPods []dto.ProblematicResource
		if s.pods.Err == nil {
			probPods = podProblematicFromListUnbounded(s.pods.Items)
		}
		var probDeps []dto.ProblematicResource
		if s.deps.Err == nil {
			probDeps = deploymentProblematicListUnbounded(s.deps.Items)
		}
		pc := countUniqueProblematic(probPods, probDeps)
		hot.ProblematicResources += pc
		if pc > 0 {
			scores = append(scores, nsScore{ns: s.ns, score: pc})
		}
	}

	sort.Slice(scores, func(i, j int) bool {
		if scores[i].score != scores[j].score {
			return scores[i].score > scores[j].score
		}
		return scores[i].ns < scores[j].ns
	})
	for k := 0; k < len(scores) && k < 3; k++ {
		hot.TopProblematicNamespaces = append(hot.TopProblematicNamespaces, ClusterDashboardProblematicNamespace{
			Namespace: scores[k].ns,
			Score:     scores[k].score,
		})
	}

	hot.TopPodRestartHotspots = MergeRestartHotspots(clusterDashboardHotspotMergeLimit, hotspotLists...)
	for _, item := range hot.TopPodRestartHotspots {
		if item.Severity == restartSeverityHigh {
			hot.HighSeverityHotspotsInTopN++
		}
	}

	if len(podMetas) > 0 {
		wf := string(WorstFreshnessFromSnapshots(podMetas...))
		wd := string(WorstDegradationFromSnapshots(podMetas...))
		res.SampleFreshness = wf
		res.SampleDegradation = wd
		hot.SampleFreshness = wf
		hot.SampleDegradation = wd
	}

	// Backward-compatible workloadHints block (same data as hotspots merge).
	wh.TopPodRestartHotspots = hot.TopPodRestartHotspots
	wh.PodsWithElevatedRestarts = hot.PodsWithElevatedRestarts
	wh.HighSeverityHotspotsInTopN = hot.HighSeverityHotspotsInTopN
	wh.SampleFreshness = hot.SampleFreshness
	wh.SampleDegradation = hot.SampleDegradation
	if partial {
		wh.SampleCoverageNote = "pod_hotspots_and_resource_totals_sampled_first_namespaces_alphabetical_not_cluster_complete"
	}

	return res, hot, wh
}

// formatSnapshotTime returns RFC3339 or empty when unset.
func formatSnapshotTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
