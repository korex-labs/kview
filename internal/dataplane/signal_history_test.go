package dataplane

import (
	"testing"
	"time"
)

func TestAttachSignalHistoryCountsDistinctObservationDays(t *testing.T) {
	m := &manager{
		signalHistory: map[string]map[string]SignalHistoryRecord{"ctx": {}},
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
	rec := SignalHistoryRecord{
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

func TestSignalHistoryTransferAndReset(t *testing.T) {
	dayOne := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC).Unix()
	dayTwo := time.Date(2026, time.July, 2, 0, 0, 0, 0, time.UTC).Unix()
	m := &manager{
		signalHistory: map[string]map[string]SignalHistoryRecord{
			"ctx": {
				"existing": {FirstSeenAt: dayOne, LastSeenAt: dayOne, SeenCount: 1, ObservedDays: []int64{dayOne}},
			},
		},
	}

	result, err := m.ImportSignalHistory("ctx", map[string]SignalHistoryRecord{
		"existing": {FirstSeenAt: dayOne, LastSeenAt: dayTwo, SeenCount: 2, ObservedDays: []int64{dayOne, dayTwo}},
		"new":      {FirstSeenAt: dayTwo, LastSeenAt: dayTwo, ObservedDays: []int64{dayTwo}},
		"invalid":  {FirstSeenAt: dayTwo, LastSeenAt: dayOne},
	}, "keepMine")
	if err != nil {
		t.Fatalf("import signal history: %v", err)
	}
	if result.Imported != 1 || result.Skipped != 1 {
		t.Fatalf("import result = %+v", result)
	}
	exported := m.ExportSignalHistory("ctx")
	if len(exported) != 2 || exported["new"].SeenCount != 1 {
		t.Fatalf("exported history = %+v", exported)
	}

	deleted, err := m.ResetSignalHistory("ctx", "existing")
	if err != nil || deleted != 1 {
		t.Fatalf("reset one signal = deleted %d, err %v", deleted, err)
	}
	deleted, err = m.ResetSignalHistory("ctx", "")
	if err != nil || deleted != 1 || len(m.ExportSignalHistory("ctx")) != 0 {
		t.Fatalf("reset context = deleted %d, err %v, remaining %+v", deleted, err, m.ExportSignalHistory("ctx"))
	}
}

func TestSignalHistoryReplaceSectionsRemovesMissingRecords(t *testing.T) {
	observed := time.Date(2026, time.July, 2, 0, 0, 0, 0, time.UTC).Unix()
	m := &manager{signalHistory: map[string]map[string]SignalHistoryRecord{
		"ctx": {
			"old":  {FirstSeenAt: observed, LastSeenAt: observed, ObservedDays: []int64{observed}},
			"keep": {FirstSeenAt: observed, LastSeenAt: observed, ObservedDays: []int64{observed}},
		},
	}}
	result, err := m.ImportSignalHistory("ctx", map[string]SignalHistoryRecord{
		"keep": {FirstSeenAt: observed, LastSeenAt: observed, ObservedDays: []int64{observed}},
	}, "replaceSections")
	if err != nil {
		t.Fatalf("replace signal history: %v", err)
	}
	if result.Imported != 1 || result.Replaced != 2 {
		t.Fatalf("replace result = %+v", result)
	}
	if _, ok := m.signalHistory["ctx"]["old"]; ok {
		t.Fatal("missing imported record was not removed")
	}
}
