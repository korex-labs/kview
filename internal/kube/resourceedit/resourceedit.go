package resourceedit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/restmapper"
	"sigs.k8s.io/yaml"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

const fieldManager = "kview-inline-edit"

type Request struct {
	Group        string
	Resource     string
	APIVersion   string
	Namespace    string
	Name         string
	Manifest     string
	BaseManifest string
}

type RiskAssessment struct {
	Severity     string
	Title        string
	Reasons      []string
	ChangedPaths []string
}

type Result struct {
	Warnings        []string
	NormalizedYAML  string
	ResourceVersion string
	UpdatedVersion  string
	Namespaced      bool
	Risk            RiskAssessment
}

type preparedEdit struct {
	obj      *unstructured.Unstructured
	mapping  *apimeta.RESTMapping
	warnings []string
	yaml     string
}

var (
	newDynamicClient = func(c *cluster.Clients) (dynamic.Interface, error) {
		return dynamic.NewForConfig(c.RestConfig)
	}
	newRESTMapper = func(d discovery.DiscoveryInterface) (apimeta.RESTMapper, error) {
		groupResources, err := restmapper.GetAPIGroupResources(d)
		if err != nil {
			return nil, err
		}
		return restmapper.NewDiscoveryRESTMapper(groupResources), nil
	}
)

func Validate(ctx context.Context, c *cluster.Clients, req Request) (*Result, error) {
	prepared, err := prepare(c, req)
	if err != nil {
		return nil, err
	}
	ri, err := resourceInterface(c, prepared.mapping, prepared.obj.GetNamespace())
	if err != nil {
		return nil, err
	}
	if _, err := ri.Update(ctx, prepared.obj, metav1.UpdateOptions{
		DryRun:          []string{metav1.DryRunAll},
		FieldManager:    fieldManager,
		FieldValidation: "Strict",
	}); err != nil {
		return nil, err
	}
	return &Result{
		Warnings:        prepared.warnings,
		NormalizedYAML:  prepared.yaml,
		ResourceVersion: prepared.obj.GetResourceVersion(),
		Namespaced:      prepared.mapping.Scope.Name() == apimeta.RESTScopeNameNamespace,
		Risk:            analyzeRisk(req, prepared.warnings, prepared.obj),
	}, nil
}

func Apply(ctx context.Context, c *cluster.Clients, req Request) (*Result, error) {
	prepared, err := prepare(c, req)
	if err != nil {
		return nil, err
	}
	ri, err := resourceInterface(c, prepared.mapping, prepared.obj.GetNamespace())
	if err != nil {
		return nil, err
	}
	updated, err := ri.Update(ctx, prepared.obj, metav1.UpdateOptions{
		FieldManager:    fieldManager,
		FieldValidation: "Strict",
	})
	if err != nil {
		return nil, err
	}
	return &Result{
		Warnings:        prepared.warnings,
		NormalizedYAML:  prepared.yaml,
		ResourceVersion: prepared.obj.GetResourceVersion(),
		UpdatedVersion:  updated.GetResourceVersion(),
		Namespaced:      prepared.mapping.Scope.Name() == apimeta.RESTScopeNameNamespace,
		Risk:            analyzeRisk(req, prepared.warnings, prepared.obj),
	}, nil
}

func prepare(c *cluster.Clients, req Request) (*preparedEdit, error) {
	obj, err := decodeSingleObject(req.Manifest)
	if err != nil {
		return nil, err
	}
	original := obj.DeepCopy()
	sanitizeObject(obj)
	if err := validateIdentity(req, obj); err != nil {
		return nil, err
	}
	mapping, err := resolveMapping(c, obj)
	if err != nil {
		return nil, err
	}
	if err := validateMapping(req, mapping); err != nil {
		return nil, err
	}
	normalizedYAML, err := marshalYAML(obj.Object)
	if err != nil {
		return nil, err
	}
	return &preparedEdit{
		obj:      obj,
		mapping:  mapping,
		warnings: collectWarnings(original, obj),
		yaml:     normalizedYAML,
	}, nil
}

func decodeSingleObject(manifest string) (*unstructured.Unstructured, error) {
	decoder := utilyaml.NewYAMLOrJSONDecoder(strings.NewReader(manifest), 4096)
	count := 0
	var object map[string]any
	for {
		var raw map[string]any
		if err := decoder.Decode(&raw); err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("decode YAML: %w", err)
		}
		if len(raw) == 0 {
			continue
		}
		count++
		if count > 1 {
			return nil, fmt.Errorf("exactly one YAML document is allowed")
		}
		object = raw
	}
	if count == 0 {
		return nil, fmt.Errorf("YAML document is empty")
	}
	return &unstructured.Unstructured{Object: object}, nil
}

func sanitizeObject(obj *unstructured.Unstructured) {
	unstructured.RemoveNestedField(obj.Object, "status")
	metadata, ok := obj.Object["metadata"].(map[string]any)
	if !ok {
		return
	}
	for _, field := range []string{
		"creationTimestamp",
		"deletionGracePeriodSeconds",
		"deletionTimestamp",
		"generateName",
		"generation",
		"managedFields",
		"selfLink",
		"uid",
	} {
		delete(metadata, field)
	}
	if len(metadata) == 0 {
		delete(obj.Object, "metadata")
	}
}

