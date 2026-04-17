package nodes

import (
	"context"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
	kubepods "github.com/alex-mamchenkov/kview/internal/kube/resource/pods"
)

const nodeListChunkLimit int64 = 500

func ListNodes(ctx context.Context, c *cluster.Clients) ([]dto.NodeListItemDTO, error) {
	nodes, err := listAllNodes(ctx, c)
	if err != nil {
		return nil, err
	}

	podCounts := map[string]int{}
	if pods, err := listAllPodsForNodeCounts(ctx, c); err == nil {
		for _, p := range pods.Items {
			if p.Spec.NodeName == "" {
				continue
			}
			podCounts[p.Spec.NodeName]++
		}
	}

	now := time.Now()
	out := make([]dto.NodeListItemDTO, 0, len(nodes.Items))
	for _, n := range nodes.Items {
		age := int64(0)
		if !n.CreationTimestamp.IsZero() {
			age = int64(now.Sub(n.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.NodeListItemDTO{
			Name:              n.Name,
			Status:            nodeReadyStatus(n.Status.Conditions),
			Roles:             deriveNodeRoles(n.Labels),
			CPUAllocatable:    kubepods.QuantityString(n.Status.Allocatable[corev1.ResourceCPU]),
			MemoryAllocatable: kubepods.QuantityString(n.Status.Allocatable[corev1.ResourceMemory]),
			PodsAllocatable:   kubepods.QuantityString(n.Status.Allocatable[corev1.ResourcePods]),
			PodsCount:         podCounts[n.Name],
			KubeletVersion:    n.Status.NodeInfo.KubeletVersion,
			AgeSec:            age,
		})
	}
	return out, nil
}

func listAllNodes(ctx context.Context, c *cluster.Clients) (*corev1.NodeList, error) {
	return listAllNodePages(ctx, c.Clientset.CoreV1().Nodes().List)
}

func listAllNodePages(ctx context.Context, list func(context.Context, metav1.ListOptions) (*corev1.NodeList, error)) (*corev1.NodeList, error) {
	var out corev1.NodeList
	opts := metav1.ListOptions{Limit: nodeListChunkLimit}
	for {
		page, err := list(ctx, opts)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, page.Items...)
		if page.Continue == "" {
			return &out, nil
		}
		opts.Continue = page.Continue
	}
}

func listAllPodsForNodeCounts(ctx context.Context, c *cluster.Clients) (*corev1.PodList, error) {
	return listAllPodPages(ctx, c.Clientset.CoreV1().Pods("").List)
}

func listAllPodPages(ctx context.Context, list func(context.Context, metav1.ListOptions) (*corev1.PodList, error)) (*corev1.PodList, error) {
	var out corev1.PodList
	opts := metav1.ListOptions{Limit: nodeListChunkLimit}
	for {
		page, err := list(ctx, opts)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, page.Items...)
		if page.Continue == "" {
			return &out, nil
		}
		opts.Continue = page.Continue
	}
}

func nodeReadyStatus(conds []corev1.NodeCondition) string {
	for _, c := range conds {
		if c.Type != corev1.NodeReady {
			continue
		}
		switch c.Status {
		case corev1.ConditionTrue:
			return "Ready"
		case corev1.ConditionFalse:
			return "NotReady"
		case corev1.ConditionUnknown:
			return "Unknown"
		default:
			return "Unknown"
		}
	}
	return "Unknown"
}

func deriveNodeRoles(labels map[string]string) []string {
	if len(labels) == 0 {
		return nil
	}
	roleSet := map[string]struct{}{}
	for k, v := range labels {
		if strings.HasPrefix(k, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(k, "node-role.kubernetes.io/")
			if role != "" {
				roleSet[role] = struct{}{}
			}
			continue
		}
		if k == "kubernetes.io/role" && strings.TrimSpace(v) != "" {
			roleSet[strings.TrimSpace(v)] = struct{}{}
		}
	}
	if len(roleSet) == 0 {
		return nil
	}
	roles := make([]string, 0, len(roleSet))
	for r := range roleSet {
		roles = append(roles, r)
	}
	sort.Strings(roles)
	return roles
}
