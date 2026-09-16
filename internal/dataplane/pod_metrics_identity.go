package dataplane

import (
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// FilterPodMetricsForInstances selects only samples attributable to the current
// Pod instances before namespace/name indexes discard their identity evidence.
// metrics-server normally omits UID, and its metadata.creationTimestamp is the
// response generation time, NOT pod creation. Only the sample timestamp/window
// may be compared with the actual Pod creation time. AgeSec is a frozen list
// projection and must not be used to reconstruct creation time after Live updates.
func FilterPodMetricsForInstances(pods []dto.PodListItemDTO, samples []dto.PodMetricsDTO, now time.Time) []dto.PodMetricsDTO {
	byKey := make(map[string]dto.PodListItemDTO, len(pods))
	for _, pod := range pods {
		byKey[podMetricsKey(pod.Namespace, pod.Name)] = pod
	}
	var out []dto.PodMetricsDTO
	for _, sample := range samples {
		pod, ok := byKey[podMetricsKey(sample.Namespace, sample.Name)]
		if ok && podMetricsMatchInstance(pod, sample, now) {
			out = append(out, sample)
		}
	}
	return out
}

func podMetricsMatchInstance(pod dto.PodListItemDTO, sample dto.PodMetricsDTO, now time.Time) bool {
	if sample.UID != "" && pod.UID != "" && sample.UID != pod.UID {
		return false
	}
	if sample.CapturedAt < 0 || sample.WindowSec < 0 || sample.CapturedAt > now.Unix() {
		return false
	}
	// Guard subtraction and reject contradictory time evidence even with UID.
	if sample.CapturedAt > 0 {
		if sample.WindowSec > sample.CapturedAt {
			return false
		}
		if pod.CreatedAt > 0 && sample.CapturedAt-sample.WindowSec < pod.CreatedAt {
			return false
		}
	}
	if pod.UID != "" && sample.UID == pod.UID {
		return true
	}
	// Without matching UID, require the entire known interval to follow Pod
	// creation. Strict comparison handles second-granularity truncation safely;
	// an equal boundary or a missing timestamp/window/creation is not proof.
	return pod.CreatedAt > 0 && sample.CapturedAt > 0 && sample.WindowSec > 0 &&
		sample.CapturedAt-sample.WindowSec > pod.CreatedAt
}
