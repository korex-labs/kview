package kube

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandleNodeDelete deletes a node (cluster-scoped).
func HandleNodeDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleClusterDelete(ctx, req, "", "nodes", "node",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().Nodes().Delete(ctx, name, opts)
		},
	)
}
