package dataplane

import (
	"sort"

	"kview/internal/kube/dto"
)

const (
	clusterDashboardHotspotMergeLimit = 10
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

// aggregateClusterDashboard rolls up workload totals and hotspots only from namespaces that already
// have cached dataplane list snapshots (typically from visiting those namespaces or row enrichment),
// intersected with the current namespace list snapshot. No alphabetical sampling and no implicit cluster-wide totals.
func (m *manager) aggregateClusterDashboard(plane *clusterPlane, nsNamesSorted []string, nsTotal int, nsUnhealthy int) (ClusterDashboardResourcesPanel, ClusterDashboardHotspotsPanel, ClusterDashboardWorkloadHints, ClusterDashboardCoverage) {
	cov := m.buildDashboardCoverage(plane.name, nsNamesSorted, nsTotal)

	knownNS := visibleNamespacesWithCachedDataplaneLists(plane, nsNamesSorted)
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
			res.Note = "No cached dataplane list snapshots yet for visible namespaces; totals stay at zero until namespaces are opened or row enrichment fills caches."
			hot.Note = res.Note
			cov.ResourceTotalsNote = res.Note
		} else if nsTotal == 0 {
			res.Note = "No namespaces visible in snapshot; resource totals are zero."
			hot.Note = res.Note
		}
		return res, hot, wh, cov
	}

	if cov.ResourceTotalsCompleteness == "partial" {
		t := "Resource totals and hotspots sum only namespaces where the dataplane already has cached list snapshots; some visible namespaces are not included yet."
		res.Note = t
		hot.Note = t
		cov.ResourceTotalsNote = t
	} else {
		cov.ResourceTotalsNote = "Totals include every visible namespace that has at least one cached dataplane list snapshot."
	}

	var aggregateMetas []SnapshotMetadata
	var hotspotLists [][]dto.PodRestartHotspotDTO
	type nsScore struct {
		ns    string
		score int
	}
	scores := make([]nsScore, 0, len(knownNS))

	for _, ns := range knownNS {
		podsSnap, podsOK := plane.podsStore.getCached(ns)
		depsSnap, depsOK := plane.depsStore.getCached(ns)
		dsSnap, dsOK := plane.dsStore.getCached(ns)
		stsSnap, stsOK := plane.stsStore.getCached(ns)
		rsSnap, rsOK := plane.rsStore.getCached(ns)
		jobsSnap, jobsOK := plane.jobsStore.getCached(ns)
		cjSnap, cjOK := plane.cjStore.getCached(ns)
		svcsSnap, svcsOK := plane.svcsStore.getCached(ns)
		ingsSnap, ingsOK := plane.ingStore.getCached(ns)
		pvcSnap, pvcOK := plane.pvcsStore.getCached(ns)
		cmSnap, cmOK := plane.cmsStore.getCached(ns)
		secSnap, secOK := plane.secsStore.getCached(ns)
		saSnap, saOK := plane.saStore.getCached(ns)
		rolesSnap, rolesOK := plane.rolesStore.getCached(ns)
		roleBindingsSnap, roleBindingsOK := plane.roleBindingsStore.getCached(ns)
		helmReleasesSnap, helmReleasesOK := plane.helmReleasesStore.getCached(ns)

		if podsOK && podsSnap.Err == nil {
			res.Pods += len(podsSnap.Items)
			hot.PodsWithElevatedRestarts += CountPodsWithRestartThreshold(podsSnap, restartElevatedThreshold)
			aggregateMetas = append(aggregateMetas, podsSnap.Meta)
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
		if dsOK && dsSnap.Err == nil {
			res.DaemonSets += len(dsSnap.Items)
			aggregateMetas = append(aggregateMetas, dsSnap.Meta)
		}
		if stsOK && stsSnap.Err == nil {
			res.StatefulSets += len(stsSnap.Items)
			aggregateMetas = append(aggregateMetas, stsSnap.Meta)
		}
		if rsOK && rsSnap.Err == nil {
			res.ReplicaSets += len(rsSnap.Items)
			aggregateMetas = append(aggregateMetas, rsSnap.Meta)
		}
		if jobsOK && jobsSnap.Err == nil {
			res.Jobs += len(jobsSnap.Items)
			aggregateMetas = append(aggregateMetas, jobsSnap.Meta)
		}
		if cjOK && cjSnap.Err == nil {
			res.CronJobs += len(cjSnap.Items)
			aggregateMetas = append(aggregateMetas, cjSnap.Meta)
		}
		if svcsOK && svcsSnap.Err == nil {
			res.Services += len(svcsSnap.Items)
			aggregateMetas = append(aggregateMetas, svcsSnap.Meta)
		}
		if ingsOK && ingsSnap.Err == nil {
			res.Ingresses += len(ingsSnap.Items)
			aggregateMetas = append(aggregateMetas, ingsSnap.Meta)
		}
		if pvcOK && pvcSnap.Err == nil {
			res.PersistentVolumeClaims += len(pvcSnap.Items)
			aggregateMetas = append(aggregateMetas, pvcSnap.Meta)
		}
		if cmOK && cmSnap.Err == nil {
			res.ConfigMaps += len(cmSnap.Items)
			aggregateMetas = append(aggregateMetas, cmSnap.Meta)
		}
		if secOK && secSnap.Err == nil {
			res.Secrets += len(secSnap.Items)
			aggregateMetas = append(aggregateMetas, secSnap.Meta)
		}
		if saOK && saSnap.Err == nil {
			res.ServiceAccounts += len(saSnap.Items)
			aggregateMetas = append(aggregateMetas, saSnap.Meta)
		}
		if rolesOK && rolesSnap.Err == nil {
			res.Roles += len(rolesSnap.Items)
			aggregateMetas = append(aggregateMetas, rolesSnap.Meta)
		}
		if roleBindingsOK && roleBindingsSnap.Err == nil {
			res.RoleBindings += len(roleBindingsSnap.Items)
			aggregateMetas = append(aggregateMetas, roleBindingsSnap.Meta)
		}
		if helmReleasesOK && helmReleasesSnap.Err == nil {
			res.HelmReleases += len(helmReleasesSnap.Items)
			aggregateMetas = append(aggregateMetas, helmReleasesSnap.Meta)
		}

		var probPods []dto.ProblematicResource
		if podsOK && podsSnap.Err == nil {
			probPods = podProblematicFromListUnbounded(podsSnap.Items)
		}
		var probDeps []dto.ProblematicResource
		if depsOK && depsSnap.Err == nil {
			probDeps = deploymentProblematicListUnbounded(depsSnap.Items)
		}
		var probWorkloads []dto.ProblematicResource
		if dsOK && dsSnap.Err == nil || stsOK && stsSnap.Err == nil || jobsOK && jobsSnap.Err == nil || cjOK && cjSnap.Err == nil {
			probWorkloads = WorkloadProblematicCandidates(
				nil,
				dsSnap.Items,
				stsSnap.Items,
				jobsSnap.Items,
				cjSnap.Items,
				clusterDashboardHotspotMergeLimit,
			)
		}
		pc := countUniqueProblematic(probPods, probDeps, probWorkloads)
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

	if len(aggregateMetas) > 0 {
		wf := string(WorstFreshnessFromSnapshots(aggregateMetas...))
		wd := string(WorstDegradationFromSnapshots(aggregateMetas...))
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
