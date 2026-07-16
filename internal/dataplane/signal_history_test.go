package dataplane

import (
	"testing"
	"time"
)

func TestAttachSignalHistoryCountsDistinctObservationDays(t *testing.T) {
	m := &manager{
		signalHistory: map[string]map[string]signalHistoryRecord{"ctx": {}},
		signalAck:     map[string]map[string]SignalAcknowledgementRecord{"ctx": {}},
	}
	signal := ClusterDashboardSignal{
		SignalType:    "pod_crash_loop_waiting",
		Scope:         "namespace",
		ScopeLocation: "apps",
		ResourceKind:  "Pod",
		ResourceName:  "api-0",
	}
	dayOne := time.Date(2026, time.July, 1, 10, 0, 0, 0, time.UTC)

	first := m.attachSignalHistory("ctx", dayOne, signal)
	second := m.attachSignalHistory("ctx", dayOne.Add(2*time.Hour), signal)
	third := m.attachSignalHistory("ctx", dayOne.Add(24*time.Hour), signal)
	stale := m.attachSignalHistory("ctx", dayOne.Add(3*time.Hour), signal)

	if first[0].ObservedDays7d != 1 || first[0].ObservedDays30d != 1 || first[0].Recurring {
		t.Fatalf("first observation memory = %+v", first[0])
	}
	if second[0].ObservedDays7d != 1 || second[0].Recurring {
		t.Fatalf("same-day refresh counted as recurrence: %+v", second[0])
	}
	if third[0].ObservedDays7d != 2 || third[0].ObservedDays30d != 2 || !third[0].Recurring {
		t.Fatalf("next-day observation did not become recurring: %+v", third[0])
	}
	if stale[0].ObservedDays7d != 2 || !stale[0].Recurring || stale[0].LastSeenAt != dayOne.Add(24*time.Hour).Unix() {
		t.Fatalf("stale observation regressed signal memory: %+v", stale[0])
	}

	key := signalHistoryIdentity(signal)
	rec := m.signalHistory["ctx"][key]
	if rec.SeenCount != 4 {
		t.Fatalf("raw seen count = %d, want 4", rec.SeenCount)
	}
	if len(rec.ObservedDays) != 2 {
		t.Fatalf("observed days = %v, want 2 distinct days", rec.ObservedDays)
	}
}

func TestNamespaceInsightSignalsPreserveSignalMemory(t *testing.T) {
	items := NamespaceInsightSignalsFromDashboard([]ClusterDashboardSignal{{
		Kind:            "Pod",
		Severity:        "medium",
		Reason:          "Pod is restarting",
		ObservedDays7d:  3,
		ObservedDays30d: 7,
		Recurring:       true,
	}})
	if len(items) != 1 || items[0].ObservedDays7d != 3 || items[0].ObservedDays30d != 7 || !items[0].Recurring {
		t.Fatalf("namespace signal memory = %+v", items)
	}
}

func TestSignalObservedDaysSeedsLegacyHistoryAndStaysBounded(t *testing.T) {
	observed := time.Date(2026, time.July, 10, 12, 0, 0, 0, time.UTC)
	rec := signalHistoryRecord{
		FirstSeenAt: observed.Add(-45 * 24 * time.Hour).Unix(),
		LastSeenAt:  observed.Add(-24 * time.Hour).Unix(),
		SeenCount:   20,
	}

	days := updateSignalObservedDays(rec, observed.Unix())
	if len(days) != 2 {
		t.Fatalf("legacy observed days = %v, want last-seen and current days", days)
	}
	if got := countSignalObservedDays(days, observed.Unix(), 7); got != 2 {
		t.Fatalf("observed days in 7d = %d, want 2", got)
	}
	if got := countSignalObservedDays(days, observed.Unix(), 30); got != 2 {
		t.Fatalf("observed days in 30d = %d, want 2", got)
	}

	for i := 1; i <= 40; i++ {
		at := observed.Add(time.Duration(i) * 24 * time.Hour)
		rec.ObservedDays = updateSignalObservedDays(rec, at.Unix())
		rec.FirstSeenAt = at.Unix()
		rec.LastSeenAt = at.Unix()
	}
	if len(rec.ObservedDays) > signalObservedDayRetention {
		t.Fatalf("observed days retained %d entries, want <= %d", len(rec.ObservedDays), signalObservedDayRetention)
	}
}
