package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/internal/cluster"
)

// HandleDaemonSetRestart performs a rollout restart by patching the pod template annotation.
func HandleDaemonSetRestart(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedRolloutRestart(ctx, req, "apps", "daemonsets",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().DaemonSets(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleDaemonSetDelete deletes the daemonset.
func HandleDaemonSetDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "apps", "daemonsets", "daemonset",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.AppsV1().DaemonSets(ns).Delete(ctx, name, opts)
		},
	)
}
