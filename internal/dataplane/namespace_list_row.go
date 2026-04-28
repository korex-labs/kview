package dataplane

import (
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

func buildCachedNamespaceListRowProjection(plane *clusterPlane, namespace string) (dto.NamespaceListItemDTO, bool) {
	if plane == nil || namespace == "" {
		return dto.NamespaceListItemDTO{}, false
	}
	podsSnap, podsOK := plane.podsStore.getCached(namespace)
	depsSnap, depsOK := plane.depsStore.getCached(namespace)
	rqSnap, rqOK := plane.rqStore.getCached(namespace)
	lrSnap, lrOK := plane.lrStore.getCached(namespace)
	if !podsOK && !depsOK && !rqOK && !lrOK {
		return dto.NamespaceListItemDTO{}, false
	}

	var out dto.NamespaceListItemDTO
	out.RowEnriched = true

	var workloadErr *NormalizedError
	workloadMeaningful := 0
	if podsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, podsSnap.Err)
		if podsSnap.Err == nil {
			out.PodCount = len(podsSnap.Items)
			workloadMeaningful += out.PodCount
			severity, count := podSignalsFromList(podsSnap.Items)
			addNamespaceListSignals(&out, severity, count)
		}
	}
	if depsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, depsSnap.Err)
		if depsSnap.Err == nil {
			out.DeploymentCount = len(depsSnap.Items)
			workloadMeaningful += out.DeploymentCount
			severity, count := deploymentSignalsFromList(depsSnap.Items)
			addNamespaceListSignals(&out, severity, count)
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
	finalizeNamespaceListSignals(&out)
	return out, true
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
