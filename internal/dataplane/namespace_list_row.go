package dataplane

import (
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func mergeNamespaceRowInto(dst *dto.NamespaceListItemDTO, src dto.NamespaceListItemDTO) {
	if !src.RowEnriched {
		return
	}
	dst.RowEnriched = src.RowEnriched
	dst.SummaryState = src.SummaryState
	dst.PodCount = src.PodCount
	dst.DeploymentCount = src.DeploymentCount
	dst.ListSignalSeverity = src.ListSignalSeverity
	dst.ListSignalCount = src.ListSignalCount
	dst.ResourceQuotaCount = src.ResourceQuotaCount
	dst.LimitRangeCount = src.LimitRangeCount
	dst.QuotaWarning = src.QuotaWarning
	dst.QuotaCritical = src.QuotaCritical
	dst.QuotaMaxRatio = src.QuotaMaxRatio
}

// buildNamespaceListRowProjection derives row fields from two snapshots (testable).
func buildNamespaceListRowProjection(podsSnap PodsSnapshot, depsSnap DeploymentsSnapshot) dto.NamespaceListItemDTO {
	var out dto.NamespaceListItemDTO
	out.RowEnriched = true

	firstErr := FirstNonNilNormalizedError(podsSnap.Err, depsSnap.Err)

	podCount := 0
	if podsSnap.Err == nil {
		podCount = len(podsSnap.Items)
	}
	depCount := 0
	if depsSnap.Err == nil {
		depCount = len(depsSnap.Items)
	}
	out.PodCount = podCount
	out.DeploymentCount = depCount

	meaningful := 0
	if podsSnap.Err == nil {
		meaningful += podCount
	}
	if depsSnap.Err == nil {
		meaningful += depCount
	}
	out.SummaryState = ProjectionCoarseState(firstErr, meaningful)

	if podsSnap.Err == nil {
		severity, count := podSignalsFromList(podsSnap.Items)
		addNamespaceListSignals(&out, severity, count)
	}
	if depsSnap.Err == nil {
		severity, count := deploymentSignalsFromList(depsSnap.Items)
		addNamespaceListSignals(&out, severity, count)
	}
	finalizeNamespaceListSignals(&out)

	return out
}

type cachedNamespaceListRowSources struct {
	pods   PodsSnapshot
	podsOK bool
	deps   DeploymentsSnapshot
	depsOK bool
	rq     ResourceQuotasSnapshot
	rqOK   bool
	lr     LimitRangesSnapshot
	lrOK   bool
}

func cachedNamespaceListRowSourcesFor(plane *clusterPlane, namespace string) cachedNamespaceListRowSources {
	var sources cachedNamespaceListRowSources
	if plane == nil || namespace == "" {
		return sources
	}
	sources.pods, sources.podsOK = plane.podsStore.getCached(namespace)
	sources.deps, sources.depsOK = plane.depsStore.getCached(namespace)
	sources.rq, sources.rqOK = plane.rqStore.getCached(namespace)
	sources.lr, sources.lrOK = plane.lrStore.getCached(namespace)
	return sources
}

func (sources cachedNamespaceListRowSources) available() bool {
	return sources.podsOK || sources.depsOK || sources.rqOK || sources.lrOK
}

func (sources cachedNamespaceListRowSources) freshness() FreshnessClass {
	metas := make([]SnapshotMetadata, 0, 4)
	normalizedMeta := func(meta SnapshotMetadata) SnapshotMetadata {
		switch meta.Freshness {
		case FreshnessClassHot, FreshnessClassWarm, FreshnessClassCold, FreshnessClassStale, FreshnessClassUnknown:
		default:
			meta.Freshness = FreshnessClassUnknown
		}
		return meta
	}
	if sources.podsOK {
		metas = append(metas, normalizedMeta(sources.pods.Meta))
	}
	if sources.depsOK {
		metas = append(metas, normalizedMeta(sources.deps.Meta))
	}
	if sources.rqOK {
		metas = append(metas, normalizedMeta(sources.rq.Meta))
	}
	if sources.lrOK {
		metas = append(metas, normalizedMeta(sources.lr.Meta))
	}
	return WorstFreshnessFromSnapshots(metas...)
}

func buildCachedNamespaceListRowProjection(plane *clusterPlane, namespace string, policy DataplanePolicy) (dto.NamespaceListItemDTO, bool) {
	if plane == nil || namespace == "" {
		return dto.NamespaceListItemDTO{}, false
	}
	sources := cachedNamespaceListRowSourcesFor(plane, namespace)
	if !sources.available() {
		return dto.NamespaceListItemDTO{}, false
	}
	podsSnap, podsOK := sources.pods, sources.podsOK
	depsSnap, depsOK := sources.deps, sources.depsOK
	rqSnap, rqOK := sources.rq, sources.rqOK
	lrSnap, lrOK := sources.lr, sources.lrOK

	var out dto.NamespaceListItemDTO
	out.RowEnriched = true

	var workloadErr *NormalizedError
	workloadMeaningful := 0
	if podsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, podsSnap.Err)
		if podsSnap.Err == nil {
			out.PodCount = len(podsSnap.Items)
			workloadMeaningful += out.PodCount
		}
	}
	if depsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, depsSnap.Err)
		if depsSnap.Err == nil {
			out.DeploymentCount = len(depsSnap.Items)
			workloadMeaningful += out.DeploymentCount
		}
	}
	if rqOK {
		if rqSnap.Err == nil {
			out.ResourceQuotaCount = len(rqSnap.Items)
			out.QuotaMaxRatio, out.QuotaWarning, out.QuotaCritical = quotaRiskFromSnapshot(rqSnap)
			switch {
			case out.QuotaCritical:
				addNamespaceListSignals(&out, "high", 1)
			case out.QuotaWarning:
				addNamespaceListSignals(&out, "medium", 1)
			}
		}
	}
	if lrOK {
		if lrSnap.Err == nil {
			out.LimitRangeCount = len(lrSnap.Items)
		}
	}
	out.SummaryState = ProjectionCoarseState(workloadErr, workloadMeaningful)
	if severity, count := namespaceDashboardSignalSummary(plane, namespace, policy); count > 0 {
		out.ListSignalSeverity = severity
		out.ListSignalCount = count
	}
	finalizeNamespaceListSignals(&out)
	return out, true
}

