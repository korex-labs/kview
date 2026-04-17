package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
)

// HandleServiceAccountDelete deletes a serviceaccount.
func HandleServiceAccountDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "", "serviceaccounts", "serviceaccount",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().ServiceAccounts(ns).Delete(ctx, name, opts)
		},
	)
}
