package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
)

// HandleNamespaceDelete deletes a namespace (cluster-scoped).
func HandleNamespaceDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleClusterDelete(ctx, req, "", "namespaces", "namespace",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().Namespaces().Delete(ctx, name, opts)
		},
	)
}
