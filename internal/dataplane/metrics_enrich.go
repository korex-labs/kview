package dataplane

import (
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// PodMetricsByKey maps "namespace/name" to a compact container usage map for a
// single pod. Callers build this once per list or detail request and pass it
// into the enrich helpers. Keeping the index separate keeps the existing
// EnrichPodListItemsForAPI / EnrichNodeListItemsForAPI signatures stable for
// tests and existing callers.
type PodMetricsByKey map[string]map[string]dto.ContainerMetricsDTO

// BuildPodMetricsIndex transforms a namespace's worth of PodMetricsDTO rows
// into a key→(container→usage) map. Containers are keyed by container name
// because pod + container together identify each sample from metrics-server.
func BuildPodMetricsIndex(items []dto.PodMetricsDTO) PodMetricsByKey {
	if len(items) == 0 {
		return nil
	}
	out := make(PodMetricsByKey, len(items))
	for _, pm := range items {
		key := podMetricsKey(pm.Namespace, pm.Name)
		byContainer := make(map[string]dto.ContainerMetricsDTO, len(pm.Containers))
		for _, cm := range pm.Containers {
			byContainer[cm.Name] = cm
		}
		out[key] = byContainer
	}
	return out
}

func podMetricsKey(namespace, name string) string {
	return namespace + "/" + name
}

// NodeMetricsByName indexes cluster-scoped node usage samples by node name.
type NodeMetricsByName map[string]dto.NodeMetricsDTO

// BuildNodeMetricsIndex creates a node-name→usage map for easy merging.
func BuildNodeMetricsIndex(items []dto.NodeMetricsDTO) NodeMetricsByName {
	if len(items) == 0 {
		return nil
	}
	out := make(NodeMetricsByName, len(items))
	for _, nm := range items {
		out[nm.Name] = nm
	}
	return out
}

// EnrichPodListItemsWithMetrics applies the standard list enrichment and
// additionally merges aggregated CPU/memory usage and percent-of-request/limit
// fields from a pod metrics index. Percentages are computed against the
// pod-level totals populated at list time (CPURequestMilli/CPULimitMilli/
// MemoryRequestBytes/MemoryLimitBytes). Rows without matching metrics are
// unchanged.
func EnrichPodListItemsWithMetrics(items []dto.PodListItemDTO, metrics PodMetricsByKey) []dto.PodListItemDTO {
	enriched := EnrichPodListItemsForAPI(items)
	if len(metrics) == 0 || len(enriched) == 0 {
		return enriched
	}
	for i := range enriched {
		row := enriched[i]
		containers, ok := metrics[podMetricsKey(row.Namespace, row.Name)]
		if !ok {
			continue
		}
		var totalCPU, totalMem int64
		for _, cm := range containers {
			totalCPU += cm.CPUMilli
			totalMem += cm.MemoryBytes
		}
		row.CPUMilli = totalCPU
		row.MemoryBytes = totalMem
		row.UsageAvailable = true
		row.CPUPctRequest = percentOfMilli(totalCPU, row.CPURequestMilli)
		row.CPUPctLimit = percentOfMilli(totalCPU, row.CPULimitMilli)
		row.MemoryPctReq = percentOfBytes(totalMem, row.MemoryRequestBytes)
		row.MemoryPctLimit = percentOfBytes(totalMem, row.MemoryLimitBytes)
		enriched[i] = row
	}
	return enriched
}

// EnrichPodListItemsWithSignalSummary applies backend pod signal detectors to
// list rows and sets ListSignalSeverity/ListSignalCount from detected signals:
// highest severity + total signal count per pod.
//
// This keeps UI list chips aligned with backend-derived signals (same source
// as per-resource signals endpoint) and avoids client-side warning heuristics.
func EnrichPodListItemsWithSignalSummary(items []dto.PodListItemDTO, namespace string, podMetricsItems []dto.PodMetricsDTO, policy DataplanePolicy, now time.Time) []dto.PodListItemDTO {
	if len(items) == 0 {
		return items
	}
	if now.IsZero() {
		now = time.Now()
	}
	set := dashboardSnapshotSet{
		podsOK:                true,
		pods:                  PodsSnapshot{Items: items},
		restartThreshold:      int32(policy.Signals.Detectors.PodRestarts.RestartCount),
		containerNearLimitPct: policy.Signals.Detectors.ContainerNearLimit.Percent,
	}
	if len(podMetricsItems) > 0 {
		set.podMetricsOK = true
		set.podMetrics = PodMetricsSnapshot{Items: podMetricsItems}
	}
	signals := detectDashboardSignals(now, namespace, set)
	if len(signals) == 0 {
		out := append([]dto.PodListItemDTO(nil), items...)
		for i := range out {
			out[i].ListSignalSeverity = listSignalOK
			out[i].ListSignalCount = 0
		}
		return out
	}
	type podSignalSummary struct {
		severity string
		count    int
	}
	byPod := make(map[string]podSignalSummary, len(items))
	for _, signal := range signals {
		if signal.ResourceKind != "Pod" || signal.ResourceName == "" {
			continue
		}
		sum := byPod[signal.ResourceName]
		addSeverityCount(&sum.severity, &sum.count, signal.Severity, 1)
		byPod[signal.ResourceName] = sum
	}
	out := append([]dto.PodListItemDTO(nil), items...)
	for i := range out {
		sum, ok := byPod[out[i].Name]
		if !ok || sum.count <= 0 {
			out[i].ListSignalSeverity = listSignalOK
			out[i].ListSignalCount = 0
			continue
		}
		if sum.severity == "" {
			sum.severity = listSignalOK
		}
		out[i].ListSignalSeverity = sum.severity
		out[i].ListSignalCount = sum.count
	}
	return out
}

// EnrichNodeListItemsWithMetrics merges per-node CPU/memory usage and
// percentages-vs-allocatable into an already-enriched list. It uses
// NodeListItemDTO.CPUAllocatable / MemoryAllocatable as the denominator to
// avoid re-reading the node API.
func EnrichNodeListItemsWithMetrics(items []dto.NodeListItemDTO, metrics NodeMetricsByName) []dto.NodeListItemDTO {
	enriched := EnrichNodeListItemsForAPI(items)
	if len(metrics) == 0 || len(enriched) == 0 {
		return enriched
	}
	for i := range enriched {
		row := enriched[i]
		nm, ok := metrics[row.Name]
		if !ok {
			continue
		}
		row.CPUMilli = nm.CPUMilli
		row.MemoryBytes = nm.MemoryBytes
		row.UsageAvailable = true
		if cpuAlloc := parseCPUMilli(row.CPUAllocatable); cpuAlloc > 0 {
			row.CPUPctAlloc = percentOfMilli(nm.CPUMilli, cpuAlloc)
		}
		if memAlloc := parseMemoryBytes(row.MemoryAllocatable); memAlloc > 0 {
			row.MemoryPctAlloc = percentOfBytes(nm.MemoryBytes, memAlloc)
		}
		enriched[i] = row
	}
	return enriched
}

// MergeNodeDetailsUsage overlays per-node usage onto an already-fetched
// NodeDetailsDTO using a freshly-received node metrics snapshot. The merge
// uses node-name comparison and is a no-op when no matching sample exists,
// so the detail handler can call it unconditionally regardless of metrics
// availability.
func MergeNodeDetailsUsage(det *dto.NodeDetailsDTO, items []dto.NodeMetricsDTO) {
	if det == nil || len(items) == 0 {
		return
	}
	name := det.Summary.Name
	for _, nm := range items {
		if nm.Name != name {
			continue
		}
		det.Capacity.CPUMilliUsed = nm.CPUMilli
		det.Capacity.MemoryBytesUsed = nm.MemoryBytes
		det.Capacity.UsageAvailable = true
		if cpuAlloc := parseCPUMilli(det.Capacity.CPUAllocatable); cpuAlloc > 0 {
			det.Capacity.CPUPctAlloc = percentOfMilli(nm.CPUMilli, cpuAlloc)
		}
		if memAlloc := parseMemoryBytes(det.Capacity.MemoryAllocatable); memAlloc > 0 {
			det.Capacity.MemoryPctAlloc = percentOfBytes(nm.MemoryBytes, memAlloc)
		}
		return
	}
}

// MergePodDetailsUsage overlays per-container usage onto an already-fetched
// PodDetailsDTO using a freshly-received pod metrics snapshot. The merge
// walks metrics items rather than allocating an index because the caller has
// only one pod of interest and the lists are short.
func MergePodDetailsUsage(det *dto.PodDetailsDTO, items []dto.PodMetricsDTO) {
	if det == nil || len(items) == 0 {
		return
	}
	key := podMetricsKey(det.Summary.Namespace, det.Summary.Name)
	for _, pm := range items {
		if podMetricsKey(pm.Namespace, pm.Name) != key {
			continue
		}
		usageByContainer := make(map[string]dto.ContainerMetricsDTO, len(pm.Containers))
		for _, cm := range pm.Containers {
			usageByContainer[cm.Name] = cm
		}
		for i := range det.Containers {
			c := det.Containers[i]
			cu, ok := usageByContainer[c.Name]
			if !ok {
				continue
			}
			usage := dto.ContainerUsageDTO{
				CPUMilli:    cu.CPUMilli,
				MemoryBytes: cu.MemoryBytes,
			}
			if cpuReq := parseCPUMilli(c.Resources.CPURequest); cpuReq > 0 {
				usage.CPUPctRequest = percentOfMilli(cu.CPUMilli, cpuReq)
			}
			if cpuLimit := parseCPUMilli(c.Resources.CPULimit); cpuLimit > 0 {
				usage.CPUPctLimit = percentOfMilli(cu.CPUMilli, cpuLimit)
			}
			if memReq := parseMemoryBytes(c.Resources.MemoryRequest); memReq > 0 {
				usage.MemoryPctReq = percentOfBytes(cu.MemoryBytes, memReq)
			}
			if memLimit := parseMemoryBytes(c.Resources.MemoryLimit); memLimit > 0 {
				usage.MemoryPctLimit = percentOfBytes(cu.MemoryBytes, memLimit)
			}
			c.Usage = &usage
			det.Containers[i] = c
		}
		return
	}
}

// parseCPUMilli parses a k8s Quantity (e.g. "100m", "1.5", "250") into milliCPU.
// Returns 0 on parse failure or empty input; callers that need to differentiate
// "unset" from "zero" should check the input string first.
func parseCPUMilli(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0
	}
	return q.MilliValue()
}

// parseMemoryBytes parses a k8s Quantity (e.g. "128Mi", "1Gi") into bytes.
func parseMemoryBytes(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0
	}
	return q.Value()
}

// percentOfMilli computes 100 * usage / spec with guardrails.
// Callers use the zero return to signal "no percent available"; an absent
// spec (0) suppresses the output and any caller using omitempty JSON tags
// will therefore drop the percent field.
func percentOfMilli(usageMilli, specMilli int64) float64 {
	if specMilli <= 0 {
		return 0
	}
	return 100.0 * float64(usageMilli) / float64(specMilli)
}

func percentOfBytes(usageBytes, specBytes int64) float64 {
	if specBytes <= 0 {
		return 0
	}
	return 100.0 * float64(usageBytes) / float64(specBytes)
}
