package dataplane

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"

	"kview/internal/kube/dto"
)

const (
	// namespaceListRowProjectionCap limits how many namespaces receive per-row pod/deployment
	// snapshot work on a single list request (alphabetical priority). Others omit row fields.
	namespaceListRowProjectionCap = 64
	namespaceListRowParallel      = 8
)

// EnrichNamespaceListItems attaches bounded per-row metrics from dataplane pods and deployments
// snapshots. No direct kube calls outside snapshot executors. Order of items is preserved.
func (m *manager) EnrichNamespaceListItems(ctx context.Context, clusterName string, items []dto.NamespaceListItemDTO) ([]dto.NamespaceListItemDTO, dto.NamespaceListRowProjectionMetaDTO) {
	meta := dto.NamespaceListRowProjectionMetaDTO{
		TotalRows: len(items),
		Cap:       namespaceListRowProjectionCap,
	}
	if len(items) == 0 {
		return items, meta
	}

	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return items, meta
	}
	plane := planeAny.(*clusterPlane)

	names := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, it := range items {
		if it.Name == "" {
			continue
		}
		if _, ok := seen[it.Name]; ok {
			continue
		}
		seen[it.Name] = struct{}{}
		names = append(names, it.Name)
	}
	sort.Strings(names)

	k := namespaceListRowProjectionCap
	if k > len(names) {
		k = len(names)
	}
	enrichNames := names[:k]
	meta.EnrichedRows = k
	if k < len(names) {
		meta.Note = "Row workload metrics (pods/deployments) are computed for the first namespaces alphabetically up to the cap; refresh or open a namespace for full detail."
	}

	type row struct {
		metrics dto.NamespaceListItemDTO
	}
	rows := make(map[string]row, len(enrichNames))
	var mu sync.Mutex

	sem := make(chan struct{}, namespaceListRowParallel)
	g, gctx := errgroup.WithContext(ctx)

	for _, ns := range enrichNames {
		ns := ns
		g.Go(func() error {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			podsSnap, _ := plane.PodsSnapshot(gctx, m.scheduler, m.clients, ns)
			depsSnap, _ := plane.DeploymentsSnapshot(gctx, m.scheduler, m.clients, ns)
			metrics := buildNamespaceListRowProjection(podsSnap, depsSnap)

			mu.Lock()
			rows[ns] = row{metrics: metrics}
			mu.Unlock()
			return nil
		})
	}

	_ = g.Wait()

	out := make([]dto.NamespaceListItemDTO, len(items))
	for i := range items {
		out[i] = items[i]
		if r, ok := rows[items[i].Name]; ok {
			mergeNamespaceRowInto(&out[i], r.metrics)
		}
	}
	return out, meta
}

func mergeNamespaceRowInto(dst *dto.NamespaceListItemDTO, src dto.NamespaceListItemDTO) {
	dst.RowEnriched = src.RowEnriched
	dst.SummaryState = src.SummaryState
	dst.PodCount = src.PodCount
	dst.DeploymentCount = src.DeploymentCount
	dst.ProblematicCount = src.ProblematicCount
	dst.PodsWithRestarts = src.PodsWithRestarts
	dst.RestartHotspot = src.RestartHotspot
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
		hotspot := false
		for _, p := range podsSnap.Items {
			if p.Restarts > 0 {
				withRestarts++
			}
			switch ListRestartSeverity(p.Restarts) {
			case listRestartMedium, listRestartHigh:
				hotspot = true
			}
		}
		out.PodsWithRestarts = withRestarts
		out.RestartHotspot = hotspot
	}

	return out
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
