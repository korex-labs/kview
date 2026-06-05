package resourcequotas

import (
	"context"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// quotaKeySortOrder defines the priority order for common quota keys.
var quotaKeySortOrder = map[string]int{
	"pods":                       0,
	"requests.cpu":               1,
	"requests.memory":            2,
	"limits.cpu":                 3,
	"limits.memory":              4,
	"requests.storage":           5,
	"services":                   6,
	"services.loadbalancers":     7,
	"services.nodeports":         8,
	"configmaps":                 9,
	"secrets":                    10,
	"persistentvolumeclaims":     11,
	"replicationcontrollers":     12,
	"resourcequotas":             13,
	"requests.nvidia.com/gpu":    14,
	"requests.ephemeral-storage": 15,
	"limits.ephemeral-storage":   16,
}

func ListResourceQuotas(ctx context.Context, c *cluster.Clients, namespace string) (*dto.ResourceQuotaListDTO, error) {
	items, err := ListResourceQuotaItems(ctx, c, namespace)
	if err != nil {
		return nil, err
	}
	return &dto.ResourceQuotaListDTO{Items: items}, nil
}

func ListResourceQuotaItems(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ResourceQuotaDTO, error) {
	rqList, err := c.Clientset.CoreV1().ResourceQuotas(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	items := make([]dto.ResourceQuotaDTO, 0, len(rqList.Items))
	for _, rq := range rqList.Items {
		items = append(items, mapResourceQuota(rq, now))
	}

	return items, nil
}

func GetResourceQuotaDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.ResourceQuotaDetailsDTO, error) {
	rq, err := c.Clientset.CoreV1().ResourceQuotas(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	copy := rq.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "v1", "ResourceQuota")
	if err != nil {
		return nil, err
	}
	return &dto.ResourceQuotaDetailsDTO{
		Summary: mapResourceQuota(*rq, time.Now()),
		Metadata: dto.ObjectMetadataDTO{
			Labels:      rq.Labels,
			Annotations: rq.Annotations,
		},
		YAML: string(y),
	}, nil
}

func GetResourceQuotaYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	rq, err := c.Clientset.CoreV1().ResourceQuotas(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	copy := rq.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "v1", "ResourceQuota")
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func mapResourceQuota(rq corev1.ResourceQuota, now time.Time) dto.ResourceQuotaDTO {
	age := int64(0)
	if !rq.CreationTimestamp.IsZero() {
		age = int64(now.Sub(rq.CreationTimestamp.Time).Seconds())
	}

	hardMap := rq.Status.Hard
	if len(hardMap) == 0 {
		hardMap = rq.Spec.Hard
	}

	entries := make([]dto.ResourceQuotaEntryDTO, 0, len(hardMap))
	for key, hardQty := range hardMap {
		usedStr := "-"
		var ratio *float64

		if usedQty, ok := rq.Status.Used[key]; ok {
			usedStr = usedQty.String()

			hardVal := hardQty.AsApproximateFloat64()
			if hardVal > 0 {
				usedVal := usedQty.AsApproximateFloat64()
				r := usedVal / hardVal
				if r > 1 {
					r = 1
				}
				ratio = &r
			}
		}

		entries = append(entries, dto.ResourceQuotaEntryDTO{
			Key:   string(key),
			Used:  usedStr,
			Hard:  hardQty.String(),
			Ratio: ratio,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		oi, okI := quotaKeySortOrder[entries[i].Key]
		oj, okJ := quotaKeySortOrder[entries[j].Key]
		if okI && okJ {
			return oi < oj
		}
		if okI {
			return true
		}
		if okJ {
			return false
		}
		return entries[i].Key < entries[j].Key
	})

	return dto.ResourceQuotaDTO{
		Name:      rq.Name,
		Namespace: rq.Namespace,
		AgeSec:    age,
		Entries:   entries,
	}
}
