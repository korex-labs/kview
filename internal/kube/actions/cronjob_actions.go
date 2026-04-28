package actions

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleCronJobDelete deletes the cronjob.
func HandleCronJobDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "batch", "cronjobs", "cronjob",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.BatchV1().CronJobs(ns).Delete(ctx, name, opts)
		},
	)
}

// HandleCronJobRun creates a one-off Job from a CronJob's job template.
func HandleCronJobRun(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, "batch", "cronjobs"); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	job, err := BuildCronJobRun(ctx, c, req.Namespace, req.Name, "")
	if err != nil {
		return nil, err
	}

	created, err := c.Clientset.BatchV1().Jobs(req.Namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Started job %s/%s", created.Namespace, created.Name),
		Details: map[string]any{
			"namespace": created.Namespace,
			"jobName":   created.Name,
			"source":    req.Name,
		},
	}, nil
}
