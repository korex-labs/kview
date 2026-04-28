package clusterroles

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ListClusterRoles(ctx context.Context, c *cluster.Clients) ([]dto.ClusterRoleListItemDTO, error) {
	items, err := c.Clientset.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ClusterRoleListItemDTO, 0, len(items.Items))
	for _, role := range items.Items {
		age := int64(0)
		if !role.CreationTimestamp.IsZero() {
			age = int64(now.Sub(role.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.ClusterRoleListItemDTO{
			Name:       role.Name,
			RulesCount: len(role.Rules),
			AgeSec:     age,
		})
	}

	return out, nil
}
