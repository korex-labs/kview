package replicasets

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
)

func ListReplicaSets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ReplicaSetDTO, error) {
	rss, err := c.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ReplicaSetDTO, 0, len(rss.Items))
	for _, rs := range rss.Items {
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}

		age := int64(0)
		if !rs.CreationTimestamp.IsZero() {
			age = int64(now.Sub(rs.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.ReplicaSetDTO{
			Name:      rs.Name,
			Namespace: rs.Namespace,
			Revision:  deployments.ParseRevision(rs.Annotations["deployment.kubernetes.io/revision"]),
			Desired:   desired,
			Ready:     rs.Status.ReadyReplicas,
			Owner:     mapReplicaSetOwner(rs.OwnerReferences),
			AgeSec:    age,
		})
	}

	return out, nil
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
