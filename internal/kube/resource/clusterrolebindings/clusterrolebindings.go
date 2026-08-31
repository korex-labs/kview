package clusterrolebindings

import (
	"context"
	"time"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListClusterRoleBindings(ctx context.Context, c *cluster.Clients) ([]dto.ClusterRoleBindingListItemDTO, error) {
	items, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.ClusterRoleBindingListItemDTO, 0, len(items.Items))
	for _, rb := range items.Items {
		out = append(out, mapClusterRoleBinding(rb, now))
	}

	return out, nil
}

func mapClusterRoleBinding(rb rbacv1.ClusterRoleBinding, now time.Time) dto.ClusterRoleBindingListItemDTO {
	age := int64(0)
	if !rb.CreationTimestamp.IsZero() {
		age = int64(now.Sub(rb.CreationTimestamp.Time).Seconds())
	}
	carrier := relationships.WithObjectReferences(
		relationships.Capture(&rb, relationships.ClusterRoleBindingDescriptor),
		relationships.ClusterRoleBindingReferences(rb.RoleRef, rb.Subjects),
	)
	return dto.ClusterRoleBindingListItemDTO{
		ResourceRelationshipCarrier: carrier,
		Name:                        rb.Name,
		RoleRefKind:                 rb.RoleRef.Kind,
		RoleRefName:                 rb.RoleRef.Name,
		SubjectsCount:               len(rb.Subjects),
		AgeSec:                      age,
	}
}
