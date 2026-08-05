package dataplane

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestSignalExclusionRuleMatchesStructuredConditions(t *testing.T) {
	item := ClusterDashboardSignal{
		Namespace:    "testing",
		Name:         "worker-canary-0",
		ResourceName: "worker-canary-0",
		Labels:       map[string]string{"app.kubernetes.io/component": "worker"},
		Annotations:  map[string]string{"kview.io/ignore": "expected-failure"},
	}

	tests := []struct {
		name string
		rule SignalExclusionRule
		want bool
	}{
		{
			name: "all conditions",
			rule: SignalExclusionRule{Match: "all", Conditions: []SignalExclusionCondition{
				{Source: "namespace", Operator: "regex", Pattern: "^test"},
				{Source: "name", Operator: "regex", Pattern: "canary-[0-9]+$"},
				{Source: "label", Key: "app.kubernetes.io/component", Operator: "regex", Pattern: "^worker$"},
			}},
			want: true,
		},
		{
			name: "all rejects one mismatch",
			rule: SignalExclusionRule{Match: "all", Conditions: []SignalExclusionCondition{
				{Source: "name", Operator: "regex", Pattern: "canary"},
				{Source: "label", Key: "team", Operator: "regex", Pattern: "platform"},
			}},
			want: false,
		},
		{
			name: "any accepts one match",
			rule: SignalExclusionRule{Match: "any", Conditions: []SignalExclusionCondition{
				{Source: "name", Operator: "regex", Pattern: "does-not-match"},
				{Source: "annotation", Key: "kview.io/ignore", Operator: "exists"},
			}},
			want: true,
		},
		{
			name: "case insensitive",
			rule: SignalExclusionRule{Conditions: []SignalExclusionCondition{
				{Source: "annotation", Key: "kview.io/ignore", Operator: "regex", Pattern: "EXPECTED", Flags: "i"},
			}},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := signalExclusionRuleMatches(item, tt.rule); got != tt.want {
				t.Fatalf("signalExclusionRuleMatches() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestApplySignalPolicyExcludesBeforePresentation(t *testing.T) {
	enabled := true
	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{}
	policy.Signals.Overrides["pod_crash_loop_waiting"] = SignalOverride{
		Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{
			{
				ID:      "ignore-canary",
				Enabled: &enabled,
				Conditions: []SignalExclusionCondition{
					{Source: "name", Operator: "regex", Pattern: "^canary-"},
				},
			},
		}},
	}
	items := []ClusterDashboardSignal{
		{SignalType: "pod_crash_loop_waiting", ResourceName: "canary-api"},
		{SignalType: "pod_crash_loop_waiting", ResourceName: "production-api"},
	}

	got := applySignalPolicy(items, policy, "")
	if len(got) != 1 || got[0].ResourceName != "production-api" {
		t.Fatalf("unexpected filtered signals: %+v", got)
	}
}

func TestSignalExclusionContextReplacementAndExplicitEmpty(t *testing.T) {
	global := SignalExclusionSet{Rules: []SignalExclusionRule{{
		ID: "global", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "^global-"}},
	}}}
	context := SignalExclusionSet{Rules: []SignalExclusionRule{{
		ID: "context", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "^context-"}},
	}}}
	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{}
	policy.Signals.Overrides["pod_restarts"] = SignalOverride{Exclusions: &global}
	policy.Signals.ContextOverrides = map[string]map[string]SignalOverride{
		"cluster-a": {"pod_restarts": {Exclusions: &context}},
		"cluster-b": {"pod_restarts": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{}}}},
	}

	clusterA := effectiveSignalSettings(policy, "cluster-a", "pod_restarts")
	if clusterA.exclusions == nil || len(clusterA.exclusions.Rules) != 1 || clusterA.exclusions.Rules[0].ID != "context" {
		t.Fatalf("context exclusions did not replace global: %+v", clusterA.exclusions)
	}
	clusterB := effectiveSignalSettings(policy, "cluster-b", "pod_restarts")
	if clusterB.exclusions == nil || len(clusterB.exclusions.Rules) != 0 {
		t.Fatalf("explicit empty context exclusions were not preserved: %+v", clusterB.exclusions)
	}
}

