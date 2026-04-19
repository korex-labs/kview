package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
)

// HandleJobDelete deletes the job.
func HandleJobDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "batch", "jobs", "job",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.BatchV1().Jobs(ns).Delete(ctx, name, opts)
		},
	)
}