func validateIdentity(req Request, obj *unstructured.Unstructured) error {
	if strings.TrimSpace(obj.GetAPIVersion()) == "" {
		return fmt.Errorf("apiVersion is required")
	}
	if strings.TrimSpace(obj.GetKind()) == "" {
		return fmt.Errorf("kind is required")
	}
	if strings.TrimSpace(obj.GetName()) == "" {
		return fmt.Errorf("metadata.name is required")
	}
	if req.APIVersion != "" && obj.GetAPIVersion() != req.APIVersion {
		return fmt.Errorf("apiVersion must stay %q", req.APIVersion)
	}
	if req.Name != "" && obj.GetName() != req.Name {
		return fmt.Errorf("metadata.name must stay %q", req.Name)
	}
	switch {
	case req.Namespace == "" && strings.TrimSpace(obj.GetNamespace()) != "":
		return fmt.Errorf("cluster-scoped resources must not set metadata.namespace")
	case req.Namespace != "" && strings.TrimSpace(obj.GetNamespace()) == "":
		obj.SetNamespace(req.Namespace)
	case req.Namespace != "" && obj.GetNamespace() != req.Namespace:
		return fmt.Errorf("metadata.namespace must stay %q", req.Namespace)
	}
	if strings.TrimSpace(obj.GetResourceVersion()) == "" {
		return fmt.Errorf("metadata.resourceVersion is required for conflict-aware live edit")
	}
	return nil
}

func resolveMapping(c *cluster.Clients, obj *unstructured.Unstructured) (*apimeta.RESTMapping, error) {
	mapper, err := newRESTMapper(c.Discovery)
	if err != nil {
		return nil, fmt.Errorf("build REST mapper: %w", err)
	}
	gv, err := schema.ParseGroupVersion(obj.GetAPIVersion())
	if err != nil {
		return nil, fmt.Errorf("parse apiVersion %q: %w", obj.GetAPIVersion(), err)
	}
	mapping, err := mapper.RESTMapping(gv.WithKind(obj.GetKind()).GroupKind(), gv.Version)
	if err != nil {
		return nil, fmt.Errorf("resolve resource mapping: %w", err)
	}
	return mapping, nil
}

func validateMapping(req Request, mapping *apimeta.RESTMapping) error {
	if mapping == nil {
		return fmt.Errorf("resource mapping is required")
	}
	if req.Group != mapping.Resource.Group {
		return fmt.Errorf("resource group must stay %q", req.Group)
	}
	if req.Resource != mapping.Resource.Resource {
		return fmt.Errorf("resource kind must stay %q", req.Resource)
	}
	return nil
}

func resourceInterface(c *cluster.Clients, mapping *apimeta.RESTMapping, namespace string) (dynamic.ResourceInterface, error) {
	client, err := newDynamicClient(c)
	if err != nil {
		return nil, fmt.Errorf("build dynamic client: %w", err)
	}
	if mapping.Scope.Name() == apimeta.RESTScopeNameNamespace {
		return client.Resource(mapping.Resource).Namespace(namespace), nil
	}
	return client.Resource(mapping.Resource), nil
}

func marshalYAML(object map[string]any) (string, error) {
	jsonBytes, err := json.Marshal(object)
	if err != nil {
		return "", fmt.Errorf("marshal object: %w", err)
	}
	yamlBytes, err := yaml.JSONToYAML(jsonBytes)
	if err != nil {
		return "", fmt.Errorf("encode YAML: %w", err)
	}
	return string(yamlBytes), nil
}

func collectWarnings(original, sanitized *unstructured.Unstructured) []string {
	warnings := []string{}
	if len(original.GetOwnerReferences()) > 0 {
		warnings = append(warnings, "This resource has owner references and may be reconciled by another controller.")
	}
	annotations := sanitized.GetAnnotations()
	if strings.EqualFold(annotations["app.kubernetes.io/managed-by"], "helm") ||
		strings.TrimSpace(annotations["meta.helm.sh/release-name"]) != "" {
		warnings = append(warnings, "This resource appears to be Helm-managed; live edits may drift from the chart state.")
	}
	if strings.EqualFold(sanitized.GetKind(), "Secret") {
		warnings = append(warnings, "Secret data is applied exactly as written; keep base64 values and key names deliberate.")
	}
	if _, found, _ := unstructured.NestedFieldNoCopy(original.Object, "status"); found {
		warnings = append(warnings, "The status field is ignored during live edit and was removed before validation.")
	}
	if metadataSanitized(original) {
		warnings = append(warnings, "Server-managed metadata fields were removed before validation and apply.")
	}
	return warnings
}

func metadataSanitized(original *unstructured.Unstructured) bool {
	metadata, ok := original.Object["metadata"].(map[string]any)
	if !ok {
		return false
	}
	for _, field := range []string{
		"creationTimestamp",
		"deletionGracePeriodSeconds",
		"deletionTimestamp",
		"generateName",
		"generation",
		"managedFields",
		"selfLink",
		"uid",
	} {
		if _, exists := metadata[field]; exists {
			return true
		}
	}
	return false
}

