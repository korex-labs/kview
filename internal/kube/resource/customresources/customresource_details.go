package customresources

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"k8s.io/client-go/dynamic"
)

// GetCustomResourceDetails fetches and normalises a single CR instance.
func GetCustomResourceDetails(ctx context.Context, dynClient dynamic.Interface, group, version, resource, namespace, name string) (*dto.CustomResourceDetailsDTO, error) {
	item, err := GetCustomResource(ctx, dynClient, group, version, resource, namespace, name)
	if err != nil {
		return nil, err
	}
	return customResourceDetails(item, group, version)
}

// GetCustomResource performs only an exact object GET; no discovery or list is needed.
func GetCustomResource(ctx context.Context, dynClient dynamic.Interface, group, version, resource, namespace, name string) (*unstructured.Unstructured, error) {
	gvrVal := gvr(group, version, resource)
	var item *unstructured.Unstructured
	var err error

	if namespace != "" {
		item, err = dynClient.Resource(gvrVal).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		item, err = dynClient.Resource(gvrVal).Get(ctx, name, metav1.GetOptions{})
	}
	return item, err
}

func customResourceDetails(item *unstructured.Unstructured, group, version string) (*dto.CustomResourceDetailsDTO, error) {
	y, err := crYAML(item)
	if err != nil {
		return nil, fmt.Errorf("yaml: %w", err)
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	ts := item.GetCreationTimestamp()
	if !ts.IsZero() {
		createdAt = ts.Unix()
		age = int64(now.Sub(ts.Time).Seconds())
	}

	severity, statusSummary := crSignal(item.Object)
	summary := dto.CustomResourceSummaryDTO{
		UID:                      string(item.GetUID()),
		ResourceVersion:          item.GetResourceVersion(),
		Generation:               optionalInt64(item.Object, "metadata", "generation"),
		StatusObservedGeneration: optionalInt64(item.Object, "status", "observedGeneration"),
		Name:                     item.GetName(),
		Namespace:                item.GetNamespace(),
		Group:                    group,
		Version:                  version,
		Kind:                     item.GetKind(),
		AgeSec:                   age,
		CreatedAt:                createdAt,
		SignalSeverity:           severity,
		StatusSummary:            statusSummary,
		Labels:                   item.GetLabels(),
		Annotations:              item.GetAnnotations(),
	}

	spec, err := rawField(item.Object, "spec")
	if err != nil {
		return nil, err
	}
	status, err := rawField(item.Object, "status")
	if err != nil {
		return nil, err
	}
	return &dto.CustomResourceDetailsDTO{
		Spec:       spec,
		Status:     status,
		Summary:    summary,
		Conditions: extractConditions(item.Object),
		YAML:       string(y),
	}, nil
}

func crYAML(item *unstructured.Unstructured) ([]byte, error) {
	copy := item.DeepCopy()
	unstructured.RemoveNestedField(copy.Object, "metadata", "managedFields")
	b, err := json.Marshal(copy.Object)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}

func rawField(obj map[string]interface{}, key string) (json.RawMessage, error) {
	value, exists := obj[key]
	if !exists {
		return nil, nil
	}
	return json.Marshal(value)
}

func optionalInt64(obj map[string]interface{}, fields ...string) *int64 {
	value, found, err := unstructured.NestedInt64(obj, fields...)
	if err != nil || !found {
		return nil
	}
	return &value
}

func extractConditions(obj map[string]interface{}) []dto.CustomResourceConditionDTO {
	conditions, found, err := unstructured.NestedSlice(obj, "status", "conditions")
	if err != nil || !found || len(conditions) == 0 {
		return nil
	}
	out := make([]dto.CustomResourceConditionDTO, 0, len(conditions))
	for _, c := range conditions {
		cm, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		t, _, _ := unstructured.NestedString(cm, "type")
		s, _, _ := unstructured.NestedString(cm, "status")
		reason, _, _ := unstructured.NestedString(cm, "reason")
		message, _, _ := unstructured.NestedString(cm, "message")

		var lastTransition int64
		ltStr, _, _ := unstructured.NestedString(cm, "lastTransitionTime")
		if ltStr != "" {
			if parsed, pErr := time.Parse(time.RFC3339, ltStr); pErr == nil {
				lastTransition = parsed.Unix()
			}
		}
		out = append(out, dto.CustomResourceConditionDTO{
			ObservedGeneration: optionalInt64(cm, "observedGeneration"),
			CRDConditionDTO: dto.CRDConditionDTO{
				Type:               t,
				Status:             s,
				Reason:             reason,
				Message:            message,
				LastTransitionTime: lastTransition,
			},
		})
	}
	return out
}
