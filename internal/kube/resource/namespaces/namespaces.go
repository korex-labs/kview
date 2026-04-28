package namespaces

import (
	"context"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func ListNamespaces(ctx context.Context, c *cluster.Clients) ([]dto.NamespaceListItemDTO, error) {
	nsList, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.NamespaceListItemDTO, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		age := int64(0)
		if !ns.CreationTimestamp.IsZero() {
			age = int64(now.Sub(ns.CreationTimestamp.Time).Seconds())
		}
		out = append(out, dto.NamespaceListItemDTO{
			Name:                   ns.Name,
			Phase:                  string(ns.Status.Phase),
			AgeSec:                 age,
			HasUnhealthyConditions: hasUnhealthyNamespaceConditions(ns.Status.Conditions),
		})
	}
	return out, nil
}

// GetNamespaceListFields performs a single-namespace GET for progressive list enrichment (stage 2).
// It avoids YAML serialization from GetNamespaceDetails.
func GetNamespaceListFields(ctx context.Context, c *cluster.Clients, name string) (dto.NamespaceListItemDTO, error) {
	ns, err := c.Clientset.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return dto.NamespaceListItemDTO{}, err
	}
	now := time.Now()
	age := int64(0)
	if !ns.CreationTimestamp.IsZero() {
		age = int64(now.Sub(ns.CreationTimestamp.Time).Seconds())
	}
	return dto.NamespaceListItemDTO{
		Name:                   ns.Name,
		Phase:                  string(ns.Status.Phase),
		AgeSec:                 age,
		HasUnhealthyConditions: hasUnhealthyNamespaceConditions(ns.Status.Conditions),
	}, nil
}

func ListNamespacesFallback(ctx context.Context, c *cluster.Clients) ([]dto.NamespaceListItemDTO, error) {
	// Fallback strategy placeholder:
	// - some restricted users can't list namespaces at all
	// - later we can keep "recent namespaces" and allow manual input in UI
	_ = corev1.Namespace{}
	return []dto.NamespaceListItemDTO{}, nil
}

func hasUnhealthyNamespaceConditions(conds []corev1.NamespaceCondition) bool {
	for _, c := range conds {
		switch c.Status {
		case corev1.ConditionFalse:
			continue
		case corev1.ConditionTrue, corev1.ConditionUnknown:
			return true
		default:
			continue
		}
	}
	return false
}
