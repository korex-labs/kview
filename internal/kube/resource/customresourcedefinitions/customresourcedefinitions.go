package customresourcedefinitions

import (
	"context"
	"fmt"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

var crdGVR = schema.GroupVersionResource{
	Group:    "apiextensions.k8s.io",
	Version:  "v1",
	Resource: "customresourcedefinitions",
}

func ListCustomResourceDefinitions(ctx context.Context, c *cluster.Clients) ([]dto.CRDListItemDTO, error) {
	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}

	list, err := dynClient.Resource(crdGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.CRDListItemDTO, 0, len(list.Items))

	for _, item := range list.Items {
		name := item.GetName()
		age := int64(0)
		ts := item.GetCreationTimestamp()
		if !ts.IsZero() {
			age = int64(now.Sub(ts.Time).Seconds())
		}

		group, _, _ := unstructured.NestedString(item.Object, "spec", "group")
		scope, _, _ := unstructured.NestedString(item.Object, "spec", "scope")
		kind, _, _ := unstructured.NestedString(item.Object, "spec", "names", "kind")
		plural, _, _ := unstructured.NestedString(item.Object, "spec", "names", "plural")
		versions := crdVersionsCompact(item.Object)
		storageVersion := crdStorageVersion(item.Object)
		established := crdIsEstablished(item.Object)

		out = append(out, dto.CRDListItemDTO{
			Name:           name,
			Group:          group,
			Scope:          scope,
			Kind:           kind,
			Plural:         plural,
			Versions:       versions,
			StorageVersion: storageVersion,
			Established:    established,
			AgeSec:         age,
		})
	}

	return out, nil
}

// crdVersionsCompact returns a compact string like "v1 (served, storage), v1beta1 (served)".
func crdVersionsCompact(obj map[string]interface{}) string {
	versions, found, err := unstructured.NestedSlice(obj, "spec", "versions")
	if err != nil || !found || len(versions) == 0 {
		return "-"
	}

	parts := make([]string, 0, len(versions))
	for _, v := range versions {
		vm, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		vName, _, _ := unstructured.NestedString(vm, "name")
		if vName == "" {
			continue
		}

		served, _, _ := unstructured.NestedBool(vm, "served")
		storage, _, _ := unstructured.NestedBool(vm, "storage")

		var flags []string
		if served {
			flags = append(flags, "served")
		}
		if storage {
			flags = append(flags, "storage")
		}

		if len(flags) > 0 {
			parts = append(parts, fmt.Sprintf("%s (%s)", vName, strings.Join(flags, ", ")))
		} else {
			parts = append(parts, vName)
		}
	}

	if len(parts) == 0 {
		return "-"
	}
	return strings.Join(parts, ", ")
}

// crdStorageVersion returns the storage version name, falling back to the first served version.
func crdStorageVersion(obj map[string]interface{}) string {
	versions, found, err := unstructured.NestedSlice(obj, "spec", "versions")
	if err != nil || !found || len(versions) == 0 {
		return ""
	}
	// Prefer the storage version.
	for _, v := range versions {
		vm, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		storage, _, _ := unstructured.NestedBool(vm, "storage")
		if storage {
			name, _, _ := unstructured.NestedString(vm, "name")
			return name
		}
	}
	// Fall back to first served version.
	for _, v := range versions {
		vm, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		served, _, _ := unstructured.NestedBool(vm, "served")
		if served {
			name, _, _ := unstructured.NestedString(vm, "name")
			return name
		}
	}
	return ""
}

// crdIsEstablished checks status.conditions for Established=True.
func crdIsEstablished(obj map[string]interface{}) bool {
	conditions, found, err := unstructured.NestedSlice(obj, "status", "conditions")
	if err != nil || !found {
		return false
	}
	for _, c := range conditions {
		cm, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		t, _, _ := unstructured.NestedString(cm, "type")
		s, _, _ := unstructured.NestedString(cm, "status")
		if t == "Established" && s == "True" {
			return true
		}
	}
	return false
}
