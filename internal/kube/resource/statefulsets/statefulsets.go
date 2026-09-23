package statefulsets

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListStatefulSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.StatefulSetDTO, error) {
	sets, err := c.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	return MapStatefulSets(sets.Items, time.Now()), nil
}

// MapStatefulSets projects resource status only; optional evidence is supplied explicitly.
func MapStatefulSets(items []appsv1.StatefulSet, now time.Time) []dto.StatefulSetDTO {
	out := make([]dto.StatefulSetDTO, 0, len(items))
	for _, ss := range items {
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
		carrier := relationships.Capture(&ss, relationships.StatefulSetDescriptor)
		carrier = relationships.WithObjectReferences(carrier, relationships.PodSpecReferences(ss.Namespace, "spec.template.spec", ss.Spec.Template.Spec))
		carrier = relationships.WithObjectReferences(carrier, relationships.StatefulSetServiceReference(ss.Namespace, ss.Spec.ServiceName))

		out = append(out, dto.StatefulSetDTO{
			ResourceRelationshipCarrier: carrier,
			UID:                         string(ss.UID),
			Name:                        ss.Name,
			Namespace:                   ss.Namespace,
			Desired:                     desired,
			Ready:                       ss.Status.ReadyReplicas,
			Current:                     ss.Status.CurrentReplicas,
			Updated:                     ss.Status.UpdatedReplicas,
			ServiceName:                 ss.Spec.ServiceName,
			UpdateStrategy:              strategy,
			Selector:                    selector,
			AgeSec:                      age,
		})
	}

	return out
}
