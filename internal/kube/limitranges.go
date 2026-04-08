package kube

import (
	"context"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
	"kview/internal/kube/dto"
)

func ListLimitRanges(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.LimitRangeDTO, error) {
	lrList, err := c.Clientset.CoreV1().LimitRanges(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	items := make([]dto.LimitRangeDTO, 0, len(lrList.Items))
	for _, lr := range lrList.Items {
		age := int64(0)
		if !lr.CreationTimestamp.IsZero() {
			age = int64(now.Sub(lr.CreationTimestamp.Time).Seconds())
		}
		limits := make([]dto.LimitRangeItemDTO, 0, len(lr.Spec.Limits))
		for _, item := range lr.Spec.Limits {
			limits = append(limits, dto.LimitRangeItemDTO{
				Type:           string(item.Type),
				Min:            resourceListToStringMap(item.Min),
				Max:            resourceListToStringMap(item.Max),
				Default:        resourceListToStringMap(item.Default),
				DefaultRequest: resourceListToStringMap(item.DefaultRequest),
				MaxLimitRatio:  resourceListToStringMap(item.MaxLimitRequestRatio),
			})
		}
		items = append(items, dto.LimitRangeDTO{
			Name:      lr.Name,
			Namespace: lr.Namespace,
			AgeSec:    age,
			Items:     limits,
		})
	}
	return items, nil
}

func resourceListToStringMap(values corev1.ResourceList) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]string, len(values))
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, string(key))
	}
	sort.Strings(keys)
	for _, key := range keys {
		quantity := values[corev1.ResourceName(key)]
		out[key] = quantity.String()
	}
	return out
}
