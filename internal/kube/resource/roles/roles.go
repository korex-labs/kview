package roles

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func ListRoles(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.RoleListItemDTO, error) {
	items, err := c.Clientset.RbacV1().Roles(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.RoleListItemDTO, 0, len(items.Items))
	for _, role := range items.Items {
		age := int64(0)
		if !role.CreationTimestamp.IsZero() {
			age = int64(now.Sub(role.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.RoleListItemDTO{
			Name:       role.Name,
			Namespace:  role.Namespace,
			RulesCount: len(role.Rules),
			AgeSec:     age,
		})
	}

	return out, nil
}
