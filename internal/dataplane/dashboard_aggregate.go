package dataplane

import (
	"sort"

	"kview/internal/kube/dto"
)

const (
	clusterDashboardHotspotMergeLimit = 10
)

// resourceTotalsCompletenessLabel returns complete | partial | unknown for visible vs cached pod-list namespaces.
func resourceTotalsCompletenessLabel(visible, withCachedPods int) string {
	if visible <= 0 {
		return "unknown"
	}
	if withCachedPods <= 0 {
		return "unknown"
	}
	if withCachedPods >= visible {
		return "complete"
	}
	return "partial"
}

// aggregateClusterDashboard rolls up workload totals and hotspots only from namespaces that already
// have cached dataplane list snapshots (typically from visiting those namespaces or row enrichment),
// intersected with the current namespace list snapshot. No alphabetical sampling and no implicit cluster-wide totals.
func (m *manager) aggregateClusterDashboard(plane *clusterPlane, nsNamesSorted []string, nsTotal int, nsUnhealthy int) (ClusterDashboardResourcesPanel, ClusterDashboardHotspotsPanel, ClusterDashboardWorkloadHints, ClusterDashboardCoverage) {
	cov := m.buildDashboardCoverage(plane.name, nsNamesSorted, nsTotal)

	knownNS := visibleNamespacesWithCachedPods(plane, nsNamesSorted)
	cov.NamespacesInResourceTotals = len(knownNS)
	cov.ResourceTotalsCompleteness = resourceTotalsCompletenessLabel(nsTotal, len(knownNS))

	res := ClusterDashboardResourcesPanel{
		TotalNamespaces: nsTotal,
	}
	hot := ClusterDashboardHotspotsPanel{
		UnhealthyNamespaces: nsUnhealthy,
	}
	wh := ClusterDashboardWorkloadHints{
		TotalNamespacesVisible:      nsTotal,
		NamespacesWithWorkloadCache: len(knownNS),
	}

	if nsTotal == 0 || len(knownNS) == 0 || plane == nil {
		if nsTotal > 0 && len(knownNS) == 0 {
			res.Note = "No cached workload list snapshots yet for visible namespaces; totals stay at zero until namespaces are opened or row enrichment fills caches."
			hot.Note = res.Note
			cov.ResourceTotalsNote = res.Note
		} else if nsTotal == 0 {
			res.Note = "No namespaces visible in snapshot; resource totals are zero."
			hot.Note = res.Note
		}
		return res, hot, wh, cov
	}

	if cov.ResourceTotalsCompleteness == "partial" {
		t := "Resource totals and hotspots sum only namespaces where the dataplane already has cached workload lists; some visible namespaces are not included yet."
		res.Note = t
		hot.Note = t
		cov.ResourceTotalsNote = t
	} else {
		cov.ResourceTotalsNote = "Totals include every visible namespace that has a cached pod list snapshot."
	}

	var podMetas []SnapshotMetadata
	var hotspotLists [][]dto.PodRestartHotspotDTO
	type nsScore struct {
		ns    string
		score int
	}
	scores := make([]nsScore, 0, len(knownNS))

	for _, ns := range knownNS {
		podsSnap, podsOK := plane.podsStore.getCached(ns)
		depsSnap, depsOK := plane.depsStore.getCached(ns)
		svcsSnap, svcsOK := plane.svcsStore.getCached(ns)
		ingsSnap, ingsOK := plane.ingStore.getCached(ns)
		pvcSnap, pvcOK := plane.pvcsStore.getCached(ns)

		if podsOK && podsSnap.Err == nil {
			res.Pods += len(podsSnap.Items)
			hot.PodsWithElevatedRestarts += CountPodsWithRestartThreshold(podsSnap, restartElevatedThreshold)
			podMetas = append(podMetas, podsSnap.Meta)
			hList := ProjectRestartHotspotsFromPods(ns, podsSnap, defaultRestartHotspotLimit)
			if len(hList.Items) > 0 {
				hotspotLists = append(hotspotLists, hList.Items)
			}
		}
		if depsOK && depsSnap.Err == nil {
			res.Deployments += len(depsSnap.Items)
			enriched := EnrichDeploymentListItemsForAPI(depsSnap.Items)
			for _, d := range enriched {
				if d.HealthBucket == deployBucketDegraded || d.RolloutNeedsAttention {
					hot.DegradedDeployments++
				}
			}
		}
		if svcsOK && svcsSnap.Err == nil {
			res.Services += len(svcsSnap.Items)
			podMetas = append(podMetas, svcsSnap.Meta)
		}
		if ingsOK && ingsSnap.Err == nil {
			res.Ingresses += len(ingsSnap.Items)
			podMetas = append(podMetas, ingsSnap.Meta)
		}
		if pvcOK && pvcSnap.Err == nil {
			res.PersistentVolumeClaims += len(pvcSnap.Items)
			podMetas = append(podMetas, pvcSnap.Meta)
		}

		var probPods []dto.ProblematicResource
		if podsOK && podsSnap.Err == nil {
			probPods = podProblematicFromListUnbounded(podsSnap.Items)
		}
		var probDeps []dto.ProblematicResource
		if depsOK && depsSnap.Err == nil {
			probDeps = deploymentProblematicListUnbounded(depsSnap.Items)
		}
		pc := countUniqueProblematic(probPods, probDeps)
		hot.ProblematicResources += pc
		if pc > 0 {
			scores = append(scores, nsScore{ns: ns, score: pc})
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
		res.AggregateFreshness = wf
		res.AggregateDegradation = wd
		hot.AggregateFreshness = wf
		hot.AggregateDegradation = wd
	}

	wh.TopPodRestartHotspots = hot.TopPodRestartHotspots
	wh.PodsWithElevatedRestarts = hot.PodsWithElevatedRestarts
	wh.HighSeverityHotspotsInTopN = hot.HighSeverityHotspotsInTopN
	wh.AggregateFreshness = hot.AggregateFreshness
	wh.AggregateDegradation = hot.AggregateDegradation

	return res, hot, wh, cov
}

func visibleNamespacesWithCachedPods(plane *clusterPlane, visibleSorted []string) []string {
	if plane == nil || len(visibleSorted) == 0 {
		return nil
	}
	out := make([]string, 0, len(visibleSorted))
	for _, ns := range visibleSorted {
		if _, ok := plane.podsStore.getCached(ns); ok {
			out = append(out, ns)
		}
	}
	return out
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

	m.nsEnrich.mu.Lock()
	sess, ok := m.nsEnrich.byCluster[cluster]
	m.nsEnrich.mu.Unlock()
	if !ok || sess == nil {
		cov.ListOnlyNamespaces = visibleCount
		cov.Note = "No active namespace row-enrichment session; list-only counts assume the namespace list snapshot until enrichment runs."
		return cov
	}

	sess.mu.Lock()
	workSet := make(map[string]struct{}, len(sess.workNames))
	for _, n := range sess.workNames {
		workSet[n] = struct{}{}
	}
	detailDone := sess.detailDone
	relatedEnriched := 0
	listOnlyNeverQueued := 0
	for _, name := range visibleSorted {
		if _, w := workSet[name]; !w {
			listOnlyNeverQueued++
			continue
		}
		if row, ok := sess.merged[name]; ok && row.RowEnriched {
			relatedEnriched++
		}
	}
	sess.mu.Unlock()

	cov.HasActiveEnrichmentSession = true
	cov.EnrichmentTargets = len(workSet)
	cov.DetailEnrichedNamespaces = detailDone
	if detailDone > cov.EnrichmentTargets {
		cov.DetailEnrichedNamespaces = cov.EnrichmentTargets
	}
	cov.RelatedEnrichedNamespaces = relatedEnriched
	cov.ListOnlyNamespaces = listOnlyNeverQueued
	cov.AwaitingRelatedRowProjection = visibleCount - listOnlyNeverQueued - relatedEnriched
	if cov.AwaitingRelatedRowProjection < 0 {
		cov.AwaitingRelatedRowProjection = 0
	}
	return cov
}
