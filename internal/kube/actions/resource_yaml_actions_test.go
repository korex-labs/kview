package actions

import "testing"

func TestManifestParam_Missing(t *testing.T) {
	_, result := manifestParam(ActionRequest{Params: map[string]any{}})
	if result == nil || result.Status != "error" {
		t.Fatal("expected error for missing manifest param")
	}
}

func TestManifestParam_NonString(t *testing.T) {
	_, result := manifestParam(ActionRequest{Params: map[string]any{"manifest": 42}})
	if result == nil || result.Status != "error" {
		t.Fatal("expected error for non-string manifest param")
	}
}

func TestManifestParam_Empty(t *testing.T) {
	_, result := manifestParam(ActionRequest{Params: map[string]any{"manifest": "   "}})
	if result == nil || result.Status != "error" {
		t.Fatal("expected error for empty manifest param")
	}
}

func TestManifestParam_Valid(t *testing.T) {
	val, result := manifestParam(ActionRequest{Params: map[string]any{"manifest": "apiVersion: v1"}})
	if result != nil {
		t.Fatalf("unexpected error result: %v", result.Message)
	}
	if val != "apiVersion: v1" {
		t.Fatalf("got %q, want %q", val, "apiVersion: v1")
	}
}

func TestOptionalStringParam_Missing(t *testing.T) {
	val, result := optionalStringParam(map[string]any{}, "key")
	if result != nil {
		t.Fatalf("unexpected error for missing optional param: %v", result.Message)
	}
	if val != "" {
		t.Fatalf("expected empty string for missing param, got %q", val)
	}
}

func TestOptionalStringParam_NonString(t *testing.T) {
	_, result := optionalStringParam(map[string]any{"key": true}, "key")
	if result == nil || result.Status != "error" {
		t.Fatal("expected error for non-string optional param")
	}
}

func TestOptionalStringParam_Valid(t *testing.T) {
	val, result := optionalStringParam(map[string]any{"key": "hello"}, "key")
	if result != nil {
		t.Fatalf("unexpected error: %v", result.Message)
	}
	if val != "hello" {
		t.Fatalf("got %q, want hello", val)
	}
}
