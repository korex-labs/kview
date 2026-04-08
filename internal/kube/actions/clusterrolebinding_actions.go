package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandleClusterRoleBindingDelete deletes a clusterrolebinding (cluster-scoped).
func HandleClusterRoleBindingDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleClusterDelete(ctx, req, "rbac.authorization.k8s.io", "clusterrolebindings", "clusterrolebinding",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.RbacV1().ClusterRoleBindings().Delete(ctx, name, opts)
		},
	)
}
