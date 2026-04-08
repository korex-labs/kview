package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// validateNamespacedTarget returns an error if req.Group, req.Resource,
// req.Namespace, or req.Name do not match expectations.
func validateNamespacedTarget(req ActionRequest, expectedGroup, expectedResource string) error {
	if req.Group != expectedGroup {
		return fmt.Errorf("unsupported group %q, expected %q", req.Group, expectedGroup)
	}
	if req.Resource != expectedResource {
		return fmt.Errorf("unsupported resource %q, expected %q", req.Resource, expectedResource)
	}
	if req.Namespace == "" {
		return fmt.Errorf("namespace is required")
	}
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	return nil
}

// buildDeleteOptions parses the optional propagationPolicy param from req and
// returns the corresponding DeleteOptions. If the param is present but invalid
// it returns a non-nil *ActionResult that the caller should return immediately.
func buildDeleteOptions(req ActionRequest) (metav1.DeleteOptions, *ActionResult) {
	opts := metav1.DeleteOptions{}
	force, result := boolParam(req.Params, "force")
	if result != nil {
		return opts, result
	}
	if force {
		zero := int64(0)
		opts.GracePeriodSeconds = &zero
	}
	if raw, ok := req.Params["propagationPolicy"]; ok {
		policyStr, ok := raw.(string)
		if !ok {
			return opts, &ActionResult{Status: "error", Message: "params.propagationPolicy must be a string"}
		}
		switch policyStr {
		case "Foreground", "Background", "Orphan":
			policy := metav1.DeletionPropagation(policyStr)
			opts.PropagationPolicy = &policy
		default:
			return opts, &ActionResult{Status: "error", Message: fmt.Sprintf("invalid propagationPolicy %q", policyStr)}
		}
	} else {
		policy := metav1.DeletePropagationBackground
		opts.PropagationPolicy = &policy
	}
	return opts, nil
}

func boolParam(params map[string]any, key string) (bool, *ActionResult) {
	raw, ok := params[key]
	if !ok {
		return false, nil
	}
	value, ok := raw.(bool)
	if !ok {
		return false, &ActionResult{Status: "error", Message: fmt.Sprintf("params.%s must be a boolean", key)}
	}
	return value, nil
}

// handleNamespacedDelete is the shared helper for simple namespaced-delete
// action handlers. It validates the target, builds DeleteOptions from the
// request params, calls deleteFn, and returns the canonical ActionResult.
func handleNamespacedDelete(
	ctx context.Context,
	req ActionRequest,
	expectedGroup, expectedResource, kindLabel string,
	deleteFn func(ctx context.Context, ns, name string, opts metav1.DeleteOptions) error,
) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, expectedGroup, expectedResource); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	opts, errResult := buildDeleteOptions(req)
	if errResult != nil {
		return errResult, nil
	}

	if err := deleteFn(ctx, req.Namespace, req.Name, opts); err != nil {
		return nil, err
	}

	force := opts.GracePeriodSeconds != nil && *opts.GracePeriodSeconds == 0
	message := fmt.Sprintf("Deleted %s %s/%s", kindLabel, req.Namespace, req.Name)
	if force {
		message = fmt.Sprintf("Requested force delete for %s %s/%s", kindLabel, req.Namespace, req.Name)
	}
	return &ActionResult{
		Status:  "ok",
		Message: message,
		Details: map[string]any{
			"namespace": req.Namespace,
			"name":      req.Name,
			"force":     force,
		},
	}, nil
}

// parseReplicas reads and validates the "replicas" param from req.
// On validation failure it returns a non-nil *ActionResult that the caller
// should return immediately.
func parseReplicas(req ActionRequest) (int32, *ActionResult) {
	raw, ok := req.Params["replicas"]
	if !ok {
		return 0, &ActionResult{Status: "error", Message: "params.replicas is required"}
	}
	replicasFloat, ok := raw.(float64)
	if !ok {
		return 0, &ActionResult{Status: "error", Message: "params.replicas must be a number"}
	}
	if replicasFloat < 0 || replicasFloat != math.Trunc(replicasFloat) {
		return 0, &ActionResult{Status: "error", Message: "params.replicas must be an integer >= 0"}
	}
	return int32(replicasFloat), nil
}

// rolloutRestartPatch returns the canonical MergePatch payload that sets the
// kubectl.kubernetes.io/restartedAt annotation on the pod template.
func rolloutRestartPatch(restartedAt string) []byte {
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
	return patch
}

// handleNamespacedScale is the shared helper for scale action handlers.
// It validates the target, parses replicas, builds the spec.replicas patch,
// calls patchFn, and returns the canonical ActionResult.
func handleNamespacedScale(
	ctx context.Context,
	req ActionRequest,
	expectedGroup, expectedResource string,
	patchFn func(ctx context.Context, ns, name string, patch []byte) error,
) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, expectedGroup, expectedResource); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	replicas, errResult := parseReplicas(req)
	if errResult != nil {
		return errResult, nil
	}

	patch, _ := json.Marshal(map[string]any{
		"spec": map[string]any{"replicas": replicas},
	})

	if err := patchFn(ctx, req.Namespace, req.Name, patch); err != nil {
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

// validateClusterTarget returns an error if req.Group, req.Resource, or req.Name
// do not match expectations. Namespace is intentionally not required.
func validateClusterTarget(req ActionRequest, expectedGroup, expectedResource string) error {
	if req.Group != expectedGroup {
		return fmt.Errorf("unsupported group %q, expected %q", req.Group, expectedGroup)
	}
	if req.Resource != expectedResource {
		return fmt.Errorf("unsupported resource %q, expected %q", req.Resource, expectedResource)
	}
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}
	return nil
}

// handleClusterDelete is the shared helper for cluster-scoped delete action
// handlers. It validates the target (no namespace required), builds DeleteOptions
// from the request params, calls deleteFn, and returns the canonical ActionResult.
func handleClusterDelete(
	ctx context.Context,
	req ActionRequest,
	expectedGroup, expectedResource, kindLabel string,
	deleteFn func(ctx context.Context, name string, opts metav1.DeleteOptions) error,
) (*ActionResult, error) {
	if err := validateClusterTarget(req, expectedGroup, expectedResource); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	opts, errResult := buildDeleteOptions(req)
	if errResult != nil {
		return errResult, nil
	}

	if err := deleteFn(ctx, req.Name, opts); err != nil {
		return nil, err
	}

	force := opts.GracePeriodSeconds != nil && *opts.GracePeriodSeconds == 0
	message := fmt.Sprintf("Deleted %s %s", kindLabel, req.Name)
	if force {
		message = fmt.Sprintf("Requested force delete for %s %s", kindLabel, req.Name)
	}
	return &ActionResult{
		Status:  "ok",
		Message: message,
		Details: map[string]any{
			"name":  req.Name,
			"force": force,
		},
	}, nil
}

// handleNamespacedRolloutRestart is the shared helper for rollout-restart
// action handlers. It validates the target, builds the restart annotation
// patch, calls patchFn, and returns the canonical ActionResult.
func handleNamespacedRolloutRestart(
	ctx context.Context,
	req ActionRequest,
	expectedGroup, expectedResource string,
	patchFn func(ctx context.Context, ns, name string, patch []byte) error,
) (*ActionResult, error) {
	if err := validateNamespacedTarget(req, expectedGroup, expectedResource); err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}

	restartedAt := time.Now().UTC().Format(time.RFC3339)
	patch := rolloutRestartPatch(restartedAt)

	if err := patchFn(ctx, req.Namespace, req.Name, patch); err != nil {
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
