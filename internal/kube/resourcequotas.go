package kube

import (
	"context"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
	"kview/internal/kube/dto"
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
		age := int64(0)
		if !rq.CreationTimestamp.IsZero() {
			age = int64(now.Sub(rq.CreationTimestamp.Time).Seconds())
		}

		// Collect all keys from status.hard (preferred) falling back to spec.hard
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

		items = append(items, dto.ResourceQuotaDTO{
			Name:      rq.Name,
			Namespace: rq.Namespace,
			AgeSec:    age,
			Entries:   entries,
		})
	}

	return items, nil
}
