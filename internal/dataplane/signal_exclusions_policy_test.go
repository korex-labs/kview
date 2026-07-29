package dataplane

import "testing"

func TestCloneDataplanePolicyBundleDoesNotAliasContextExclusions(t *testing.T) {
	bundle := DefaultDataplanePolicyBundle()
	bundle.ContextOverrides = map[string]DataplanePolicyOverride{
		"ctx": {Signals: &SignalsPolicyOverride{Overrides: map[string]SignalOverride{
			"pod_restarts": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
				ID: "original", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "^api$"}},
			}}}},
		}}},
	}
	clone := CloneDataplanePolicyBundle(bundle)
	clone.ContextOverrides["ctx"].Signals.Overrides["pod_restarts"].Exclusions.Rules[0].ID = "mutated"
	if got := bundle.ContextOverrides["ctx"].Signals.Overrides["pod_restarts"].Exclusions.Rules[0].ID; got != "original" {
		t.Fatalf("context exclusions were aliased: %q", got)
	}
}

func TestPolicyBundleContextSignalOverridesMergePerSignal(t *testing.T) {
	disabled := false
	bundle := DefaultDataplanePolicyBundle()
	bundle.Global.Signals.Overrides = map[string]SignalOverride{
		"pod_restarts": {
			Enabled: &disabled,
			Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
				ID: "global", Conditions: []SignalExclusionCondition{{Source: "namespace", Pattern: "^test$"}},
			}}},
		},
		"pod_crash_loop_waiting": {Severity: "high"},
	}
	bundle.ContextOverrides = map[string]DataplanePolicyOverride{
		"ctx": {Signals: &SignalsPolicyOverride{Overrides: map[string]SignalOverride{
			"pod_restarts": {Severity: "low", Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{}}},
		}}},
	}

	effective := bundle.EffectivePolicy("ctx")
	restarts := effective.Signals.Overrides["pod_restarts"]
	if restarts.Enabled == nil || *restarts.Enabled || restarts.Severity != "low" {
		t.Fatalf("context override did not merge sparse fields: %+v", restarts)
	}
	if restarts.Exclusions == nil || len(restarts.Exclusions.Rules) != 0 {
		t.Fatalf("explicit empty context exclusions were not preserved: %+v", restarts.Exclusions)
	}
	if effective.Signals.Overrides["pod_crash_loop_waiting"].Severity != "high" {
		t.Fatal("context override replaced unrelated global signal overrides")
	}
}
