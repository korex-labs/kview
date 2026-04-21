// Package metrics fetches live resource usage samples from the
// metrics.k8s.io/v1beta1 API (metrics-server) and maps them into the
// dataplane DTOs. The package owns only list reads; snapshot lifecycle,
// caching, and capability learning stay in the dataplane layer.
package metrics

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

// MetricsAPIGroup is the discovery group name for metrics-server.
const MetricsAPIGroup = "metrics.k8s.io"

// ListPodMetrics returns per-container usage for every pod visible in the
// namespace. Pass "" for cluster-scoped listing.
func ListPodMetrics(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.PodMetricsDTO, error) {
	client, err := c.MetricsClient()
	if err != nil {
		return nil, err
	}
	list, err := client.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]dto.PodMetricsDTO, 0, len(list.Items))
	for _, pm := range list.Items {
		out = append(out, mapPodMetrics(pm))
	}
	return out, nil
}

// ListNodeMetrics returns per-node usage for every node visible to the caller.
func ListNodeMetrics(ctx context.Context, c *cluster.Clients) ([]dto.NodeMetricsDTO, error) {
	client, err := c.MetricsClient()
	if err != nil {
		return nil, err
	}
	list, err := client.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]dto.NodeMetricsDTO, 0, len(list.Items))
	for _, nm := range list.Items {
		out = append(out, mapNodeMetrics(nm))
	}
	return out, nil
}

// DetectMetricsAPI reports whether metrics.k8s.io is registered in cluster
// discovery. This distinguishes "not installed" from "RBAC denied" so the UI
// can render a precise hint when metrics are unavailable. Errors from
// discovery itself are returned so the caller can classify them (e.g.
// connectivity vs unauthorized).
func DetectMetricsAPI(ctx context.Context, c *cluster.Clients) (bool, error) {
	if c == nil || c.Discovery == nil {
		return false, fmt.Errorf("discovery client unavailable")
	}
	_ = ctx
	groups, err := c.Discovery.ServerGroups()
	if err != nil {
		return false, err
	}
	if groups == nil {
		return false, nil
	}
	for _, g := range groups.Groups {
		if g.Name == MetricsAPIGroup {
			return true, nil
		}
	}
	return false, nil
}

func mapPodMetrics(pm metricsv1beta1.PodMetrics) dto.PodMetricsDTO {
	containers := make([]dto.ContainerMetricsDTO, 0, len(pm.Containers))
	for _, cm := range pm.Containers {
		cpu, mem := cpuAndMemoryFromUsage(cm.Usage)
		containers = append(containers, dto.ContainerMetricsDTO{
			Name:        cm.Name,
			CPUMilli:    cpu,
			MemoryBytes: mem,
		})
	}
	return dto.PodMetricsDTO{
		Name:       pm.Name,
		Namespace:  pm.Namespace,
		WindowSec:  durationSeconds(pm.Window.Duration),
		CapturedAt: pm.Timestamp.Unix(),
		Containers: containers,
	}
}

func mapNodeMetrics(nm metricsv1beta1.NodeMetrics) dto.NodeMetricsDTO {
	cpu, mem := cpuAndMemoryFromUsage(nm.Usage)
	return dto.NodeMetricsDTO{
		Name:        nm.Name,
		WindowSec:   durationSeconds(nm.Window.Duration),
		CapturedAt:  nm.Timestamp.Unix(),
		CPUMilli:    cpu,
		MemoryBytes: mem,
	}
}

// cpuAndMemoryFromUsage extracts canonical milliCPU and byte values from a
// metrics-server usage map. The metrics API always reports ResourceCPU and
// ResourceMemory; missing keys collapse to zero.
func cpuAndMemoryFromUsage(usage corev1.ResourceList) (cpuMilli int64, memoryBytes int64) {
	if cpu, ok := usage[corev1.ResourceCPU]; ok {
		cpuMilli = cpu.MilliValue()
	}
	if mem, ok := usage[corev1.ResourceMemory]; ok {
		memoryBytes = mem.Value()
	}
	return
}

func durationSeconds(d time.Duration) int64 {
	if d <= 0 {
		return 0
	}
	return int64(d.Seconds())
}
