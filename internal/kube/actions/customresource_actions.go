package actions

import (
	"context"
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// HandleCustomResourceDelete deletes an arbitrary custom resource instance.
func HandleCustomResourceDelete(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if req.Group == "" {
		return &ActionResult{Status: "error", Message: "group is required"}, nil
	}
	if req.Resource == "" {
		return &ActionResult{Status: "error", Message: "resource is required"}, nil
	}
	if req.APIVersion == "" {
		return &ActionResult{Status: "error", Message: "apiVersion is required"}, nil
	}
	if req.Name == "" {
		return &ActionResult{Status: "error", Message: "name is required"}, nil
	}

	version := req.APIVersion
	if group, splitVersion, ok := strings.Cut(req.APIVersion, "/"); ok {
		if group != req.Group {
			return &ActionResult{Status: "error", Message: fmt.Sprintf("apiVersion group %q does not match group %q", group, req.Group)}, nil
		}
		version = splitVersion
	}
	if version == "" {
		return &ActionResult{Status: "error", Message: "apiVersion version is required"}, nil
	}

	opts, errResult := buildDeleteOptions(req)
	if errResult != nil {
		return errResult, nil
	}

	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return &ActionResult{Status: "error", Message: fmt.Sprintf("dynamic client: %v", err)}, nil
	}

	gvr := schema.GroupVersionResource{
		Group:    req.Group,
		Version:  version,
		Resource: req.Resource,
	}

	var resource dynamic.ResourceInterface = dynClient.Resource(gvr)
	if req.Namespace != "" {
		resource = dynClient.Resource(gvr).Namespace(req.Namespace)
	}

	if err := resource.Delete(ctx, req.Name, opts); err != nil {
		return nil, err
	}

	force := opts.GracePeriodSeconds != nil && *opts.GracePeriodSeconds == 0
	target := req.Name
	if req.Namespace != "" {
		target = fmt.Sprintf("%s/%s", req.Namespace, req.Name)
	}
	message := fmt.Sprintf("Deleted custom resource %s", target)
	if force {
		message = fmt.Sprintf("Requested force delete for custom resource %s", target)
	}
	return &ActionResult{
		Status:  "ok",
		Message: message,
		Details: map[string]any{
			"group":     req.Group,
			"version":   version,
			"resource":  req.Resource,
			"namespace": req.Namespace,
			"name":      req.Name,
			"force":     force,
		},
	}, nil
}
