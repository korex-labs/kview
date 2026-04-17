package dataplane

import (
	"strconv"
	"strings"

	"kview/internal/kube/dto"
)

func mergeNamespaceRowInto(dst *dto.NamespaceListItemDTO, src dto.NamespaceListItemDTO) {
	if !src.RowEnriched {
		return
	}
	dst.RowEnriched = src.RowEnriched
	dst.SummaryState = src.SummaryState
	dst.PodCount = src.PodCount
	dst.DeploymentCount = src.DeploymentCount
	dst.ProblematicCount = src.ProblematicCount
	dst.PodsWithRestarts = src.PodsWithRestarts
	dst.RestartSignal = src.RestartSignal
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

	var probPods []dto.ProblematicResource
	if podsSnap.Err == nil {
		probPods = podProblematicFromListUnbounded(podsSnap.Items)
	}
	var probDeps []dto.ProblematicResource
	if depsSnap.Err == nil {
		probDeps = deploymentProblematicListUnbounded(depsSnap.Items)
	}
	out.ProblematicCount = countUniqueProblematic(probPods, probDeps)

	if podsSnap.Err == nil {
		var withRestarts int
		restartSignal := false
		for _, p := range podsSnap.Items {
			if p.Restarts > 0 {
				withRestarts++
			}
			switch ListRestartSeverity(p.Restarts) {
			case listRestartMedium, listRestartHigh:
				restartSignal = true
			}
		}
		out.PodsWithRestarts = withRestarts
		out.RestartSignal = restartSignal
	}

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
	var probPods []dto.ProblematicResource
	var probDeps []dto.ProblematicResource
	if podsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, podsSnap.Err)
		if podsSnap.Err == nil {
			out.PodCount = len(podsSnap.Items)
			workloadMeaningful += out.PodCount
			probPods = podProblematicFromListUnbounded(podsSnap.Items)
			for _, p := range podsSnap.Items {
				if p.Restarts > 0 {
					out.PodsWithRestarts++
				}
				switch ListRestartSeverity(p.Restarts) {
				case listRestartMedium, listRestartHigh:
					out.RestartSignal = true
				}
			}
		}
	}
	if depsOK {
		workloadErr = FirstNonNilNormalizedError(workloadErr, depsSnap.Err)
		if depsSnap.Err == nil {
			out.DeploymentCount = len(depsSnap.Items)
			workloadMeaningful += out.DeploymentCount
			probDeps = deploymentProblematicListUnbounded(depsSnap.Items)
		}
	}
	if rqOK {
		if rqSnap.Err == nil {
			out.ResourceQuotaCount = len(rqSnap.Items)
			out.QuotaMaxRatio, out.QuotaWarning, out.QuotaCritical = quotaRiskFromSnapshot(rqSnap)
		}
	}
	if lrOK {
		if lrSnap.Err == nil {
			out.LimitRangeCount = len(lrSnap.Items)
		}
	}
	out.ProblematicCount = countUniqueProblematic(probPods, probDeps, nil)
	out.SummaryState = ProjectionCoarseState(workloadErr, workloadMeaningful)
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
			if ratio >= 0.9 {
				critical = true
				warning = true
				continue
			}
			if ratio >= 0.8 {
				warning = true
			}
		}
	}
	return maxRatio, warning, critical
}

func podProblematicFromListUnbounded(items []dto.PodListItemDTO) []dto.ProblematicResource {
	var out []dto.ProblematicResource
	for _, p := range items {
		isProblematic := false
		reason := p.Phase
		if p.Phase == "Failed" || p.Phase == "Pending" {
			isProblematic = true
		} else if p.Ready != "" {
			if parts := strings.Split(p.Ready, "/"); len(parts) == 2 {
				if ready, err1 := strconv.Atoi(parts[0]); err1 == nil {
					if total, err2 := strconv.Atoi(parts[1]); err2 == nil && total > 0 && ready < total {
						isProblematic = true
						reason = "NotReady"
					}
				}
			}
		}
		if p.Restarts >= 10 {
			isProblematic = true
			reason = "HighRestarts"
		}
		if isProblematic {
			if p.LastEvent != nil && p.LastEvent.Reason != "" {
				reason = p.LastEvent.Reason
			}
			out = append(out, dto.ProblematicResource{Kind: "Pod", Name: p.Name, Reason: reason})
		}
	}
	return out
}

func deploymentProblematicListUnbounded(deployments []dto.DeploymentListItemDTO) []dto.ProblematicResource {
	var out []dto.ProblematicResource
	for _, d := range deployments {
		if d.Status != "Available" && d.UpToDate > 0 && d.Available < d.UpToDate {
			reason := d.Status
			if d.LastEvent != nil && d.LastEvent.Reason != "" {
				reason = d.LastEvent.Reason
			}
			out = append(out, dto.ProblematicResource{Kind: "Deployment", Name: d.Name, Reason: reason})
		}
	}
	return out
}

func countUniqueProblematic(parts ...[]dto.ProblematicResource) int {
	seen := make(map[string]struct{})
	for _, part := range parts {
		for _, pr := range part {
			key := pr.Kind + "\x00" + pr.Name
			seen[key] = struct{}{}
		}
	}
	return len(seen)
}
