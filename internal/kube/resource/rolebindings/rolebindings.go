package rolebindings

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListRoleBindings(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.RoleBindingListItemDTO, error) {
	items, err := c.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.RoleBindingListItemDTO, 0, len(items.Items))
	for _, rb := range items.Items {
		out = append(out, mapRoleBinding(rb, now))
	}

	return out, nil
}

func mapRoleBinding(rb rbacv1.RoleBinding, now time.Time) dto.RoleBindingListItemDTO {
	age := int64(0)
	if !rb.CreationTimestamp.IsZero() {
		age = int64(now.Sub(rb.CreationTimestamp.Time).Seconds())
	}
	carrier := relationships.WithObjectReferences(
		relationships.Capture(&rb, relationships.RoleBindingDescriptor),
		relationships.RoleBindingReferences(rb.Namespace, rb.RoleRef, rb.Subjects),
	)
	return dto.RoleBindingListItemDTO{
		ResourceRelationshipCarrier: carrier,
		Name:                        rb.Name,
		Namespace:                   rb.Namespace,
		Labels:                      rb.Labels,
		Annotations:                 rb.Annotations,
		RoleRefKind:                 rb.RoleRef.Kind,
		RoleRefName:                 rb.RoleRef.Name,
		SubjectsCount:               len(rb.Subjects),
		AgeSec:                      age,
	}
}
