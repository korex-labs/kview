package configmaps

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ListConfigMaps(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ConfigMapDTO, error) {
	items, err := c.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ConfigMapDTO, 0, len(items.Items))
	for _, cm := range items.Items {
		age := int64(0)
		if !cm.CreationTimestamp.IsZero() {
			age = int64(now.Sub(cm.CreationTimestamp.Time).Seconds())
		}

		keysCount := len(cm.Data) + len(cm.BinaryData)
		immutable := false
		if cm.Immutable != nil {
			immutable = *cm.Immutable
		}

		out = append(out, dto.ConfigMapDTO{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			KeysCount: keysCount,
			Immutable: immutable,
			AgeSec:    age,
		})
	}

	return out, nil
}
