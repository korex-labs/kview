package secrets

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ListSecrets(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.SecretDTO, error) {
	items, err := c.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.SecretDTO, 0, len(items.Items))
	for _, s := range items.Items {
		age := int64(0)
		if !s.CreationTimestamp.IsZero() {
			age = int64(now.Sub(s.CreationTimestamp.Time).Seconds())
		}

		keysCount := len(s.Data)
		immutable := false
		if s.Immutable != nil {
			immutable = *s.Immutable
		}

		out = append(out, dto.SecretDTO{
			Name:      s.Name,
			Namespace: s.Namespace,
			Type:      string(s.Type),
			KeysCount: keysCount,
			Immutable: immutable,
			AgeSec:    age,
		})
	}

	return out, nil
}
