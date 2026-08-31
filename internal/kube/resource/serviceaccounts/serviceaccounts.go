package serviceaccounts

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListServiceAccounts(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ServiceAccountListItemDTO, error) {
	items, err := c.Clientset.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ServiceAccountListItemDTO, 0, len(items.Items))
	for _, sa := range items.Items {
		out = append(out, mapServiceAccount(sa, now))
	}

	return out, nil
}

func mapServiceAccount(sa corev1.ServiceAccount, now time.Time) dto.ServiceAccountListItemDTO {
	age := int64(0)
	if !sa.CreationTimestamp.IsZero() {
		age = int64(now.Sub(sa.CreationTimestamp.Time).Seconds())
	}
	carrier := relationships.WithObjectReferences(
		relationships.Capture(&sa, relationships.ServiceAccountDescriptor),
		relationships.ServiceAccountReferences(sa.Namespace, sa.Secrets, sa.ImagePullSecrets),
	)
	return dto.ServiceAccountListItemDTO{
		ResourceRelationshipCarrier:  carrier,
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		Labels:                       sa.Labels,
		Annotations:                  sa.Annotations,
		ImagePullSecretsCount:        len(sa.ImagePullSecrets),
		SecretsCount:                 len(sa.Secrets),
		AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
		AgeSec:                       age,
	}
}
