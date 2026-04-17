package customresourcedefinitions

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetCustomResourceDefinitionDetails(ctx context.Context, c *cluster.Clients, name string) (*dto.CRDDetailsDTO, error) {
	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}

	item, err := dynClient.Resource(crdGVR).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	y, err := crdYAML(item)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	createdAt := int64(0)
	ts := item.GetCreationTimestamp()
	if !ts.IsZero() {
		createdAt = ts.Unix()
		age = int64(now.Sub(ts.Time).Seconds())
	}

	group, _, _ := unstructured.NestedString(item.Object, "spec", "group")
	scope, _, _ := unstructured.NestedString(item.Object, "spec", "scope")
	kind, _, _ := unstructured.NestedString(item.Object, "spec", "names", "kind")
	plural, _, _ := unstructured.NestedString(item.Object, "spec", "names", "plural")
	singular, _, _ := unstructured.NestedString(item.Object, "spec", "names", "singular")
	shortNames := nestedStringSlice(item.Object, "spec", "names", "shortNames")
	categories := nestedStringSlice(item.Object, "spec", "names", "categories")
	conversionStrategy, _, _ := unstructured.NestedString(item.Object, "spec", "conversion", "strategy")

	summary := dto.CRDSummaryDTO{
		Name:               name,
		Group:              group,
		Scope:              scope,
		Kind:               kind,
		Plural:             plural,
		Singular:           singular,
		ShortNames:         shortNames,
		Categories:         categories,
		ConversionStrategy: conversionStrategy,
		Established:        crdIsEstablished(item.Object),
		AgeSec:             age,
		CreatedAt:          createdAt,
	}

	versions := extractCRDVersions(item.Object)
	conditions := extractCRDConditions(item.Object)

	metadata := dto.CRDMetadataDTO{
		Labels:      item.GetLabels(),
		Annotations: item.GetAnnotations(),
	}

	return &dto.CRDDetailsDTO{
		Summary:    summary,
		Versions:   versions,
		Conditions: conditions,
		Metadata:   metadata,
		YAML:       string(y),
	}, nil
}

func GetCustomResourceDefinitionYAML(ctx context.Context, c *cluster.Clients, name string) (string, error) {
	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return "", fmt.Errorf("dynamic client: %w", err)
	}

	item, err := dynClient.Resource(crdGVR).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}

	y, err := crdYAML(item)
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func crdYAML(item *unstructured.Unstructured) ([]byte, error) {
	copy := item.DeepCopy()
	// Strip managedFields
	unstructured.RemoveNestedField(copy.Object, "metadata", "managedFields")
	// Strip large schema bodies to keep YAML readable
	// (full schemas can be very large; keep them in YAML since users expect full output)
	b, err := json.Marshal(copy.Object)
	if err != nil {
		return nil, err
	}
	return yaml.JSONToYAML(b)
}

func extractCRDVersions(obj map[string]interface{}) []dto.CRDVersionDTO {
	versions, found, err := unstructured.NestedSlice(obj, "spec", "versions")
	if err != nil || !found || len(versions) == 0 {
		return nil
	}

	out := make([]dto.CRDVersionDTO, 0, len(versions))
	for _, v := range versions {
		vm, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		vName, _, _ := unstructured.NestedString(vm, "name")
		served, _, _ := unstructured.NestedBool(vm, "served")
		storage, _, _ := unstructured.NestedBool(vm, "storage")
		deprecated, _, _ := unstructured.NestedBool(vm, "deprecated")
		deprecationWarning, _, _ := unstructured.NestedString(vm, "deprecationWarning")

		out = append(out, dto.CRDVersionDTO{
			Name:               vName,
			Served:             served,
			Storage:            storage,
			Deprecated:         deprecated,
			DeprecationWarning: deprecationWarning,
		})
	}
	return out
}

func extractCRDConditions(obj map[string]interface{}) []dto.CRDConditionDTO {
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

// nestedStringSlice extracts a []string from a nested unstructured path.
func nestedStringSlice(obj map[string]interface{}, fields ...string) []string {
	val, found, err := unstructured.NestedStringSlice(obj, fields...)
	if err != nil || !found || len(val) == 0 {
		return nil
	}
	return val
}
