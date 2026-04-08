package dataplane

import (
	"context"
	"sort"
	"strings"
	"time"

	"kview/internal/kube/dto"
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
func (m *manager) aggregateClusterDashboard(plane *clusterPlane, nsNamesSorted []string, nsTotal int, nsUnhealthy int) (ClusterDashboardResourcesPanel, ClusterDashboardHotspotsPanel, ClusterDashboardFindingsPanel, ClusterDashboardWorkloadHints, ClusterDashboardCoverage) {
	cov := m.buildDashboardCoverage(plane.name, nsNamesSorted, nsTotal)
	policy := m.Policy().Dashboard

	knownNS := visibleNamespacesWithCachedDataplaneLists(plane, nsNamesSorted)
	cov.NamespacesInResourceTotals = len(knownNS)
	cov.ResourceTotalsCompleteness = resourceTotalsCompletenessLabel(nsTotal, len(knownNS))

	res := ClusterDashboardResourcesPanel{
		TotalNamespaces: nsTotal,
	}
	hot := ClusterDashboardHotspotsPanel{
		UnhealthyNamespaces: nsUnhealthy,
	}
	find := ClusterDashboardFindingsPanel{}
	wh := ClusterDashboardWorkloadHints{
		TotalNamespacesVisible:      nsTotal,
		NamespacesWithWorkloadCache: len(knownNS),
	}

	if nsTotal == 0 || len(knownNS) == 0 || plane == nil {
		if nsTotal > 0 && len(knownNS) == 0 {
			res.Note = "No cached dataplane list snapshots yet for visible namespaces; totals stay at zero until namespaces are opened or row enrichment fills caches."
			hot.Note = res.Note
			find.Note = res.Note
			cov.ResourceTotalsNote = res.Note
		} else if nsTotal == 0 {
			res.Note = "No namespaces visible in snapshot; resource totals are zero."
			hot.Note = res.Note
			find.Note = res.Note
		}
		return res, hot, find, wh, cov
	}

	if cov.ResourceTotalsCompleteness == "partial" {
		t := "Resource totals and hotspots sum only namespaces where the dataplane already has cached list snapshots; some visible namespaces are not included yet."
		res.Note = t
		hot.Note = t
		find.Note = t
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
	var findings []ClusterDashboardFinding
	now := time.Now()

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
		rqSnap, rqOK := plane.rqStore.getCached(ns)
		lrSnap, lrOK := plane.lrStore.getCached(ns)

		if podsOK && podsSnap.Err == nil {
			res.Pods += len(podsSnap.Items)
			aggregateMetas = append(aggregateMetas, podsSnap.Meta)
			if policy.IncludeHotspots {
				hot.PodsWithElevatedRestarts += CountPodsWithRestartThreshold(podsSnap, int32(policy.RestartElevatedThreshold))
				hList := ProjectRestartHotspotsFromPods(ns, podsSnap, defaultRestartHotspotLimit)
				if len(hList.Items) > 0 {
					hotspotLists = append(hotspotLists, hList.Items)
				}
			}
		}
		if depsOK && depsSnap.Err == nil {
			res.Deployments += len(depsSnap.Items)
			if policy.IncludeHotspots {
				enriched := EnrichDeploymentListItemsForAPI(depsSnap.Items)
				for _, d := range enriched {
					if d.HealthBucket == deployBucketDegraded || d.RolloutNeedsAttention {
						hot.DegradedDeployments++
					}
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
		if rqOK && rqSnap.Err == nil {
			res.ResourceQuotas += len(rqSnap.Items)
			aggregateMetas = append(aggregateMetas, rqSnap.Meta)
		}
		if lrOK && lrSnap.Err == nil {
			res.LimitRanges += len(lrSnap.Items)
			aggregateMetas = append(aggregateMetas, lrSnap.Meta)
		}
		findings = append(findings, detectDashboardFindings(now, ns, dashboardSnapshotSet{
			pods:           podsSnap,
			podsOK:         podsOK && podsSnap.Err == nil,
			deps:           depsSnap,
			depsOK:         depsOK && depsSnap.Err == nil,
			ds:             dsSnap,
			dsOK:           dsOK && dsSnap.Err == nil,
			sts:            stsSnap,
			stsOK:          stsOK && stsSnap.Err == nil,
			rs:             rsSnap,
			rsOK:           rsOK && rsSnap.Err == nil,
			jobs:           jobsSnap,
			jobsOK:         jobsOK && jobsSnap.Err == nil,
			cjs:            cjSnap,
			cjsOK:          cjOK && cjSnap.Err == nil,
			svcs:           svcsSnap,
			svcsOK:         svcsOK && svcsSnap.Err == nil,
			ings:           ingsSnap,
			ingsOK:         ingsOK && ingsSnap.Err == nil,
			pvcs:           pvcSnap,
			pvcsOK:         pvcOK && pvcSnap.Err == nil,
			cms:            cmSnap,
			cmsOK:          cmOK && cmSnap.Err == nil,
			secs:           secSnap,
			secsOK:         secOK && secSnap.Err == nil,
			sas:            saSnap,
			sasOK:          saOK && saSnap.Err == nil,
			helmReleases:   helmReleasesSnap,
			helmOK:         helmReleasesOK && helmReleasesSnap.Err == nil,
			resourceQuotas: rqSnap,
			quotasOK:       rqOK && rqSnap.Err == nil,
			limitRanges:    lrSnap,
			limitRangesOK:  lrOK && lrSnap.Err == nil,
		})...)

		if policy.IncludeHotspots {
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
					policy.HotspotLimit,
				)
			}
			pc := countUniqueProblematic(probPods, probDeps, probWorkloads)
			hot.ProblematicResources += pc
			if pc > 0 {
				scores = append(scores, nsScore{ns: ns, score: pc})
			}
		}
	}

	if !policy.IncludeHotspots {
		hot.Note = "Hotspot projection is disabled in dataplane settings."
		findNote := find.Note
		find = summarizeDashboardFindings(findings, policy.HotspotLimit)
		find.Note = findNote
		wh.AggregateFreshness = res.AggregateFreshness
		wh.AggregateDegradation = res.AggregateDegradation
		return res, hot, find, wh, cov
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

	hot.TopPodRestartHotspots = MergeRestartHotspots(policy.HotspotLimit, hotspotLists...)
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
		find.AggregateFreshness = wf
		find.AggregateDegradation = wd
	}
	findNote := find.Note
	find = summarizeDashboardFindings(findings, policy.HotspotLimit)
	find.Note = findNote
	find.AggregateFreshness = hot.AggregateFreshness
	find.AggregateDegradation = hot.AggregateDegradation

	wh.TopPodRestartHotspots = hot.TopPodRestartHotspots
	wh.PodsWithElevatedRestarts = hot.PodsWithElevatedRestarts
	wh.HighSeverityHotspotsInTopN = hot.HighSeverityHotspotsInTopN
	wh.AggregateFreshness = hot.AggregateFreshness
	wh.AggregateDegradation = hot.AggregateDegradation

	return res, hot, find, wh, cov
}

type dashboardSnapshotSet struct {
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
	helmReleases   HelmReleasesSnapshot
	helmOK         bool
	resourceQuotas ResourceQuotasSnapshot
	quotasOK       bool
	limitRanges    LimitRangesSnapshot
	limitRangesOK  bool
}

func detectDashboardFindings(now time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardFinding {
	var out []ClusterDashboardFinding
	if isEmptyLookingNamespace(s) {
		out = append(out, dashboardFinding("Namespace", ns, "", "medium", 70, "No workload, network, storage, config, or Helm resources in cached snapshots.", "medium", "namespaces"))
	}
	if s.jobsOK {
		for _, j := range EnrichJobListItemsForAPI(s.jobs.Items) {
			if j.NeedsAttention {
				out = append(out, dashboardFinding("Job", ns, j.Name, "high", 90, "Job is failed or has failed attempts.", "high", "jobs"))
				continue
			}
			if j.Status == "Running" && j.AgeSec >= int64((6*time.Hour).Seconds()) {
				out = append(out, dashboardFinding("Job", ns, j.Name, "medium", 62, "Job has been running for more than 6 hours.", "medium", "jobs"))
			}
		}
	}
	if s.cjsOK {
		for _, cj := range EnrichCronJobListItemsForAPI(s.cjs.Items) {
			if cj.NeedsAttention {
				out = append(out, dashboardFinding("CronJob", ns, cj.Name, "high", 88, "CronJob has an unusually large number of active jobs.", "high", "cronjobs"))
				continue
			}
			if !cj.Suspend && cj.AgeSec >= int64((24*time.Hour).Seconds()) && cj.LastSuccessfulTime == 0 {
				out = append(out, dashboardFinding("CronJob", ns, cj.Name, "medium", 60, "CronJob has no successful run recorded after more than 24 hours.", "medium", "cronjobs"))
			}
		}
	}
	if s.helmOK {
		for _, rel := range s.helmReleases.Items {
			if isTransitionalHelmStatus(rel.Status) {
				age := "last update time is unknown"
				stale := rel.Updated == 0
				if rel.Updated > 0 {
					d := now.Sub(time.Unix(rel.Updated, 0))
					stale = d >= 15*time.Minute
					age = "status has been transitional for more than 15 minutes"
				}
				if stale {
					out = append(out, dashboardFinding("HelmRelease", ns, rel.Name, "high", 86, age, "medium", "helm"))
				}
			}
		}
	}
	if s.quotasOK {
		for _, quota := range s.resourceQuotas.Items {
			for _, entry := range quota.Entries {
				if entry.Ratio == nil || *entry.Ratio < 0.8 {
					continue
				}
				severity := "medium"
				score := 68
				if *entry.Ratio >= 0.9 {
					severity = "high"
					score = 92
				}
				out = append(out, dashboardFinding("ResourceQuota", ns, quota.Name, severity, score, "Resource quota "+entry.Key+" is nearing its hard limit.", "high", "namespaces"))
			}
		}
	}
	if s.cmsOK {
		for _, cm := range s.cms.Items {
			if cm.KeysCount == 0 {
				out = append(out, dashboardFinding("ConfigMap", ns, cm.Name, "low", 35, "ConfigMap has no data keys.", "high", "configmaps"))
			}
		}
	}
	if s.secsOK {
		for _, sec := range s.secs.Items {
			if sec.KeysCount == 0 {
				out = append(out, dashboardFinding("Secret", ns, sec.Name, "low", 35, "Secret has no data keys.", "high", "secrets"))
			}
		}
	}
	if s.pvcsOK && s.podsOK && len(s.pods.Items) == 0 {
		for _, pvc := range s.pvcs.Items {
			if pvc.AgeSec >= int64((24 * time.Hour).Seconds()) {
				out = append(out, dashboardFinding("PersistentVolumeClaim", ns, pvc.Name, "low", 30, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "persistentvolumeclaims"))
			}
		}
	}
	if s.sasOK && s.podsOK && len(s.pods.Items) == 0 {
		for _, sa := range s.sas.Items {
			if sa.Name != "default" && sa.AgeSec >= int64((24*time.Hour).Seconds()) {
				out = append(out, dashboardFinding("ServiceAccount", ns, sa.Name, "low", 25, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "serviceaccounts"))
			}
		}
	}
	return out
}

func dashboardFinding(kind, namespace, name, severity string, score int, reason, confidence, section string) ClusterDashboardFinding {
	return ClusterDashboardFinding{
		Kind:       kind,
		Namespace:  namespace,
		Name:       name,
		Severity:   severity,
		Score:      score,
		Reason:     reason,
		Confidence: confidence,
		Section:    section,
	}
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
		len(s.svcs.Items) == 0 &&
		len(s.ings.Items) == 0 &&
		len(s.pvcs.Items) == 0 &&
		nonSystemConfigMapCount(s.cms.Items) == 0 &&
		len(s.secs.Items) == 0 &&
		len(s.helmReleases.Items) == 0 &&
		(!s.quotasOK || len(s.resourceQuotas.Items) == 0) &&
		(!s.limitRangesOK || len(s.limitRanges.Items) == 0)
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

func summarizeDashboardFindings(findings []ClusterDashboardFinding, limit int) ClusterDashboardFindingsPanel {
	if limit <= 0 {
		limit = 10
	}
	sort.Slice(findings, func(i, j int) bool {
		if findings[i].Score != findings[j].Score {
			return findings[i].Score > findings[j].Score
		}
		if findings[i].Namespace != findings[j].Namespace {
			return findings[i].Namespace < findings[j].Namespace
		}
		if findings[i].Kind != findings[j].Kind {
			return findings[i].Kind < findings[j].Kind
		}
		return findings[i].Name < findings[j].Name
	})
	out := ClusterDashboardFindingsPanel{Total: len(findings)}
	for _, f := range findings {
		switch f.Severity {
		case "high":
			out.High++
		case "medium":
			out.Medium++
		default:
			out.Low++
		}
		switch f.Kind {
		case "Namespace":
			out.EmptyNamespaces++
		case "HelmRelease":
			out.StuckHelmReleases++
		case "Job":
			out.AbnormalJobs++
		case "CronJob":
			out.AbnormalCronJobs++
		case "ConfigMap":
			out.EmptyConfigMaps++
		case "Secret":
			out.EmptySecrets++
		case "PersistentVolumeClaim":
			out.PotentiallyUnusedPVCs++
		case "ServiceAccount":
			out.PotentiallyUnusedSAs++
		case "ResourceQuota":
			out.QuotaWarnings++
		}
	}
	if len(findings) > limit {
		out.Top = append(out.Top, findings[:limit]...)
	} else {
		out.Top = append(out.Top, findings...)
	}
	out.Items = append(out.Items, findings...)
	return out
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
