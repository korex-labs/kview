package customresources

import (
	"context"
	"encoding/json"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

func TestCustomResourceInspectionJSONPresence(t *testing.T) {
	for _, raw := range []string{"absent", "null", "{}", "[]", "false", "0", `""`, `{"nested":[false,0,null]}`} {
		t.Run(raw, func(t *testing.T) {
			obj := map[string]interface{}{"apiVersion": "example.com/v1", "kind": "Widget", "metadata": map[string]interface{}{"name": "demo", "uid": "uid-1", "resourceVersion": "42", "generation": int64(0)}}
			if raw != "absent" {
				var value interface{}
				if err := json.Unmarshal([]byte(raw), &value); err != nil {
					t.Fatal(err)
				}
				obj["spec"], obj["status"] = value, value
			}
			client := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), &unstructured.Unstructured{Object: obj})
			got, err := GetCustomResourceDetails(context.Background(), client, "example.com", "v1", "widgets", "", "demo")
			if err != nil {
				t.Fatal(err)
			}
			b, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]json.RawMessage
			if err := json.Unmarshal(b, &wire); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"spec", "status"} {
				value, exists := wire[key]
				if raw == "absent" {
					if exists {
						t.Fatalf("%s unexpectedly present: %s", key, b)
					}
					continue
				}
				if string(value) != raw {
					t.Errorf("%s = %s, want %s", key, value, raw)
				}
			}
			var summary map[string]json.RawMessage
			if err := json.Unmarshal(wire["summary"], &summary); err != nil {
				t.Fatal(err)
			}
			for key, want := range map[string]string{"uid": `"uid-1"`, "resourceVersion": `"42"`, "generation": "0"} {
				if string(summary[key]) != want {
					t.Errorf("summary.%s=%s want %s", key, summary[key], want)
				}
			}
			if _, exists := summary["statusObservedGeneration"]; exists {
				t.Fatal("invented observed generation")
			}
		})
	}
}

func TestCustomResourceInspectionObservedGeneration(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "example.com/v1", "kind": "Widget", "metadata": map[string]interface{}{"name": "demo"},
		"status": map[string]interface{}{"observedGeneration": int64(0), "conditions": []interface{}{
			map[string]interface{}{"type": "Ready", "status": "True", "observedGeneration": int64(0)},
			map[string]interface{}{"type": "Other", "status": "Unknown"},
		}},
	}}
	client := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), obj)
	got, err := GetCustomResourceDetails(context.Background(), client, "example.com", "v1", "widgets", "", "demo")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(got)
	var wire struct {
		Summary    map[string]json.RawMessage
		Conditions []map[string]json.RawMessage
	}
	if err := json.Unmarshal(b, &wire); err != nil {
		t.Fatal(err)
	}
	if string(wire.Summary["statusObservedGeneration"]) != "0" || string(wire.Conditions[0]["observedGeneration"]) != "0" {
		t.Fatalf("lost explicit zero: %s", b)
	}
	if _, ok := wire.Summary["generation"]; ok {
		t.Fatalf("invented generation: %s", b)
	}
	if _, ok := wire.Conditions[1]["observedGeneration"]; ok {
		t.Fatalf("invented condition generation: %s", b)
	}
}
