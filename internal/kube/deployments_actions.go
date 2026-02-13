package kube

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"kview/internal/cluster"
)

func validateDeploymentTarget(req ActionRequest) error {
	if req.Group != "apps" {
		return fmt.Errorf("unsupported group %q, expected \"apps\"", req.Group)
	}
	if req.Resource != "deployments" {
		return fmt.Errorf("unsupported resource %q, expected \"deployments\"", req.Resource)
	}
	if req.Namespace == "" {
		return fmt.Errorf("namespace is required")
	}
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	return nil
}

// HandleDeploymentScale patches spec.replicas to the requested value.
func HandleDeploymentScale(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateDeploymentTarget(req); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	raw, ok := req.Params["replicas"]
	if !ok {
		return &ActionResult{Status: "error", Message: "params.replicas is required"}, nil
	}
	replicasFloat, ok := raw.(float64)
	if !ok {
		return &ActionResult{Status: "error", Message: "params.replicas must be a number"}, nil
	}
	if replicasFloat < 0 || replicasFloat != math.Trunc(replicasFloat) {
		return &ActionResult{Status: "error", Message: "params.replicas must be an integer >= 0"}, nil
	}
	replicas := int32(replicasFloat)

	patch, _ := json.Marshal(map[string]any{
		"spec": map[string]any{
			"replicas": replicas,
		},
	})

	_, err := c.Clientset.AppsV1().Deployments(req.Namespace).Patch(
		ctx, req.Name, types.MergePatchType, patch, metav1.PatchOptions{},
	)
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Scaled %s/%s to %d replicas", req.Namespace, req.Name, replicas),
		Details: map[string]any{
			"namespace": req.Namespace,
			"name":      req.Name,
			"replicas":  replicas,
		},
	}, nil
}

// HandleDeploymentRestart performs a rollout restart by patching the pod template annotation.
func HandleDeploymentRestart(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateDeploymentTarget(req); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	restartedAt := time.Now().UTC().Format(time.RFC3339)

	patch, _ := json.Marshal(map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{
						"kubectl.kubernetes.io/restartedAt": restartedAt,
					},
				},
			},
		},
	})

	_, err := c.Clientset.AppsV1().Deployments(req.Namespace).Patch(
		ctx, req.Name, types.MergePatchType, patch, metav1.PatchOptions{},
	)
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Restarted %s/%s", req.Namespace, req.Name),
		Details: map[string]any{
			"namespace":   req.Namespace,
			"name":        req.Name,
			"restartedAt": restartedAt,
		},
	}, nil
}

// HandleDeploymentDelete deletes the deployment.
func HandleDeploymentDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if err := validateDeploymentTarget(req); err != nil {
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

	err := c.Clientset.AppsV1().Deployments(req.Namespace).Delete(ctx, req.Name, opts)
	if err != nil {
		return nil, err
	}

	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Deleted deployment %s/%s", req.Namespace, req.Name),
		Details: map[string]any{
			"namespace": req.Namespace,
			"name":      req.Name,
		},
	}, nil
}
