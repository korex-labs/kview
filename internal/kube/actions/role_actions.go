package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandleRoleDelete deletes a role.
func HandleRoleDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "rbac.authorization.k8s.io", "roles", "role",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.RbacV1().Roles(ns).Delete(ctx, name, opts)
		},
	)
}
