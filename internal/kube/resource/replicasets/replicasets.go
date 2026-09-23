package replicasets

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	deployments "github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListReplicaSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ReplicaSetDTO, error) {
	rss, err := c.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	return MapReplicaSets(rss.Items, time.Now()), nil
}

// MapReplicaSets projects resource status only; optional evidence is supplied explicitly.
func MapReplicaSets(items []appsv1.ReplicaSet, now time.Time) []dto.ReplicaSetDTO {
	out := make([]dto.ReplicaSetDTO, 0, len(items))
	for _, rs := range items {
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}

		age := int64(0)
		if !rs.CreationTimestamp.IsZero() {
			age = int64(now.Sub(rs.CreationTimestamp.Time).Seconds())
		}
		carrier := relationships.Capture(&rs, relationships.ReplicaSetDescriptor)
		carrier = relationships.WithObjectReferences(carrier, relationships.PodSpecReferences(rs.Namespace, "spec.template.spec", rs.Spec.Template.Spec))

		out = append(out, dto.ReplicaSetDTO{
			ResourceRelationshipCarrier: carrier,
			Name:                        rs.Name,
			Namespace:                   rs.Namespace,
			UID:                         string(rs.UID),
			Revision:                    deployments.ParseRevision(rs.Annotations["deployment.kubernetes.io/revision"]),
			Desired:                     desired,
			Ready:                       rs.Status.ReadyReplicas,
			Owner:                       mapReplicaSetOwner(rs.OwnerReferences),
			AgeSec:                      age,
		})
	}

	return out
}

func mapReplicaSetOwner(refs []metav1.OwnerReference) *dto.OwnerReferenceDTO {
	for _, ref := range refs {
		if ref.Kind == "Deployment" && (ref.Controller == nil || *ref.Controller) && ref.Name != "" {
			return &dto.OwnerReferenceDTO{
				Kind: ref.Kind,
				Name: ref.Name,
			}
		}
	}
	return nil
}
