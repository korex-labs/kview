package resourceedit

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestDecodeSingleObjectRejectsMultipleDocuments(t *testing.T) {
	_, err := decodeSingleObject(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: one
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: two
`)
	if err == nil || !strings.Contains(err.Error(), "exactly one YAML document") {
		t.Fatalf("expected multi-document error, got %v", err)
	}
}

func TestValidateIdentityRequiresResourceVersion(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":      "cm",
			"namespace": "ns",
		},
	}}
	err := validateIdentity(Request{
		Resource:   "configmaps",
		APIVersion: "v1",
		Namespace:  "ns",
		Name:       "cm",
	}, obj)
	if err == nil || !strings.Contains(err.Error(), "resourceVersion") {
		t.Fatalf("expected resourceVersion error, got %v", err)
	}
}

func TestSanitizeObjectRemovesServerManagedFieldsAndStatus(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":              "cm",
			"namespace":         "ns",
			"resourceVersion":   "7",
			"uid":               "abc",
			"managedFields":     []any{map[string]any{"manager": "kubectl"}},
			"creationTimestamp": "2026-04-23T00:00:00Z",
		},
		"status": map[string]any{"phase": "ignored"},
	}}

	sanitizeObject(obj)

	if _, found, _ := unstructured.NestedFieldNoCopy(obj.Object, "status"); found {
		t.Fatalf("expected status to be removed")
	}
	if _, found, _ := unstructured.NestedString(obj.Object, "metadata", "uid"); found {
		t.Fatalf("expected metadata.uid to be removed")
	}
	rv, found, _ := unstructured.NestedString(obj.Object, "metadata", "resourceVersion")
	if !found || rv != "7" {
		t.Fatalf("expected metadata.resourceVersion to be preserved, got %q found=%v", rv, found)
	}
}

func TestCollectWarningsDetectsManagedResources(t *testing.T) {
	original := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]any{
			"name":              "sec",
			"namespace":         "ns",
			"resourceVersion":   "3",
			"uid":               "uid-1",
			"managedFields":     []any{map[string]any{"manager": "helm"}},
			"ownerReferences":   []any{map[string]any{"kind": "Deployment", "name": "app"}},
			"annotations":       map[string]any{"meta.helm.sh/release-name": "demo"},
			"creationTimestamp": "2026-04-23T00:00:00Z",
		},
		"status": map[string]any{"phase": "ignored"},
	}}
	sanitized := original.DeepCopy()
	sanitizeObject(sanitized)

	warnings := collectWarnings(original, sanitized)
	text := strings.Join(warnings, "\n")
	for _, expected := range []string{
		"owner references",
		"Helm-managed",
		"Secret data",
		"status field is ignored",
		"Server-managed metadata fields",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected warning containing %q, got %q", expected, text)
		}
	}
}

func TestAnalyzeRiskDetectsSelectorChange(t *testing.T) {
	current, err := decodeSingleObject(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  namespace: ns
  resourceVersion: "7"
spec:
  selector:
    matchLabels:
      app: v2
`)
	if err != nil {
		t.Fatalf("decode current: %v", err)
	}
	risk := analyzeRisk(Request{
		BaseManifest: `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  namespace: ns
  resourceVersion: "7"
spec:
  selector:
    matchLabels:
      app: v1
`,
	}, nil, current)
	if risk.Severity != "error" {
		t.Fatalf("expected error severity, got %q", risk.Severity)
	}
	if !strings.Contains(strings.Join(risk.ChangedPaths, "\n"), "spec.selector") {
		t.Fatalf("expected selector path in changed paths, got %#v", risk.ChangedPaths)
	}
}

func TestAnalyzeRiskMarksSecretAsGuarded(t *testing.T) {
	current, err := decodeSingleObject(`
apiVersion: v1
kind: Secret
metadata:
  name: sec
  namespace: ns
  resourceVersion: "3"
data:
  token: YWJj
`)
	if err != nil {
		t.Fatalf("decode current: %v", err)
	}
	risk := analyzeRisk(Request{}, nil, current)
	if risk.Severity != "warning" {
		t.Fatalf("expected warning severity, got %q", risk.Severity)
	}
	if risk.Title == "" || len(risk.Reasons) == 0 {
		t.Fatalf("expected populated risk summary, got %#v", risk)
	}
}

func TestBuildMergePatchOnlyIncludesChangedFields(t *testing.T) {
	base, err := decodeSingleObject(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: ns
  resourceVersion: "7"
  uid: ignored
data:
  keep: same
  old: value
`)
	if err != nil {
		t.Fatalf("decode base: %v", err)
	}
	edited, err := decodeSingleObject(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: ns
  resourceVersion: "7"
  uid: ignored
data:
  keep: same
  old: changed
  added: value
`)
	if err != nil {
		t.Fatalf("decode edited: %v", err)
	}
	sanitizeObject(base)
	sanitizeObject(edited)

	patch, err := buildMergePatch(base.Object, edited.Object)
	if err != nil {
		t.Fatalf("build patch: %v", err)
	}
	got := string(patch)
	for _, expected := range []string{`"data"`, `"old":"changed"`, `"added":"value"`} {
		if !strings.Contains(got, expected) {
			t.Fatalf("expected patch to contain %s, got %s", expected, got)
		}
	}
	for _, unexpected := range []string{`resourceVersion`, `uid`, `apiVersion`, `kind`} {
		if strings.Contains(got, unexpected) {
			t.Fatalf("expected patch not to contain %s, got %s", unexpected, got)
		}
	}
}

func TestBuildMergePatchDetectsEmptyPatch(t *testing.T) {
	obj, err := decodeSingleObject(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: ns
  resourceVersion: "7"
data:
  keep: same
`)
	if err != nil {
		t.Fatalf("decode object: %v", err)
	}
	patch, err := buildMergePatch(obj.Object, obj.DeepCopy().Object)
	if err != nil {
		t.Fatalf("build patch: %v", err)
	}
	if !isEmptyJSONPatch(patch) {
		t.Fatalf("expected empty patch, got %s", string(patch))
	}
}
