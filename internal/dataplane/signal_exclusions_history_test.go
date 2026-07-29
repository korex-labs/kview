package dataplane

import (
	"testing"
	"time"
)

func TestExcludedSignalDoesNotUpdateOrDeleteHistory(t *testing.T) {
	manager := &manager{
		signalHistory: map[string]map[string]SignalHistoryRecord{"ctx": {}},
		signalAck:     map[string]map[string]SignalAcknowledgementRecord{"ctx": {}},
	}
	signal := ClusterDashboardSignal{
		SignalType: "pod_restarts", ResourceKind: "Pod", ResourceName: "api-0", Namespace: "apps",
	}
	key := signalHistoryIdentity(signal)
	manager.signalHistory["ctx"][key] = SignalHistoryRecord{SeenCount: 3, LastSeenAt: 100}
	policy := DefaultDataplanePolicy()
	policy.Signals.Overrides = map[string]SignalOverride{
		"pod_restarts": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{
			ID: "api", Conditions: []SignalExclusionCondition{{Source: "name", Pattern: "^api-0$"}},
		}}}},
	}
	filtered := applySignalPolicy([]ClusterDashboardSignal{signal}, policy, "ctx")
	if len(filtered) != 0 {
		t.Fatalf("expected signal to be excluded: %+v", filtered)
	}
	manager.attachSignalHistory("ctx", time.Now().UTC(), filtered...)
	record := manager.signalHistory["ctx"][key]
	if record.SeenCount != 3 || record.LastSeenAt != 100 {
		t.Fatalf("existing history was changed by suppression: %+v", record)
	}
}
