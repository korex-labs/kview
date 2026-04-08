package dataplane

import (
	"math"
	"sort"

	"kview/internal/kube/dto"
)

const (
	defaultRestartHotspotLimit = 15
	// Restart severity is a coarse operator hint, not predictive analytics.
	restartSeverityHigh   = "high"
	restartSeverityMedium = "medium"
	restartSeverityLow    = "low"
)

// RestartHotspotsProjection is a bounded, sorted list of restart-heavy pods from a pods snapshot.
type RestartHotspotsProjection struct {
	Items []dto.PodRestartHotspotDTO
	// SourceMeta is the backing pods snapshot metadata (caller may compose with others).
	SourceMeta SnapshotMetadata
}

// restartSeverityFromCount maps restart counts to coarse severity buckets.
func restartSeverityFromCount(restarts int32) string {
	switch {
	case restarts >= 20:
		return restartSeverityHigh
	case restarts >= 5:
		return restartSeverityMedium
	default:
		return restartSeverityLow
	}
}

// ProjectRestartHotspotsFromPods builds restart hotspots for one namespace from a pods snapshot.
// Pods with zero restarts are omitted. Results are sorted by restarts descending, then name.
func ProjectRestartHotspotsFromPods(namespace string, snap PodsSnapshot, limit int) RestartHotspotsProjection {
	if limit <= 0 {
		limit = defaultRestartHotspotLimit
	}
	out := RestartHotspotsProjection{SourceMeta: snap.Meta}

	candidates := make([]dto.PodListItemDTO, 0, len(snap.Items))
	for _, p := range snap.Items {
		if p.Restarts > 0 {
			candidates = append(candidates, p)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Restarts != candidates[j].Restarts {
			return candidates[i].Restarts > candidates[j].Restarts
		}
		return candidates[i].Name < candidates[j].Name
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}

	items := make([]dto.PodRestartHotspotDTO, 0, len(candidates))
	for _, p := range candidates {
		reason := ""
		if p.LastEvent != nil {
			reason = p.LastEvent.Reason
		}
		items = append(items, dto.PodRestartHotspotDTO{
			Namespace:         namespace,
			Name:              p.Name,
			Restarts:          p.Restarts,
			RestartRatePerDay: restartRatePerDay(p.Restarts, p.AgeSec),
			Phase:             p.Phase,
			Node:              p.Node,
			LastEventReason:   reason,
			Severity:          restartSeverityFromCount(p.Restarts),
		})
	}
	out.Items = items
	return out
}

// MergeRestartHotspots combines multiple namespace hotspot lists, sorts globally by restarts, truncates.
func MergeRestartHotspots(limit int, lists ...[]dto.PodRestartHotspotDTO) []dto.PodRestartHotspotDTO {
	if limit <= 0 {
		limit = defaultRestartHotspotLimit
	}
	var all []dto.PodRestartHotspotDTO
	for _, l := range lists {
		all = append(all, l...)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Restarts != all[j].Restarts {
			return all[i].Restarts > all[j].Restarts
		}
		if all[i].Namespace != all[j].Namespace {
			return all[i].Namespace < all[j].Namespace
		}
		return all[i].Name < all[j].Name
	})
	if len(all) > limit {
		all = all[:limit]
	}
	return all
}

// CountPodsWithRestartThreshold returns how many pods have restarts >= threshold.
func CountPodsWithRestartThreshold(snap PodsSnapshot, threshold int32) int {
	n := int32(0)
	for _, p := range snap.Items {
		if p.Restarts >= threshold {
			n++
		}
	}
	return int(n)
}

func restartRatePerDay(restarts int32, ageSec int64) float64 {
	if restarts <= 0 || ageSec <= 0 {
		return 0
	}
	rate := float64(restarts) * 86400 / float64(ageSec)
	return math.Round(rate*10) / 10
}
