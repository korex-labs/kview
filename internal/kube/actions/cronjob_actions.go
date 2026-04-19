package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
)

// HandleCronJobDelete deletes the cronjob.
func HandleCronJobDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "batch", "cronjobs", "cronjob",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.BatchV1().CronJobs(ns).Delete(ctx, name, opts)
		},
	)
}
