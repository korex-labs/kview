package customresources

import "testing"

func TestCRSignalConservativeConditions(t *testing.T) {
	condition := func(typ, status string) map[string]interface{} {
		return map[string]interface{}{"type": typ, "status": status}
	}
	tests := []struct {
		name                 string
		conditions           []interface{}
		generation, observed int64
		phase, want          string
	}{
		{name: "degraded true", conditions: []interface{}{condition("Degraded", "True")}, want: "warning"},
		{name: "degraded false alone is not readiness", conditions: []interface{}{condition("Degraded", "False")}, want: "unknown"},
		{name: "arbitrary true", conditions: []interface{}{condition("Installed", "True")}, want: "unknown"},
		{name: "arbitrary false", conditions: []interface{}{condition("Installed", "False")}, want: "unknown"},
		{name: "ready unknown", conditions: []interface{}{condition("Ready", "Unknown")}, want: "unknown"},
		{name: "ready legacy", conditions: []interface{}{condition("Ready", "True")}, want: "ok"},
		{name: "ready false", conditions: []interface{}{condition("Ready", "False")}, want: "warning"},
		{name: "conflict", conditions: []interface{}{condition("Ready", "True"), condition("Degraded", "True")}, want: "warning"},
		{name: "reverse conflict", conditions: []interface{}{condition("Degraded", "True"), condition("Ready", "True")}, want: "warning"},
		{name: "unknown blocks healthy", conditions: []interface{}{condition("Ready", "True"), condition("Available", "Unknown")}, want: "unknown"},
		{name: "unrecognized does not defeat ready", conditions: []interface{}{condition("Ready", "True"), condition("Installed", "False")}, want: "ok"},
		{name: "current", conditions: []interface{}{condition("Ready", "True")}, generation: 2, observed: 2, want: "ok"},
		{name: "stale", conditions: []interface{}{condition("Ready", "True")}, generation: 2, observed: 1, want: "unknown"},
		{name: "stale failure", conditions: []interface{}{condition("Degraded", "True")}, generation: 2, observed: 1, want: "unknown"},
		{name: "future", conditions: []interface{}{condition("Ready", "True")}, generation: 2, observed: 3, want: "unknown"},
		{name: "missing observation", conditions: []interface{}{condition("Ready", "True")}, generation: 2, want: "unknown"},
		{name: "missing state", want: "unknown"},
		{name: "legacy phase", phase: "Running", want: "ok"},
		{name: "stale phase", phase: "Running", generation: 2, observed: 1, want: "unknown"},
		{name: "unknown conditions prevent phase fallback", conditions: []interface{}{condition("Installed", "True")}, phase: "Running", want: "unknown"},
		{name: "malformed condition prevents phase fallback", conditions: []interface{}{"bad"}, phase: "Running", want: "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := map[string]interface{}{}
			obj := map[string]interface{}{"status": status}
			if tt.conditions != nil {
				status["conditions"] = tt.conditions
			}
			if tt.phase != "" {
				status["phase"] = tt.phase
			}
			if tt.generation != 0 {
				obj["metadata"] = map[string]interface{}{"generation": tt.generation}
			}
			if tt.observed != 0 {
				status["observedGeneration"] = tt.observed
			}
			got, _ := crSignal(obj)
			if got != tt.want {
				t.Fatalf("got %s, want %s", got, tt.want)
			}
		})
	}
}

func TestCRSignalConditionGenerationOverridesStatusGeneration(t *testing.T) {
	for _, tc := range []struct {
		condition, root int64
		want            string
	}{{1, 2, "unknown"}, {2, 1, "ok"}, {0, 2, "unknown"}} {
		obj := map[string]interface{}{"metadata": map[string]interface{}{"generation": int64(2)}, "status": map[string]interface{}{"observedGeneration": tc.root, "conditions": []interface{}{map[string]interface{}{"type": "Ready", "status": "True", "observedGeneration": tc.condition}}}}
		got, _ := crSignal(obj)
		if got != tc.want {
			t.Fatalf("condition=%d root=%d got %s want %s", tc.condition, tc.root, got, tc.want)
		}
	}
}