func ConflictReloadHint(err error) string {
	if !apierrors.IsConflict(err) {
		return ""
	}
	return "The resource changed since this YAML was loaded. Reload the latest YAML and apply your edit again."
}

func NormalizeYAMLString(value string) string {
	obj, err := decodeSingleObject(value)
	if err != nil {
		return value
	}
	sanitizeObject(obj)
	out, err := marshalYAML(obj.Object)
	if err != nil {
		return value
	}
	return string(bytes.TrimRight([]byte(out), "\n")) + "\n"
}

func analyzeRisk(req Request, warnings []string, current *unstructured.Unstructured) RiskAssessment {
	changedPaths := []string{}
	if strings.TrimSpace(req.BaseManifest) != "" {
		if baseObj, err := decodeSingleObject(req.BaseManifest); err == nil {
			sanitizeObject(baseObj)
			changedPaths = diffObjectPaths("", baseObj.Object, current.Object)
		}
	}

	reasons := []string{}
	if len(changedPaths) == 0 {
		reasons = append(reasons, "No structural YAML changes detected from the loaded object.")
	} else {
		reasons = append(reasons, fmt.Sprintf("%d field path(s) changed from the loaded object.", len(changedPaths)))
	}

	kind := strings.ToLower(strings.TrimSpace(current.GetKind()))
	controllerManaged := false
	for _, warning := range warnings {
		lower := strings.ToLower(warning)
		if strings.Contains(lower, "owner references") || strings.Contains(lower, "helm-managed") || strings.Contains(lower, "controller") {
			controllerManaged = true
			break
		}
	}
	if controllerManaged || strings.Contains("deployment,statefulset,daemonset,job,ingress,service", kind) {
		reasons = append(reasons, "This resource is typically controller-managed, so live edits may drift or be overwritten.")
	}
	if kind == "secret" {
		reasons = append(reasons, "Secret values apply exactly as written; malformed base64 or key changes are easy to miss.")
	}

	hasPath := func(fragment string) bool {
		for _, path := range changedPaths {
			if strings.Contains(strings.ToLower(path), fragment) {
				return true
			}
		}
		return false
	}

	immutableRisk := false
	if hasPath("spec.selector") {
		immutableRisk = true
		reasons = append(reasons, "Selector changes are commonly immutable for workload-style resources.")
	}
	if hasPath("spec.clusterip") || hasPath("spec.clusterips") || hasPath("spec.ipfamilies") || hasPath("spec.ports") {
		if kind == "service" {
			immutableRisk = true
			reasons = append(reasons, "Service networking or allocated port fields may be immutable or allocation-sensitive.")
		}
	}
	if hasPath("spec.volumeclaimtemplates") && kind == "statefulset" {
		immutableRisk = true
		reasons = append(reasons, "StatefulSet volume claim template edits usually need recreation or a deliberate migration.")
	}
	if kind == "job" && (hasPath("spec.template") || hasPath("spec.completions") || hasPath("spec.parallelism")) {
		immutableRisk = true
		reasons = append(reasons, "Job template and execution-shape changes are often not patchable in place after creation.")
	}

	severity := "success"
	title := "Ready To Review"
	switch {
	case immutableRisk:
		severity = "error"
		title = "Likely Recreate Needed"
	case controllerManaged || kind == "secret" || kind == "ingress" || kind == "service":
		severity = "warning"
		title = "Guarded Live Edit"
	case len(changedPaths) > 0:
		severity = "info"
		title = "Live Edit Looks Plausible"
	}

	return RiskAssessment{
		Severity:     severity,
		Title:        title,
		Reasons:      uniqueStrings(reasons),
		ChangedPaths: changedPaths,
	}
}

func diffObjectPaths(prefix string, before, after any) []string {
	if reflect.DeepEqual(before, after) {
		return nil
	}
	switch b := before.(type) {
	case map[string]any:
		aMap, ok := after.(map[string]any)
		if !ok {
			if prefix == "" {
				return []string{"<root>"}
			}
			return []string{prefix}
		}
		keys := map[string]struct{}{}
		for key := range b {
			keys[key] = struct{}{}
		}
		for key := range aMap {
			keys[key] = struct{}{}
		}
		out := []string{}
		for key := range keys {
			next := key
			if prefix != "" {
				next = prefix + "." + key
			}
			out = append(out, diffObjectPaths(next, b[key], aMap[key])...)
		}
		sort.Strings(out)
		return uniqueStrings(out)
	case []any:
		aList, ok := after.([]any)
		if !ok || len(b) != len(aList) {
			if prefix == "" {
				return []string{"<root>"}
			}
			return []string{prefix}
		}
		out := []string{}
		for i := range b {
			next := fmt.Sprintf("%s[%d]", prefix, i)
			out = append(out, diffObjectPaths(next, b[i], aList[i])...)
		}
		sort.Strings(out)
		return uniqueStrings(out)
	default:
		if prefix == "" {
			return []string{"<root>"}
		}
		return []string{prefix}
	}
}

func uniqueStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, item := range in {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}