func namespaceDashboardSignalSummary(plane *clusterPlane, namespace string, policy DataplanePolicy) (string, int) {
	thresholds := signalThresholdsFromPolicy(policy)
	set := buildSnapshotSetForNamespace(plane, namespace, thresholds)
	rawSignals := detectDashboardSignals(time.Now(), namespace, set)
	namespaceSnapshot, _ := peekClusterSnapshot(&plane.nsStore)
	rawSignals = enrichSignalsFromMetadataIndex(rawSignals, namespaceSignalMetadataIndex(namespaceSnapshot))
	signals := applySignalPolicy(rawSignals, policy, plane.name)
	severity := listSignalOK
	count := 0
	for _, signal := range signals {
		addSeverityCount(&severity, &count, signal.Severity, 1)
	}
	return severity, count
}

func quotaRiskFromSnapshot(snap ResourceQuotasSnapshot) (maxRatio float64, warning bool, critical bool) {
	for _, quota := range snap.Items {
		for _, entry := range quota.Entries {
			if entry.Ratio == nil {
				continue
			}
			ratio := *entry.Ratio
			if ratio > maxRatio {
				maxRatio = ratio
			}
			if ratio >= quotaCritRatio {
				critical = true
				warning = true
				continue
			}
			if ratio >= quotaWarnRatio {
				warning = true
			}
		}
	}
	return maxRatio, warning, critical
}

func podSignalsFromList(items []dto.PodListItemDTO) (string, int) {
	severity := listSignalOK
	count := 0
	for _, p := range EnrichPodListItemsForAPI(items) {
		addSeverityCount(&severity, &count, p.ListSignalSeverity, p.ListSignalCount)
	}
	return severity, count
}

func deploymentSignalsFromList(items []dto.DeploymentListItemDTO) (string, int) {
	severity := listSignalOK
	count := 0
	for _, d := range EnrichDeploymentListItemsForAPI(items) {
		addSeverityCount(&severity, &count, d.ListSignalSeverity, d.ListSignalCount)
	}
	return severity, count
}

func addNamespaceListSignals(out *dto.NamespaceListItemDTO, severity string, count int) {
	addSeverityCount(&out.ListSignalSeverity, &out.ListSignalCount, severity, count)
}

func addSeverityCount(dstSeverity *string, dstCount *int, severity string, count int) {
	if count <= 0 || severity == "" || severity == listSignalOK {
		return
	}
	if signalSeverityRank(severity) > signalSeverityRank(*dstSeverity) {
		*dstSeverity = severity
	}
	*dstCount += count
}

func finalizeNamespaceListSignals(out *dto.NamespaceListItemDTO) {
	if out.ListSignalSeverity == "" {
		out.ListSignalSeverity = listSignalOK
	}
}

func signalSeverityRank(severity string) int {
	switch severity {
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}
