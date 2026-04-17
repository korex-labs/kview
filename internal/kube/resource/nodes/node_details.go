package nodes

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
	kubepods "github.com/alex-mamchenkov/kview/internal/kube/resource/pods"
)

func GetNodeDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.NodeDetailsDTO, error) {
	node, err := c.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// YAML
	nodeCopy := node.DeepCopy()
	nodeCopy.ManagedFields = nil
	b, err := json.Marshal(nodeCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	if !node.CreationTimestamp.IsZero() {
		createdAt = node.CreationTimestamp.Unix()
		age = int64(now.Sub(node.CreationTimestamp.Time).Seconds())
	}

	summary := dto.NodeSummaryDTO{
		Name:           node.Name,
		Status:         nodeReadyStatus(node.Status.Conditions),
		Roles:          deriveNodeRoles(node.Labels),
		KubeletVersion: node.Status.NodeInfo.KubeletVersion,
		OSImage:        node.Status.NodeInfo.OSImage,
		KernelVersion:  node.Status.NodeInfo.KernelVersion,
		Architecture:   node.Status.NodeInfo.Architecture,
		ProviderID:     node.Spec.ProviderID,
		CreatedAt:      createdAt,
		AgeSec:         age,
	}

	conditions := mapNodeConditions(node.Status.Conditions)

	capacity := dto.NodeCapacityDTO{
		CPUCapacity:       kubepods.QuantityString(node.Status.Capacity[corev1.ResourceCPU]),
		CPUAllocatable:    kubepods.QuantityString(node.Status.Allocatable[corev1.ResourceCPU]),
		MemoryCapacity:    kubepods.QuantityString(node.Status.Capacity[corev1.ResourceMemory]),
		MemoryAllocatable: kubepods.QuantityString(node.Status.Allocatable[corev1.ResourceMemory]),
		PodsCapacity:      kubepods.QuantityString(node.Status.Capacity[corev1.ResourcePods]),
		PodsAllocatable:   kubepods.QuantityString(node.Status.Allocatable[corev1.ResourcePods]),
	}

	taints := make([]dto.NodeTaintDTO, 0, len(node.Spec.Taints))
	for _, t := range node.Spec.Taints {
		taints = append(taints, dto.NodeTaintDTO{
			Key:    t.Key,
			Value:  t.Value,
			Effect: string(t.Effect),
		})
	}

	pods := []dto.NodePodDTO{}
	if podList, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + node.Name,
	}); err == nil {
		pods = mapNodePods(podList.Items)
	}

	return &dto.NodeDetailsDTO{
		Summary: summary,
		Metadata: dto.NodeMetadataDTO{
			Labels:      node.Labels,
			Annotations: node.Annotations,
		},
		Conditions: conditions,
		Capacity:   capacity,
		Taints:     taints,
		Pods:       pods,
		LinkedPods: dto.NodePodsSummaryDTO{Total: len(pods)},
		YAML:       string(y),
	}, nil
}

func mapNodeConditions(conds []corev1.NodeCondition) []dto.NodeConditionDTO {
	ordered := []corev1.NodeConditionType{
		corev1.NodeReady,
		corev1.NodeMemoryPressure,
		corev1.NodeDiskPressure,
		corev1.NodePIDPressure,
		corev1.NodeNetworkUnavailable,
	}
	byType := map[corev1.NodeConditionType]corev1.NodeCondition{}
	for _, c := range conds {
		byType[c.Type] = c
	}

	out := make([]dto.NodeConditionDTO, 0, len(ordered))
	for _, t := range ordered {
		c, ok := byType[t]
		if !ok {
			continue
		}
		lt := int64(0)
		if !c.LastTransitionTime.IsZero() {
			lt = c.LastTransitionTime.Unix()
		}
		out = append(out, dto.NodeConditionDTO{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: lt,
		})
	}
	return out
}

func mapNodePods(items []corev1.Pod) []dto.NodePodDTO {
	now := time.Now()
	out := make([]dto.NodePodDTO, 0, len(items))
	for _, p := range items {
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
		out = append(out, dto.NodePodDTO{
			Name:      p.Name,
			Namespace: p.Namespace,
			Phase:     string(p.Status.Phase),
			Ready:     kubepods.FmtReady(readyCount, totalCount),
			Restarts:  restarts,
			AgeSec:    age,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace == out[j].Namespace {
			return out[i].Name < out[j].Name
		}
		return out[i].Namespace < out[j].Namespace
	})
	return out
}
