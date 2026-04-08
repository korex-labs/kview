package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandleRoleBindingDelete deletes a rolebinding.
func HandleRoleBindingDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "rbac.authorization.k8s.io", "rolebindings", "rolebinding",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.RbacV1().RoleBindings(ns).Delete(ctx, name, opts)
		},
	)
}
