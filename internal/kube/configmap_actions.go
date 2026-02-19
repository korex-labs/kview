package kube

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"kview/internal/cluster"
)

func validateConfigMapTarget(req ActionRequest) error {
	if req.Group != "" {
		return fmt.Errorf("unsupported group %q, expected \"\"", req.Group)
	}
	if req.Resource != "configmaps" {
		return fmt.Errorf("unsupported resource %q, expected \"configmaps\"", req.Resource)
	}
	if req.Namespace == "" {
		return fmt.Errorf("namespace is required")
	}
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	return nil
}

// HandleConfigMapDelete deletes a configmap.
func HandleConfigMapDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateConfigMapTarget(req); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	opts := metav1.DeleteOptions{}

	if raw, ok := req.Params["propagationPolicy"]; ok {
		policyStr, ok := raw.(string)
		if !ok {
			return &ActionResult{Status: "error", Message: "params.propagationPolicy must be a string"}, nil
		}
		switch policyStr {
		case "Foreground", "Background", "Orphan":
			policy := metav1.DeletionPropagation(policyStr)
			opts.PropagationPolicy = &policy
		default:
			return &ActionResult{Status: "error", Message: fmt.Sprintf("invalid propagationPolicy %q", policyStr)}, nil
		}
	} else {
		policy := metav1.DeletePropagationBackground
		opts.PropagationPolicy = &policy
	}

	err := c.Clientset.CoreV1().ConfigMaps(req.Namespace).Delete(ctx, req.Name, opts)
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Deleted configmap %s/%s", req.Namespace, req.Name),
		Details: map[string]any{
			"namespace": req.Namespace,
			"name":      req.Name,
		},
	}, nil
}
