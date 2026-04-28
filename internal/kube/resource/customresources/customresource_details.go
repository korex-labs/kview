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
	gvrVal := gvr(group, version, resource)
	var item *unstructured.Unstructured
	var err error

	if namespace != "" {
		item, err = dynClient.Resource(gvrVal).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		item, err = dynClient.Resource(gvrVal).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		return nil, err
	}

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

	summary := dto.CustomResourceSummaryDTO{
		Name:        item.GetName(),
		Namespace:   item.GetNamespace(),
		Group:       group,
		Version:     version,
		Kind:        item.GetKind(),
		AgeSec:      age,
		CreatedAt:   createdAt,
		Labels:      item.GetLabels(),
		Annotations: item.GetAnnotations(),
	}

	return &dto.CustomResourceDetailsDTO{
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

func extractConditions(obj map[string]interface{}) []dto.CRDConditionDTO {
	conditions, found, err := unstructured.NestedSlice(obj, "status", "conditions")
	if err != nil || !found || len(conditions) == 0 {
		return nil
	}
	out := make([]dto.CRDConditionDTO, 0, len(conditions))
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
		out = append(out, dto.CRDConditionDTO{
			Type:               t,
			Status:             s,
			Reason:             reason,
			Message:            message,
			LastTransitionTime: lastTransition,
		})
	}
	return out
}
