package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"

	"github.com/korex-labs/kview/internal/cluster"
)

func HandleCustomWorkloadAction(ctx context.Context, c *cluster.Clients, req ActionRequest) (*ActionResult, error) {
	if req.Namespace == "" || req.Name == "" {
		return &ActionResult{Status: "error", Message: "namespace and name are required"}, nil
	}
	gvr, err := workloadGVR(req)
	if err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}
	dyn, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return nil, err
	}

	op, _ := stringParam(req.Params, "op")
	if op == "patch" {
		patchType, _ := stringParam(req.Params, "patchType")
		body, _ := stringParam(req.Params, "patchBody")
		if body == "" {
			return &ActionResult{Status: "error", Message: "params.patchBody is required"}, nil
		}
		pt := types.MergePatchType
		if patchType == "json" {
			pt = types.JSONPatchType
		}
		if _, err := dyn.Resource(gvr).Namespace(req.Namespace).Patch(ctx, req.Name, pt, []byte(body), metav1.PatchOptions{}); err != nil {
			return nil, err
		}
		return &ActionResult{Status: "ok", Message: fmt.Sprintf("Patched %s %s/%s", req.Resource, req.Namespace, req.Name)}, nil
	}

	obj, err := dyn.Resource(gvr).Namespace(req.Namespace).Get(ctx, req.Name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	ops, matched, err := buildCustomWorkloadJSONPatch(obj, req.Params)
	if err != nil {
		return &ActionResult{Status: "error", Message: err.Error()}, nil
	}
	if matched == 0 {
		return &ActionResult{Status: "error", Message: "no containers matched the action"}, nil
	}
	patch, _ := json.Marshal(ops)
	if _, err := dyn.Resource(gvr).Namespace(req.Namespace).Patch(ctx, req.Name, types.JSONPatchType, patch, metav1.PatchOptions{}); err != nil {
		return nil, err
	}
	return &ActionResult{
		Status:  "ok",
		Message: fmt.Sprintf("Updated %s %s/%s", req.Resource, req.Namespace, req.Name),
		Details: map[string]any{"containersMatched": matched},
	}, nil
}

func workloadGVR(req ActionRequest) (schema.GroupVersionResource, error) {
	group := req.Group
	version := "v1"
	if req.APIVersion != "" {
		parts := strings.Split(req.APIVersion, "/")
		if len(parts) == 2 {
			group, version = parts[0], parts[1]
		} else {
			version = parts[0]
		}
	}
	if group != "apps" {
		return schema.GroupVersionResource{}, fmt.Errorf("custom workload actions currently support apps/v1 workloads only")
	}
	switch req.Resource {
	case "deployments", "daemonsets", "statefulsets", "replicasets":
		return schema.GroupVersionResource{Group: group, Version: version, Resource: req.Resource}, nil
	default:
		return schema.GroupVersionResource{}, fmt.Errorf("unsupported custom action resource %q", req.Resource)
	}
}

type jsonPatchOp map[string]any

func buildCustomWorkloadJSONPatch(obj *unstructured.Unstructured, params map[string]any) ([]jsonPatchOp, int, error) {
	containers, ok, err := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
	if err != nil || !ok {
		return nil, 0, fmt.Errorf("resource has no pod template containers")
	}
	op, _ := stringParam(params, "op")
	target, _ := stringParam(params, "target")
	key, _ := stringParam(params, "key")
	value, _ := stringParam(params, "value")
	containerPattern, _ := stringParam(params, "containerPattern")
	if target == "env" && key == "" {
		return nil, 0, fmt.Errorf("env key is required")
	}
	if op == "set" && value == "" {
		return nil, 0, fmt.Errorf("value is required")
	}
	var re *regexp.Regexp
	if containerPattern != "" {
		compiled, err := regexp.Compile(containerPattern)
		if err != nil {
			return nil, 0, fmt.Errorf("invalid container pattern: %w", err)
		}
		re = compiled
	}
	ops := []jsonPatchOp{}
	matched := 0
	for i, raw := range containers {
		container, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := container["name"].(string)
		if re != nil && !re.MatchString(name) {
			continue
		}
		matched++
		base := fmt.Sprintf("/spec/template/spec/containers/%d", i)
		switch target {
		case "image":
			if op != "set" {
				return nil, 0, fmt.Errorf("image target only supports set")
			}
			ops = append(ops, jsonPatchOp{"op": "replace", "path": base + "/image", "value": value})
		case "env":
			envRaw, hasEnv := container["env"].([]any)
			if !hasEnv {
				envRaw = []any{}
			}
			envIndex := -1
			hasValueFrom := false
			for idx, entryRaw := range envRaw {
				entry, ok := entryRaw.(map[string]any)
				if !ok {
					continue
				}
				if entry["name"] == key {
					envIndex = idx
					_, hasValueFrom = entry["valueFrom"]
					break
				}
			}
			if op == "unset" {
				if envIndex >= 0 {
					ops = append(ops, jsonPatchOp{"op": "remove", "path": fmt.Sprintf("%s/env/%d", base, envIndex)})
				}
				continue
			}
			if !hasEnv {
				ops = append(ops, jsonPatchOp{"op": "add", "path": base + "/env", "value": []any{}})
			}
			if envIndex >= 0 {
				if hasValueFrom {
					ops = append(ops, jsonPatchOp{"op": "remove", "path": fmt.Sprintf("%s/env/%d/valueFrom", base, envIndex)})
				}
				ops = append(ops, jsonPatchOp{"op": "add", "path": fmt.Sprintf("%s/env/%d/value", base, envIndex), "value": value})
			} else {
				ops = append(ops, jsonPatchOp{"op": "add", "path": base + "/env/-", "value": map[string]any{"name": key, "value": value}})
			}
		default:
			return nil, 0, fmt.Errorf("unsupported target %q", target)
		}
	}
	return ops, matched, nil
}

func stringParam(params map[string]any, key string) (string, bool) {
	raw, ok := params[key]
	if !ok {
		return "", false
	}
	value, ok := raw.(string)
	return strings.TrimSpace(value), ok
}
