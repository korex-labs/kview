package customresources

import (
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func gvr(group, version, resource string) schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: group, Version: version, Resource: resource}
}

// crSignal derives a best-effort health signal from .status.conditions or .status.phase.
func crSignal(obj map[string]interface{}) (severity, statusSummary string) {
	conditions, found, _ := unstructured.NestedSlice(obj, "status", "conditions")
	if found && len(conditions) > 0 {
		for _, c := range conditions {
			cm, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			t, _, _ := unstructured.NestedString(cm, "type")
			s, _, _ := unstructured.NestedString(cm, "status")
			if t == "Ready" {
				if s == "True" {
					return "ok", "Ready"
				}
				reason, _, _ := unstructured.NestedString(cm, "reason")
				if reason != "" {
					return "warning", reason
				}
				return "warning", "Not Ready"
			}
		}
		for _, c := range conditions {
			cm, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			s, _, _ := unstructured.NestedString(cm, "status")
			if s == "False" {
				t, _, _ := unstructured.NestedString(cm, "type")
				reason, _, _ := unstructured.NestedString(cm, "reason")
				if reason != "" {
					return "warning", reason
				}
				return "warning", t + "=False"
			}
		}
		return "ok", ""
	}

	phase, found, _ := unstructured.NestedString(obj, "status", "phase")
	if found && phase != "" {
		switch strings.ToLower(phase) {
		case "running", "active", "bound", "ready", "available", "succeeded":
			return "ok", phase
		case "failed", "error":
			return "error", phase
		case "pending", "terminating":
			return "warning", phase
		default:
			return "unknown", phase
		}
	}

	return "unknown", ""
}
