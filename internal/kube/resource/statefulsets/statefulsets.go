package statefulsets

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func ListStatefulSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.StatefulSetDTO, error) {
	sets, err := c.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.StatefulSetDTO, 0, len(sets.Items))
	for _, ss := range sets.Items {
		desired := int32(0)
		if ss.Spec.Replicas != nil {
			desired = *ss.Spec.Replicas
		}

		age := int64(0)
		if !ss.CreationTimestamp.IsZero() {
			age = int64(now.Sub(ss.CreationTimestamp.Time).Seconds())
		}

		selector := ""
		if ss.Spec.Selector != nil {
			if sel, err := metav1.LabelSelectorAsSelector(ss.Spec.Selector); err == nil {
				selector = sel.String()
			}
		}

		strategy := string(ss.Spec.UpdateStrategy.Type)
		if strategy == "" {
			strategy = "RollingUpdate"
		}

		out = append(out, dto.StatefulSetDTO{
			Name:           ss.Name,
			Namespace:      ss.Namespace,
			Desired:        desired,
			Ready:          ss.Status.ReadyReplicas,
			Current:        ss.Status.CurrentReplicas,
			Updated:        ss.Status.UpdatedReplicas,
			ServiceName:    ss.Spec.ServiceName,
			UpdateStrategy: strategy,
			Selector:       selector,
			AgeSec:         age,
		})
	}

	return out, nil
}
