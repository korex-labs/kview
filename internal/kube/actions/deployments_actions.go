package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleDeploymentScale patches spec.replicas to the requested value.
func HandleDeploymentScale(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedScale(ctx, req, "apps", "deployments",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().Deployments(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleDeploymentRestart performs a rollout restart by patching the pod template annotation.
func HandleDeploymentRestart(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedRolloutRestart(ctx, req, "apps", "deployments",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().Deployments(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleDeploymentDelete deletes the deployment.
func HandleDeploymentDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "apps", "deployments", "deployment",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.AppsV1().Deployments(ns).Delete(ctx, name, opts)
		},
	)
}
