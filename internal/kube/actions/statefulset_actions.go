package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleStatefulSetScale patches spec.replicas to the requested value.
func HandleStatefulSetScale(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedScale(ctx, req, "apps", "statefulsets",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().StatefulSets(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleStatefulSetRestart performs a rollout restart by patching the pod template annotation.
func HandleStatefulSetRestart(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedRolloutRestart(ctx, req, "apps", "statefulsets",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().StatefulSets(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleStatefulSetDelete deletes the statefulset.
func HandleStatefulSetDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "apps", "statefulsets", "statefulset",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.AppsV1().StatefulSets(ns).Delete(ctx, name, opts)
		},
	)
}
