package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

// HandleConfigMapDelete deletes a configmap.
func HandleConfigMapDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "", "configmaps", "configmap",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().ConfigMaps(ns).Delete(ctx, name, opts)
		},
	)
}
