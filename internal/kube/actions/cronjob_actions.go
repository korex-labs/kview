package actions

import (
	"context"
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

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

// HandleCronJobSuspend patches spec.suspend for a CronJob.
func HandleCronJobSuspend(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, "batch", "cronjobs"); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	suspend, result := boolParam(req.Params, "suspend")
	if result != nil {
		return result, nil
	}
	if _, ok := req.Params["suspend"]; !ok {
		return &ActionResult{Status: "error", Message: "params.suspend is required"}, nil
	}

	patch, _ := json.Marshal(map[string]any{
		"spec": map[string]any{
			"suspend": suspend,
		},
	})

	if _, err := c.Clientset.BatchV1().CronJobs(req.Namespace).Patch(ctx, req.Name, types.MergePatchType, patch, metav1.PatchOptions{}); err != nil {
		return nil, err
	}

	verb := "Resumed"
	if suspend {
		verb = "Suspended"
	}
	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("%s cronjob %s/%s", verb, req.Namespace, req.Name),
		Details: map[string]any{
			"namespace": req.Namespace,
			"name":      req.Name,
			"suspend":   suspend,
		},
	}, nil
}
