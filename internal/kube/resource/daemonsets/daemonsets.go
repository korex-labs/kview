package daemonsets

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListDaemonSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.DaemonSetDTO, error) {
	sets, err := c.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	return MapDaemonSets(sets.Items, time.Now()), nil
}

// MapDaemonSets projects resource status only; optional evidence is supplied explicitly.
func MapDaemonSets(items []appsv1.DaemonSet, now time.Time) []dto.DaemonSetDTO {
	out := make([]dto.DaemonSetDTO, 0, len(items))
	for _, ds := range items {
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
		carrier := relationships.Capture(&ds, relationships.DaemonSetDescriptor)
		carrier = relationships.WithObjectReferences(carrier, relationships.PodSpecReferences(ds.Namespace, "spec.template.spec", ds.Spec.Template.Spec))

		out = append(out, dto.DaemonSetDTO{
			ResourceRelationshipCarrier: carrier,
			UID:                         string(ds.UID),
			Name:                        ds.Name,
			Namespace:                   ds.Namespace,
			Desired:                     ds.Status.DesiredNumberScheduled,
			Current:                     ds.Status.CurrentNumberScheduled,
			Ready:                       ds.Status.NumberReady,
			Updated:                     ds.Status.UpdatedNumberScheduled,
			Available:                   ds.Status.NumberAvailable,
			UpdateStrategy:              strategy,
			Selector:                    selector,
			AgeSec:                      age,
		})
	}

	return out
}
