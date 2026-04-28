package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleIngressDelete deletes an ingress.
func HandleIngressDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "networking.k8s.io", "ingresses", "ingress",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.NetworkingV1().Ingresses(ns).Delete(ctx, name, opts)
		},
	)
}
