package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandlePVCDelete deletes a persistentvolumeclaim.
func HandlePVCDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "", "persistentvolumeclaims", "persistentvolumeclaim",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().PersistentVolumeClaims(ns).Delete(ctx, name, opts)
		},
	)
}
