package pods

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
)

func ListPods(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.PodListItemDTO, error) {
	pods, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	latestEvents, _ := kubeevents.LatestEventsByObject(ctx, c, namespace, "Pod")

	now := time.Now()
	out := make([]dto.PodListItemDTO, 0, len(pods.Items))
	for _, p := range pods.Items {
		var lastEvent *dto.EventBriefDTO
		if ev, ok := latestEvents[p.Name]; ok {
			evCopy := ev
			lastEvent = &evCopy
		}
		var readyCount, totalCount int
		var restarts int32

		for _, cs := range p.Status.ContainerStatuses {
			totalCount++
			if cs.Ready {
				readyCount++
			}
			restarts += cs.RestartCount
		}

		age := int64(0)
		if !p.CreationTimestamp.IsZero() {
			age = int64(now.Sub(p.CreationTimestamp.Time).Seconds())
		}

		cpuReq, cpuLim, memReq, memLim := sumContainerResources(p.Spec.Containers)
		out = append(out, dto.PodListItemDTO{
			Name:               p.Name,
			Namespace:          p.Namespace,
			Node:               p.Spec.NodeName,
			Phase:              string(p.Status.Phase),
			Ready:              FmtReady(readyCount, totalCount),
			Restarts:           restarts,
			AgeSec:             age,
			LastEvent:          lastEvent,
			HealthReason:       podHealthReason(p.Status.Conditions),
			CPURequestMilli:    cpuReq,
			CPULimitMilli:      cpuLim,
			MemoryRequestBytes: memReq,
			MemoryLimitBytes:   memLim,
		})
	}
	return out, nil
}

func podHealthReason(conditions []corev1.PodCondition) string {
	for _, cond := range conditions {
		if cond.Status != corev1.ConditionTrue && cond.Reason != "" {
			return cond.Reason
		}
	}
	return ""
}

// sumContainerResources aggregates CPU (milli) and memory (bytes) requests and
// limits across a pod's containers. Missing values contribute 0; the resulting
// totals represent pod-level request/limit anchors used by downstream
// percent-of-limit calculations.
func sumContainerResources(containers []corev1.Container) (cpuReq, cpuLim, memReq, memLim int64) {
	for _, c := range containers {
		if q, ok := c.Resources.Requests[corev1.ResourceCPU]; ok {
			cpuReq += q.MilliValue()
		}
		if q, ok := c.Resources.Limits[corev1.ResourceCPU]; ok {
			cpuLim += q.MilliValue()
		}
		if q, ok := c.Resources.Requests[corev1.ResourceMemory]; ok {
			memReq += q.Value()
		}
		if q, ok := c.Resources.Limits[corev1.ResourceMemory]; ok {
			memLim += q.Value()
		}
	}
	return
}

func FmtReady(ready, total int) string {
	if total == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d/%d", ready, total)
}
