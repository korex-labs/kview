package daemonsets

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func ListDaemonSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.DaemonSetDTO, error) {
	sets, err := c.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.DaemonSetDTO, 0, len(sets.Items))
	for _, ds := range sets.Items {
		age := int64(0)
		if !ds.CreationTimestamp.IsZero() {
			age = int64(now.Sub(ds.CreationTimestamp.Time).Seconds())
		}

		selector := ""
		if ds.Spec.Selector != nil {
			if sel, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector); err == nil {
				selector = sel.String()
			}
		}

		strategy := string(ds.Spec.UpdateStrategy.Type)
		if strategy == "" {
			strategy = "RollingUpdate"
		}

		out = append(out, dto.DaemonSetDTO{
			Name:           ds.Name,
			Namespace:      ds.Namespace,
			Desired:        ds.Status.DesiredNumberScheduled,
			Current:        ds.Status.CurrentNumberScheduled,
			Ready:          ds.Status.NumberReady,
			Updated:        ds.Status.UpdatedNumberScheduled,
			Available:      ds.Status.NumberAvailable,
			UpdateStrategy: strategy,
			Selector:       selector,
			AgeSec:         age,
		})
	}

	return out, nil
}
