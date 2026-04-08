package actions

import "testing"

func TestBuildDeleteOptions_ForceSetsZeroGracePeriod(t *testing.T) {
	opts, result := buildDeleteOptions(ActionRequest{
		Params: map[string]any{"force": true},
	})
	if result != nil {
		t.Fatalf("unexpected result: %#v", result)
	}
	if opts.GracePeriodSeconds == nil {
		t.Fatal("GracePeriodSeconds was nil")
	}
	if *opts.GracePeriodSeconds != 0 {
		t.Fatalf("GracePeriodSeconds: got %d, want 0", *opts.GracePeriodSeconds)
	}
	if opts.PropagationPolicy == nil {
		t.Fatal("PropagationPolicy was nil")
	}
	if got := string(*opts.PropagationPolicy); got != "Background" {
		t.Fatalf("PropagationPolicy: got %q, want Background", got)
	}
}

func TestBuildDeleteOptions_InvalidForceParam(t *testing.T) {
	_, result := buildDeleteOptions(ActionRequest{
		Params: map[string]any{"force": "true"},
	})
	if result == nil {
		t.Fatal("expected validation result")
	}
	if result.Status != "error" {
		t.Fatalf("status: got %q, want error", result.Status)
	}
	if result.Message != "params.force must be a boolean" {
		t.Fatalf("message: got %q", result.Message)
	}
}
