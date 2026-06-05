package actions

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleNetworkPolicyDelete deletes a network policy.
func HandleNetworkPolicyDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "networking.k8s.io", "networkpolicies", "networkpolicy",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.NetworkingV1().NetworkPolicies(ns).Delete(ctx, name, opts)
		},
	)
}

// HandleResourceQuotaDelete deletes a resource quota.
func HandleResourceQuotaDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "", "resourcequotas", "resourcequota",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().ResourceQuotas(ns).Delete(ctx, name, opts)
		},
	)
}

// HandleLimitRangeDelete deletes a limit range.
func HandleLimitRangeDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	return handleNamespacedDelete(ctx, req, "", "limitranges", "limitrange",
		func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error {
			return c.Clientset.CoreV1().LimitRanges(ns).Delete(ctx, name, opts)
		},
	)
}
