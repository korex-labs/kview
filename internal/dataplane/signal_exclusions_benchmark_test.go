package dataplane

import (
	"fmt"
	"testing"
)

func BenchmarkApplySignalExclusions10kCandidates50Rules(b *testing.B) {
	items := make([]ClusterDashboardSignal, 10_000)
	for i := range items {
		items[i] = ClusterDashboardSignal{
			SignalType:   "pod_restarts",
			ResourceKind: "Pod",
			ResourceName: fmt.Sprintf("pod-%d", i),
			Namespace:    "apps",
			MatchLabels:  map[string]string{"app": "api"},
		}
	}
	rules := make([]SignalExclusionRule, 50)
	for i := range rules {
		conditions := make([]SignalExclusionCondition, 8)
		for j := range conditions {
			conditions[j] = SignalExclusionCondition{Source: "name", Pattern: fmt.Sprintf("^ignored-%d-%d$", i, j)}
		}
		rules[i] = SignalExclusionRule{ID: fmt.Sprintf("rule-%d", i), Match: "all", Conditions: conditions}
	}
	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{
		"pod_restarts": {Exclusions: &SignalExclusionSet{Rules: rules}},
	}
	b.ResetTimer()
	for range b.N {
		if got := applySignalPolicy(items, policy, ""); len(got) != len(items) {
			b.Fatalf("unexpected filtered count: %d", len(got))
		}
	}
}
