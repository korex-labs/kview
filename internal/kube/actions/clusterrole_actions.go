package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
)

// HandleClusterRoleDelete deletes a clusterrole (cluster-scoped).
func HandleClusterRoleDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleClusterDelete(ctx, req, "rbac.authorization.k8s.io", "clusterroles", "clusterrole",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.RbacV1().ClusterRoles().Delete(ctx, name, opts)
		},
	)
}
