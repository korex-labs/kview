package kube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	apmeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	yamlutil "k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"

	"github.com/korex-labs/kview/internal/cluster"
)

// ApplyManifest parses a multi-document YAML manifest and applies each object
// using server-side apply. It returns the count of applied and skipped documents.
func ApplyManifest(ctx context.Context, c *cluster.Clients, defaultNamespace string, manifest string) (applied int, skipped int, err error) {
	dynClient, err := dynamic.NewForConfig(c.RestConfig)
	if err != nil {
		return 0, 0, fmt.Errorf("build dynamic client: %w", err)
	}

	cachedDisc := memory.NewMemCacheClient(c.Discovery)
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(cachedDisc)

	decoder := yamlutil.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)

	docs := bytes.Split([]byte(manifest), []byte("\n---"))
	for _, doc := range docs {
		trimmed := strings.TrimSpace(string(doc))
		if trimmed == "" {
			skipped++
			continue
		}

		// Remove leading comment lines (Helm adds "# Source: ...")
		trimmed = stripLeadingYAMLComments(trimmed)
		if strings.TrimSpace(trimmed) == "" {
			skipped++
			continue
		}

		obj := &unstructured.Unstructured{}
		_, gvk, decErr := decoder.Decode([]byte(trimmed), nil, obj)
		if decErr != nil {
			skipped++
			continue
		}
		if gvk == nil || gvk.Kind == "" || obj.GetName() == "" || obj.GetAPIVersion() == "" {
			skipped++
			continue
		}

		mapping, mapErr := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if mapErr != nil {
			log.Printf("github.com/korex-labs/kview/apply: RESTMapping failed gvk=%s name=%s ns=%s: %v",
				gvk, obj.GetName(), obj.GetNamespace(), mapErr)
			skipped++
			continue
		}

		// Set namespace if the object is namespaced and has none set.
		if mapping.Scope.Name() == apmeta.RESTScopeNameNamespace && obj.GetNamespace() == "" {
			obj.SetNamespace(defaultNamespace)
		}

		jsonBytes, marshalErr := json.Marshal(obj.Object)
		if marshalErr != nil {
			log.Printf("github.com/korex-labs/kview/apply: marshal failed gvk=%s name=%s ns=%s: %v",
				gvk, obj.GetName(), obj.GetNamespace(), marshalErr)
			skipped++
			continue
		}

		var ri dynamic.ResourceInterface
		if mapping.Scope.Name() == apmeta.RESTScopeNameNamespace {
			ri = dynClient.Resource(mapping.Resource).Namespace(obj.GetNamespace())
		} else {
			ri = dynClient.Resource(mapping.Resource)
		}

		force := true
		_, applyErr := ri.Patch(ctx, obj.GetName(), types.ApplyPatchType, jsonBytes, metav1.PatchOptions{
			FieldManager:    "kview",
			Force:           &force,
			FieldValidation: "Ignore",
		})
		if applyErr != nil {
			log.Printf("github.com/korex-labs/kview/apply: patch failed gvk=%s name=%s ns=%s: %v",
				gvk, obj.GetName(), obj.GetNamespace(), applyErr)
			skipped++
			continue
		}
		applied++
	}

	return applied, skipped, nil
}

func stripLeadingYAMLComments(s string) string {
	lines := strings.Split(s, "\n")
	i := 0
	for i < len(lines) {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			i++
			continue
		}
		if strings.HasPrefix(l, "#") {
			i++
			continue
		}
		break
	}
	return strings.Join(lines[i:], "\n")
}
