package customresources

import (
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func gvr(group, version, resource string) schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: group, Version: version, Resource: resource}
}

// crSignal deliberately recognizes only common readiness and failure conditions.
// Absence of a failure is not positive health evidence. Current failure evidence
// wins over readiness; uncertain recognized evidence prevents an OK result.
func crSignal(obj map[string]interface{}) (severity, statusSummary string) {
	conditions, found, err := unstructured.NestedSlice(obj, "status", "conditions")
	if err != nil {
		return "unknown", "Invalid conditions"
	}
	if found && len(conditions) > 0 {
		healthy, failure, uncertain := "", "", ""
		for _, c := range conditions {
			cm, ok := c.(map[string]interface{})
			if !ok {
				uncertain = "Invalid conditions"
				continue
			}
			typ, _, _ := unstructured.NestedString(cm, "type")
			positive := typ == "Ready" || typ == "Available" || typ == "Healthy"
			negative := typ == "Degraded" || typ == "Failed" || typ == "Stalled"
			if !positive && !negative {
				continue
			}
			if !crEvidenceCurrent(obj, cm) {
				uncertain = "Generation not observed"
				continue
			}
			status, _, _ := unstructured.NestedString(cm, "status")
			if status != "True" && status != "False" {
				uncertain = "Unknown condition status"
				continue
			}
			if (positive && status == "False") || (negative && status == "True") {
				reason, _, _ := unstructured.NestedString(cm, "reason")
				if reason == "" {
					reason = typ + "=" + status
				}
				if failure == "" || reason < failure {
					failure = reason
				}
			} else if positive && (healthy == "" || typ < healthy) {
				healthy = typ
			}
		}
		if failure != "" {
			return "warning", failure
		}
		if uncertain != "" {
			return "unknown", uncertain
		}
		if healthy != "" {
			return "ok", healthy
		}
		return "unknown", "No supported readiness condition"
	}
	// Legacy phase fallback is used only without conditions, and is subject to the
	// same freshness check. Objects without generation metadata remain supported.
	if !crEvidenceCurrent(obj, nil) {
		return "unknown", "Generation not observed"
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

// A condition's observedGeneration takes precedence over the status-level
// fallback. Missing observations on versioned objects, malformed values, and
// both older and impossible future observations are uncertain, not healthy.
func crEvidenceCurrent(obj, condition map[string]interface{}) bool {
	generation, found, err := unstructured.NestedInt64(obj, "metadata", "generation")
	if err != nil {
		return false
	}
	observed, present, err := unstructured.NestedInt64(condition, "observedGeneration")
	if err != nil {
		return false
	}
	if !present {
		observed, present, err = unstructured.NestedInt64(obj, "status", "observedGeneration")
	}
	if err != nil {
		return false
	}
	if !found || generation == 0 {
		return !present || observed == 0
	}
	return generation > 0 && present && observed == generation
}
