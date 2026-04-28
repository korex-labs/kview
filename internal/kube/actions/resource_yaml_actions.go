package actions

import (
	"context"
	"fmt"
	"strings"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/resourceedit"
)

func manifestParam(req ActionRequest) (string, *ActionResult) {
	raw, ok := req.Params["manifest"]
	if !ok {
		return "", &ActionResult{Status: "error", Message: "params.manifest is required"}
	}
	value, ok := raw.(string)
	if !ok {
		return "", &ActionResult{Status: "error", Message: "params.manifest must be a string"}
	}
	if strings.TrimSpace(value) == "" {
		return "", &ActionResult{Status: "error", Message: "params.manifest must not be empty"}
	}
	return value, nil
}

func optionalStringParam(params map[string]any, key string) (string, *ActionResult) {
	raw, ok := params[key]
	if !ok {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", &ActionResult{Status: "error", Message: fmt.Sprintf("params.%s must be a string", key)}
	}
	return value, nil
}

func editRequest(req ActionRequest, manifest string, baseManifest string) resourceedit.Request {
	return resourceedit.Request{
		Group:        req.Group,
		Resource:     req.Resource,
		APIVersion:   req.APIVersion,
		Namespace:    req.Namespace,
		Name:         req.Name,
		Manifest:     manifest,
		BaseManifest: baseManifest,
	}
}

func HandleResourceYAMLValidate(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	manifest, errResult := manifestParam(req)
	if errResult != nil {
		return errResult, nil
	}
	baseManifest, errResult := optionalStringParam(req.Params, "baseManifest")
	if errResult != nil {
		return errResult, nil
	}
	result, err := resourceedit.Validate(ctx, c, editRequest(req, manifest, baseManifest))
	if err != nil {
		if hint := resourceedit.ConflictReloadHint(err); hint != "" {
			return nil, fmt.Errorf("%w: %s", err, hint)
		}
		return nil, err
	}
	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Validated YAML for %s", req.Name),
		Details: map[string]any{
			"warnings":        result.Warnings,
			"normalizedYaml":  result.NormalizedYAML,
			"resourceVersion": result.ResourceVersion,
			"namespaced":      result.Namespaced,
			"risk":            result.Risk,
		},
	}, nil
}

func HandleResourceYAMLApply(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	manifest, errResult := manifestParam(req)
	if errResult != nil {
		return errResult, nil
	}
	baseManifest, errResult := optionalStringParam(req.Params, "baseManifest")
	if errResult != nil {
		return errResult, nil
	}
	result, err := resourceedit.Apply(ctx, c, editRequest(req, manifest, baseManifest))
	if err != nil {
		if hint := resourceedit.ConflictReloadHint(err); hint != "" {
			return nil, fmt.Errorf("%w: %s", err, hint)
		}
		return nil, err
	}
	target := req.Name
	if req.Namespace != "" {
		target = req.Namespace + "/" + req.Name
	}
	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Applied live YAML edit to %s", target),
		Details: map[string]any{
			"warnings":               result.Warnings,
			"normalizedYaml":         result.NormalizedYAML,
			"resourceVersion":        result.ResourceVersion,
			"updatedResourceVersion": result.UpdatedVersion,
			"namespaced":             result.Namespaced,
			"risk":                   result.Risk,
		},
	}, nil
}
