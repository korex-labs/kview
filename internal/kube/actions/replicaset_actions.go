package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleReplicaSetScale patches spec.replicas to the requested value.
func HandleReplicaSetScale(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedScale(ctx, req, "apps", "replicasets",
		func(ctx context.Context, ns, name string, patch []byte) error {
			_, err := c.Clientset.AppsV1().ReplicaSets(ns).Patch(
				ctx, name, types.MergePatchType, patch, metav1.PatchOptions{},
			)
			return err
		},
	)
}

// HandleReplicaSetDelete deletes the replicaset.
func HandleReplicaSetDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "apps", "replicasets", "replicaset",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.AppsV1().ReplicaSets(ns).Delete(ctx, name, opts)
		},
	)
}
