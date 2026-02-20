package kube

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandlePVDelete deletes a persistentvolume (cluster-scoped).
func HandlePVDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleClusterDelete(ctx, req, "", "persistentvolumes", "persistentvolume",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().PersistentVolumes().Delete(ctx, name, opts)
		},
	)
}
