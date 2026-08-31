package limitranges

import (
	"context"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListLimitRanges(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.LimitRangeDTO, error) {
	lrList, err := c.Clientset.CoreV1().LimitRanges(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	items := make([]dto.LimitRangeDTO, 0, len(lrList.Items))
	for _, lr := range lrList.Items {
		items = append(items, mapLimitRange(lr, now))
	}
	return items, nil
}

func GetLimitRangeDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.LimitRangeDetailsDTO, error) {
	lr, err := c.Clientset.CoreV1().LimitRanges(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	copy := lr.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "v1", "LimitRange")
	if err != nil {
		return nil, err
	}
	return &dto.LimitRangeDetailsDTO{
		Summary: mapLimitRange(*lr, time.Now()),
		Metadata: dto.ObjectMetadataDTO{
			Labels:      lr.Labels,
			Annotations: lr.Annotations,
		},
		YAML: string(y),
	}, nil
}

func GetLimitRangeYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	lr, err := c.Clientset.CoreV1().LimitRanges(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	copy := lr.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "v1", "LimitRange")
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func mapLimitRange(lr corev1.LimitRange, now time.Time) dto.LimitRangeDTO {
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
	return dto.LimitRangeDTO{
		ResourceRelationshipCarrier: relationships.Capture(&lr, relationships.LimitRangeDescriptor),
		Name:                        lr.Name,
		Namespace:                   lr.Namespace,
		AgeSec:                      age,
		Items:                       limits,
	}
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
