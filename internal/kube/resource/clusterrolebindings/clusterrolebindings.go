package clusterrolebindings

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func ListClusterRoleBindings(ctx context.Context, c *cluster.Clients) ([]dto.ClusterRoleBindingListItemDTO, error) {
	items, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ClusterRoleBindingListItemDTO, 0, len(items.Items))
	for _, rb := range items.Items {
		age := int64(0)
		if !rb.CreationTimestamp.IsZero() {
			age = int64(now.Sub(rb.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.ClusterRoleBindingListItemDTO{
			Name:          rb.Name,
			RoleRefKind:   rb.RoleRef.Kind,
			RoleRefName:   rb.RoleRef.Name,
			SubjectsCount: len(rb.Subjects),
			AgeSec:        age,
		})
	}

	return out, nil
}
