package namespaces

import (
	"context"
	"encoding/json"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func GetNamespaceDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.NamespaceDetailsDTO, error) {
	ns, err := c.Clientset.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	nsCopy := ns.DeepCopy()
	nsCopy.ManagedFields = nil
	b, err := json.Marshal(nsCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	createdAt := int64(0)
	age := int64(0)
	if !ns.CreationTimestamp.IsZero() {
		createdAt = ns.CreationTimestamp.Unix()
		age = int64(now.Sub(ns.CreationTimestamp.Time).Seconds())
	}

	summary := dto.NamespaceSummaryDTO{
		Name:      ns.Name,
		Phase:     string(ns.Status.Phase),
		CreatedAt: createdAt,
		AgeSec:    age,
	}

	conditions := mapNamespaceConditions(ns.Status.Conditions)

	return &dto.NamespaceDetailsDTO{
		Summary: summary,
		Metadata: dto.NamespaceMetadataDTO{
			Labels:      ns.Labels,
			Annotations: ns.Annotations,
		},
		Conditions: conditions,
		YAML:       string(y),
	}, nil
}

func mapNamespaceConditions(conds []corev1.NamespaceCondition) []dto.NamespaceConditionDTO {
	out := make([]dto.NamespaceConditionDTO, 0, len(conds))
	for _, c := range conds {
		lt := int64(0)
		if !c.LastTransitionTime.IsZero() {
			lt = c.LastTransitionTime.Unix()
		}
		out = append(out, dto.NamespaceConditionDTO{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: lt,
		})
	}
	return out
}
