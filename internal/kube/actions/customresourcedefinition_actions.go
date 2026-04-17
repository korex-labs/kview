package actions

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/alex-mamchenkov/kview/internal/cluster"
)

var crdGVR = schema.GroupVersionResource{
	Group:    "apiextensions.k8s.io",
	Version:  "v1",
	Resource: "customresourcedefinitions",
}

// HandleCRDDelete deletes a customresourcedefinition (cluster-scoped).
// CRDs live in the apiextensions.k8s.io group which is not part of the
// standard kubernetes.Clientset, so we use the dynamic client.
func HandleCRDDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return &ActionResult{Status: "error", Message: fmt.Sprintf("dynamic client: %v", err)}, nil
	}
	return handleClusterDelete(ctx, req, "apiextensions.k8s.io", "customresourcedefinitions", "customresourcedefinition",
		func(ctx context.Context, name string, opts metav1.DeleteOptions) error {
			return dynClient.Resource(crdGVR).Delete(ctx, name, opts)
		},
	)
}
