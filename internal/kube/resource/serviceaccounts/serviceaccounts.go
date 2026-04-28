package serviceaccounts

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ListServiceAccounts(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ServiceAccountListItemDTO, error) {
	items, err := c.Clientset.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ServiceAccountListItemDTO, 0, len(items.Items))
	for _, sa := range items.Items {
		age := int64(0)
		if !sa.CreationTimestamp.IsZero() {
			age = int64(now.Sub(sa.CreationTimestamp.Time).Seconds())
		}

		out = append(out, dto.ServiceAccountListItemDTO{
			Name:                         sa.Name,
			Namespace:                    sa.Namespace,
			ImagePullSecretsCount:        len(sa.ImagePullSecrets),
			SecretsCount:                 len(sa.Secrets),
			AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
			AgeSec:                       age,
		})
	}

	return out, nil
}