func TestValidateSignalExclusionsRejectsInvalidRegex(t *testing.T) {
	bundle := DefaultDataplanePolicyBundle()
	bundle.Global.Signals.Overrides = map[string]SignalOverride{}
	bundle.Global.Signals.Overrides["pod_restarts"] = SignalOverride{
		Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
			ID: "invalid", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "["}},
		}}},
	}
	if err := ValidateSignalExclusions(bundle); err == nil {
		t.Fatal("expected invalid regex to be rejected")
	}
}

func TestNormalizeSignalOverridePreservesExplicitEmptyExclusions(t *testing.T) {
	got := normalizeSignalOverride(SignalOverride{Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{}}})
	if got.Exclusions == nil {
		t.Fatal("expected explicit empty exclusions to be preserved")
	}
	if signalOverrideEmpty(got) {
		t.Fatal("explicit empty exclusions must keep the override")
	}
}

func TestDashboardSignalsUseCachedMetadataWithoutDisclosingIt(t *testing.T) {
	snapshots := dashboardSnapshotSet{
		restartThreshold: 1,
		podsOK:           true,
		pods: PodsSnapshot{Items: []dto.PodListItemDTO{{
			Name:        "api-0",
			Namespace:   "apps",
			Restarts:    4,
			Labels:      map[string]string{"track": "canary"},
			Annotations: map[string]string{"example.com/private": "do-not-return"},
		}}},
	}
	items := detectDashboardSignals(time.Time{}, "apps", snapshots)
	var restart *ClusterDashboardSignal
	for i := range items {
		if items[i].SignalType == "pod_restarts" {
			restart = &items[i]
			break
		}
	}
	if restart == nil || restart.MatchLabels["track"] != "canary" || restart.MatchAnnotations["example.com/private"] != "do-not-return" {
		t.Fatalf("cached metadata not attached to signal: %+v", restart)
	}
	payload, err := json.Marshal(restart)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "do-not-return") {
		t.Fatalf("matching-only annotation leaked into signal JSON: %s", payload)
	}

	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{
		"pod_restarts": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
			ID: "canary", Conditions: []SignalExclusionCondition{{Source: "label", Key: "track", Pattern: "^canary$"}},
		}}}},
	}
	if got := applySignalPolicy(items, policy, ""); len(got) != 0 {
		t.Fatalf("expected metadata exclusion to remove signal, got %+v", got)
	}
}

func TestNamespaceSignalExclusionUsesCachedNamespaceMetadata(t *testing.T) {
	items := enrichSignalsFromMetadataIndex([]ClusterDashboardSignal{{
		SignalType: "empty_namespace", ResourceKind: "Namespace", ResourceName: "sandbox",
	}}, namespaceSignalMetadataIndex(NamespaceSnapshot{Items: []dto.NamespaceListItemDTO{{
		Name: "sandbox", Labels: map[string]string{"lifecycle": "temporary"},
	}}}))
	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{
		"empty_namespace": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
			ID: "temporary", Conditions: []SignalExclusionCondition{{Source: "label", Key: "lifecycle", Pattern: "^temporary$"}},
		}}}},
	}
	if got := applySignalPolicy(items, policy, ""); len(got) != 0 {
		t.Fatalf("expected namespace metadata exclusion to remove signal, got %+v", got)
	}
}

func TestSignalMatchingMetadataIsNotSerializedFromListDTOs(t *testing.T) {
	payload, err := json.Marshal(dto.SecretDTO{
		Name: "credentials", Namespace: "apps",
		Labels:      map[string]string{"team": "payments"},
		Annotations: map[string]string{"example.com/private": "do-not-return"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "payments") || strings.Contains(string(payload), "do-not-return") || strings.Contains(string(payload), "annotations") {
		t.Fatalf("matching metadata leaked into list DTO JSON: %s", payload)
	}
}

func TestSignalExclusionRegexDoesNotMatchMissingMetadataKey(t *testing.T) {
	rule := SignalExclusionRule{Conditions: []SignalExclusionCondition{{Source: "label", Key: "missing", Pattern: ".*"}}}
	if signalExclusionRuleMatches(ClusterDashboardSignal{Labels: map[string]string{"other": "value"}}, rule) {
		t.Fatal("missing label key must not be treated as an empty value")
	}
}
