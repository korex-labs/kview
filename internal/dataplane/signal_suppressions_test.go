package dataplane

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSignalSuppressionNormalizeRequestAcceptsAllowedModes(t *testing.T) {
	tests := []struct {
		name string
		in   SignalSuppressionRequest
	}{
		{
			name: "one hour snooze",
			in: SignalSuppressionRequest{
				HistoryKey:      " pod_restarts|namespace|Pod|default|api ",
				Mode:            " snooze ",
				DurationSeconds: 3600,
				Comment:         " planned rollout ",
			},
		},
		{
			name: "one day snooze",
			in: SignalSuppressionRequest{
				HistoryKey:      "pod_restarts|namespace|Pod|default|api",
				Mode:            SignalSuppressionModeSnooze,
				DurationSeconds: 86400,
			},
		},
		{
			name: "until changed",
			in: SignalSuppressionRequest{
				HistoryKey:          "pod_restarts|namespace|Pod|default|api",
				Mode:                SignalSuppressionModeUntilChanged,
				BaselineFingerprint: "v1:" + strings.Repeat("f", 64),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeSignalSuppressionRequest(tt.in)
			if err != nil {
				t.Fatalf("normalizeSignalSuppressionRequest() error = %v", err)
			}
			if got.HistoryKey != strings.TrimSpace(tt.in.HistoryKey) {
				t.Fatalf("HistoryKey = %q", got.HistoryKey)
			}
			if got.Mode != strings.TrimSpace(tt.in.Mode) {
				t.Fatalf("Mode = %q", got.Mode)
			}
			if got.Comment != strings.TrimSpace(tt.in.Comment) {
				t.Fatalf("Comment = %q", got.Comment)
			}
		})
	}
}

func TestSignalSuppressionNormalizeRequestUnicodeCharacterLimits(t *testing.T) {
	validKey := "pod_restarts|namespace|Pod|default|api"
	tests := []struct {
		name    string
		key     string
		comment string
		wantErr bool
	}{
		{name: "history key exactly at limit", key: strings.Repeat("界", maxSignalSuppressionHistoryKeyLen)},
		{name: "history key over limit", key: strings.Repeat("界", maxSignalSuppressionHistoryKeyLen+1), wantErr: true},
		{name: "comment exactly at limit", key: validKey, comment: strings.Repeat("界", maxSignalSuppressionCommentLen)},
		{name: "comment over limit", key: validKey, comment: strings.Repeat("界", maxSignalSuppressionCommentLen+1), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeSignalSuppressionRequest(SignalSuppressionRequest{
				HistoryKey:      tt.key,
				Mode:            SignalSuppressionModeSnooze,
				DurationSeconds: SignalSuppressionDurationOneHourSeconds,
				Comment:         tt.comment,
			})
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeSignalSuppressionRequest() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSignalSuppressionNormalizeRequestRejectsInvalidInput(t *testing.T) {
	validKey := "pod_restarts|namespace|Pod|default|api"
	validFingerprint := "v1:" + strings.Repeat("f", 64)
	tests := []struct {
		name string
		in   SignalSuppressionRequest
	}{
		{name: "missing key", in: SignalSuppressionRequest{Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600}},
		{name: "key too long", in: SignalSuppressionRequest{HistoryKey: strings.Repeat("k", maxSignalSuppressionHistoryKeyLen+1), Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600}},
		{name: "unsupported mode", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: "forever"}},
		{name: "unsupported snooze duration", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeSnooze, DurationSeconds: 60}},
		{name: "snooze baseline", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600, BaselineFingerprint: validFingerprint}},
		{name: "until changed missing baseline", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeUntilChanged}},
		{name: "until changed duration", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeUntilChanged, DurationSeconds: 3600, BaselineFingerprint: validFingerprint}},
		{name: "comment too long", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600, Comment: strings.Repeat("c", maxSignalSuppressionCommentLen+1)}},
		{name: "fingerprint too long", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: strings.Repeat("f", maxSignalSuppressionFingerprintLen+1)}},
		{name: "malformed fingerprint", in: SignalSuppressionRequest{HistoryKey: validKey, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: "v1:not-a-digest"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeSignalSuppressionRequest(tt.in); err == nil {
				t.Fatal("normalizeSignalSuppressionRequest() error = nil")
			}
		})
	}
}

func TestSignalSuppressionFingerprintContract(t *testing.T) {
	base := ClusterDashboardSignal{
		SignalType:     "pod_restarts",
		Severity:       "medium",
		Scope:          "namespace",
		ScopeLocation:  "node-a",
		ResourceKind:   "Pod",
		ResourceName:   "api-123",
		Namespace:      "default",
		ActualData:     "  restart count:  4\nwithin 5m ",
		CalculatedData: " threshold   exceeded ",
		Reason:         "wording that is not structured evidence",
	}
	fingerprint := clusterDashboardSignalStateFingerprint(base)
	if !strings.HasPrefix(fingerprint, "v1:") {
		t.Fatalf("fingerprint %q has no stable version prefix", fingerprint)
	}
	if len(fingerprint) != len("v1:")+64 {
		t.Fatalf("fingerprint length = %d", len(fingerprint))
	}

	whitespaceOnly := base
	whitespaceOnly.ActualData = "restart count: 4 within\t5m"
	whitespaceOnly.CalculatedData = "threshold exceeded"
	whitespaceOnly.Reason = "completely different ignored wording"
	if got := clusterDashboardSignalStateFingerprint(whitespaceOnly); got != fingerprint {
		t.Fatalf("whitespace-only evidence change altered fingerprint: %q != %q", got, fingerprint)
	}

	changes := map[string]ClusterDashboardSignal{
		"evidence": func() ClusterDashboardSignal { out := base; out.ActualData = "restart count: 5 within 5m"; return out }(),
		"severity": func() ClusterDashboardSignal { out := base; out.Severity = "high"; return out }(),
		"identity": func() ClusterDashboardSignal { out := base; out.ResourceName = "api-456"; return out }(),
	}
	for name, changed := range changes {
		t.Run(name, func(t *testing.T) {
			if got := clusterDashboardSignalStateFingerprint(changed); got == fingerprint {
				t.Fatalf("fingerprint did not change for %s", name)
			}
		})
	}
}

func TestSignalSuppressionFingerprintReasonFallback(t *testing.T) {
	base := ClusterDashboardSignal{
		SignalType:   "pod_restarts",
		Severity:     "medium",
		Scope:        "namespace",
		ResourceKind: "Pod",
		ResourceName: "api",
		Namespace:    "default",
		Reason:       " restarted   four times ",
	}
	fingerprint := clusterDashboardSignalStateFingerprint(base)
	whitespaceOnly := base
	whitespaceOnly.Reason = "restarted four\ntimes"
	if got := clusterDashboardSignalStateFingerprint(whitespaceOnly); got != fingerprint {
		t.Fatalf("reason whitespace altered fallback fingerprint: %q != %q", got, fingerprint)
	}
	changed := base
	changed.Reason = "restarted five times"
	if got := clusterDashboardSignalStateFingerprint(changed); got == fingerprint {
		t.Fatal("reason evidence change did not alter fallback fingerprint")
	}
}

func TestSignalSuppressionRecordActive(t *testing.T) {
	now := time.Unix(2_000_000_000, 0)
	current := "v1:" + strings.Repeat("a", 64)

	tests := []struct {
		name   string
		record SignalSuppressionRecord
		fp     string
		want   bool
	}{
		{name: "one hour active", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1 + SignalSuppressionDurationOneHourSeconds, FingerprintVersion: SignalFingerprintVersion}, fp: current, want: true},
		{name: "one day active", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1 + SignalSuppressionDurationOneDaySeconds, FingerprintVersion: SignalFingerprintVersion}, fp: current, want: true},
		{name: "arbitrary positive duration inactive", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1 + 7200, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "exact expiry boundary inactive", record: SignalSuppressionRecord{CreatedAt: now.Unix() - SignalSuppressionDurationOneHourSeconds, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix(), FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "unchanged evidence active", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: current, FingerprintVersion: SignalFingerprintVersion}, fp: current, want: true},
		{name: "changed evidence inactive", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: current, FingerprintVersion: SignalFingerprintVersion}, fp: "v1:" + strings.Repeat("b", 64)},
		{name: "version mismatch", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: current, FingerprintVersion: 2}, fp: current},
		{name: "unsupported mode", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: "forever", ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "missing expiry", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "empty baseline", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "empty current fingerprint", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: current, FingerprintVersion: SignalFingerprintVersion}},
		{name: "snooze empty current fingerprint", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}},
		{name: "missing created timestamp", record: SignalSuppressionRecord{UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "missing updated timestamp", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "future created timestamp", record: SignalSuppressionRecord{CreatedAt: now.Unix() + 1, UpdatedAt: now.Unix() + 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "future updated timestamp", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() + 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() + 3600, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "snooze expiry not after creation", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1, FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "malformed baseline", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: "v1:not-a-digest", FingerprintVersion: SignalFingerprintVersion}, fp: current},
		{name: "multibyte comment exactly at limit active", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1 + SignalSuppressionDurationOneHourSeconds, FingerprintVersion: SignalFingerprintVersion, Comment: strings.Repeat("界", maxSignalSuppressionCommentLen)}, fp: current, want: true},
		{name: "multibyte comment over limit inactive", record: SignalSuppressionRecord{CreatedAt: now.Unix() - 1, UpdatedAt: now.Unix() - 1, Mode: SignalSuppressionModeSnooze, ExpiresAt: now.Unix() - 1 + SignalSuppressionDurationOneHourSeconds, FingerprintVersion: SignalFingerprintVersion, Comment: strings.Repeat("界", maxSignalSuppressionCommentLen+1)}, fp: current},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := signalSuppressionRecordActive(tt.record, tt.fp, now); got != tt.want {
				t.Fatalf("signalSuppressionRecordActive() = %v, want %v", got, tt.want)
			}
		})
	}
}

func signalSuppressionTestRecord(now time.Time, mode, marker string) SignalSuppressionRecord {
	rec := SignalSuppressionRecord{Mode: mode, CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), FingerprintVersion: SignalFingerprintVersion, Comment: marker}
	if mode == SignalSuppressionModeSnooze {
		rec.ExpiresAt = rec.CreatedAt + SignalSuppressionDurationOneHourSeconds
	} else {
		rec.BaselineFingerprint = "v1:" + strings.Repeat(marker, 64)[:64]
	}
	return rec
}

func newSignalSuppressionTestManager(sp snapshotPersistence) *manager {
	return &manager{
		persistence:          sp,
		signalSuppressionOps: map[string]*sync.Mutex{},
		signalSuppressions:   map[string]map[string]SignalSuppressionRecord{},
	}
}

func TestSignalSuppressionManagerCreatesAndReplacesAtInjectedTime(t *testing.T) {
	m := newSignalSuppressionTestManager(nil)
	now := time.Unix(2_000_000_000, 0).UTC()
	key := "pod_restarts|namespace|Pod|default|api"
	oneHour, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now)
	if err != nil {
		t.Fatalf("create one-hour snooze: %v", err)
	}
	if oneHour.CreatedAt != now.Unix() || oneHour.UpdatedAt != now.Unix() || oneHour.ExpiresAt != now.Add(time.Hour).Unix() {
		t.Fatalf("one-hour record = %+v", oneHour)
	}
	oneDay, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneDaySeconds, Comment: " replacement "}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("replace with one-day snooze: %v", err)
	}
	if oneDay.CreatedAt != now.Add(time.Minute).Unix() || oneDay.UpdatedAt != oneDay.CreatedAt || oneDay.ExpiresAt != now.Add(time.Minute+24*time.Hour).Unix() || oneDay.Comment != "replacement" {
		t.Fatalf("one-day replacement = %+v", oneDay)
	}
	fingerprint := "v1:" + strings.Repeat("a", 64)
	untilChanged, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeUntilChanged, BaselineFingerprint: fingerprint}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("replace with until-changed: %v", err)
	}
	if untilChanged.ExpiresAt != 0 || untilChanged.BaselineFingerprint != fingerprint || untilChanged.CreatedAt != now.Add(2*time.Minute).Unix() {
		t.Fatalf("until-changed replacement = %+v", untilChanged)
	}
	if got := m.exportSignalSuppressionsAt("ctx", now.Add(3*time.Minute))[key]; !reflect.DeepEqual(got, untilChanged) {
		t.Fatalf("stored replacement = %+v, want %+v", got, untilChanged)
	}
}

func TestSignalSuppressionManagerUnsuppressAndResetAreContextIsolated(t *testing.T) {
	m := newSignalSuppressionTestManager(nil)
	now := time.Unix(2_000_000_000, 0).UTC()
	request := func(key string) SignalSuppressionRequest {
		return SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}
	}
	for _, item := range []struct{ contextName, key string }{{"ctx-a", "shared"}, {"ctx-a", "only-a"}, {"ctx-b", "shared"}, {"ctx-b", "only-b"}} {
		if _, err := m.suppressSignalAt(item.contextName, request(item.key), now); err != nil {
			t.Fatalf("seed %s/%s: %v", item.contextName, item.key, err)
		}
	}
	if err := m.UnsuppressSignal("ctx-a", "shared"); err != nil {
		t.Fatalf("unsuppress ctx-a/shared: %v", err)
	}
	if _, ok := m.exportSignalSuppressionsAt("ctx-b", now)["shared"]; !ok {
		t.Fatal("unsuppress in ctx-a removed same key from ctx-b")
	}
	if count, err := m.ResetSignalSuppressions("ctx-a", "only-a"); err != nil || count != 1 {
		t.Fatalf("reset one = %d, %v", count, err)
	}
	if count, err := m.ResetSignalSuppressions("ctx-b", ""); err != nil || count != 2 {
		t.Fatalf("reset all ctx-b = %d, %v", count, err)
	}
	if got := m.exportSignalSuppressionsAt("ctx-a", now); len(got) != 0 {
		t.Fatalf("ctx-a after resets = %+v", got)
	}
	if got := m.exportSignalSuppressionsAt("ctx-b", now); len(got) != 0 {
		t.Fatalf("ctx-b after reset all = %+v", got)
	}
}

func TestSignalSuppressionExportOmitsInvalidAndReturnsDefensiveCopy(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	valid := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	expired := SignalSuppressionRecord{Mode: SignalSuppressionModeSnooze, CreatedAt: now.Add(-2 * time.Hour).Unix(), UpdatedAt: now.Add(-2 * time.Hour).Unix(), ExpiresAt: now.Add(-time.Hour).Unix(), FingerprintVersion: SignalFingerprintVersion}
	m := newSignalSuppressionTestManager(nil)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"valid": valid, "expired": expired, "malformed": {Mode: "forever"}, " bad-key ": valid}
	got := m.exportSignalSuppressionsAt("ctx", now)
	if !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"valid": valid}) {
		t.Fatalf("export = %+v", got)
	}
	got["valid"] = SignalSuppressionRecord{}
	got["injected"] = valid
	if again := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(again, map[string]SignalSuppressionRecord{"valid": valid}) {
		t.Fatalf("export was not a defensive copy: %+v", again)
	}
}

func TestSignalSuppressionImportSkipsInvalidAndUsesInjectedNow(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	valid := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "valid")
	expired := valid
	expired.CreatedAt, expired.UpdatedAt, expired.ExpiresAt = now.Add(-time.Hour).Unix(), now.Add(-time.Hour).Unix(), now.Unix()
	m := newSignalSuppressionTestManager(nil)
	result, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{
		"valid":   valid,
		" valid ": valid,
		"expired": expired,
		"bad":     {Mode: SignalSuppressionModeUntilChanged, CreatedAt: now.Unix(), UpdatedAt: now.Unix(), FingerprintVersion: SignalFingerprintVersion, BaselineFingerprint: "bad"},
		" ":       valid,
	}, "useImported", now)
	if err != nil {
		t.Fatalf("import suppressions: %v", err)
	}
	if result != (SignalSuppressionImportResult{Imported: 1, Skipped: 4}) {
		t.Fatalf("import result = %+v", result)
	}
	if got := m.exportSignalSuppressionsAt("ctx", now)["valid"]; !reflect.DeepEqual(got, valid) {
		t.Fatalf("normalized import = %+v, want %+v", got, valid)
	}
}

func TestSignalSuppressionImportStrategies(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	mine := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	imported := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "b")
	added := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "added")
	tests := []struct {
		name, strategy          string
		current, incoming, want map[string]SignalSuppressionRecord
		wantResult              SignalSuppressionImportResult
	}{
		{name: "keepMine", strategy: "keepMine", current: map[string]SignalSuppressionRecord{"same": mine}, incoming: map[string]SignalSuppressionRecord{"same": imported, "new": added}, want: map[string]SignalSuppressionRecord{"same": mine, "new": added}, wantResult: SignalSuppressionImportResult{Imported: 1, Skipped: 1}},
		{name: "useImported", strategy: "useImported", current: map[string]SignalSuppressionRecord{"same": mine, "mine-only": mine}, incoming: map[string]SignalSuppressionRecord{"same": imported, "new": added}, want: map[string]SignalSuppressionRecord{"same": imported, "new": added, "mine-only": mine}, wantResult: SignalSuppressionImportResult{Imported: 2, Replaced: 1}},
		{name: "replaceSections", strategy: "replaceSections", current: map[string]SignalSuppressionRecord{"same": mine, "removed": mine}, incoming: map[string]SignalSuppressionRecord{"same": imported, "new": added}, want: map[string]SignalSuppressionRecord{"same": imported, "new": added}, wantResult: SignalSuppressionImportResult{Imported: 2, Replaced: 2}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newSignalSuppressionTestManager(nil)
			m.signalSuppressions["ctx"] = tt.current
			result, err := m.importSignalSuppressionsAt("ctx", tt.incoming, tt.strategy, now)
			if err != nil || result != tt.wantResult {
				t.Fatalf("result = %+v, %v, want %+v", result, err, tt.wantResult)
			}
			if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("records = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func signalSuppressionCapacityRecords(now time.Time, count int) map[string]SignalSuppressionRecord {
	records := make(map[string]SignalSuppressionRecord, count)
	for i := 0; i < count; i++ {
		records[fmt.Sprintf("key-%05d", i)] = signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "seed")
	}
	return records
}

func TestSignalSuppressionCapacityAllowsReplacementAndRejectsNewRecord(t *testing.T) {
	now := time.Now().UTC()
	seeded := signalSuppressionCapacityRecords(now, SignalSuppressionMaxRecordsPerContext)
	sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{
		"ctx":       cloneSignalSuppressionRecords(seeded),
		"other-ctx": {},
	}}
	m := newSignalSuppressionTestManager(sp)

	replacement, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: "key-00000", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneDaySeconds, Comment: "replacement"}, now)
	if err != nil || replacement.Comment != "replacement" {
		t.Fatalf("replacement at capacity = %+v, %v", replacement, err)
	}
	before := sp.durableRecords("ctx")
	if _, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: "new-key", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now); !errors.Is(err, ErrSignalSuppressionCapacity) {
		t.Fatalf("new record error = %v, want %v", err, ErrSignalSuppressionCapacity)
	}
	if after := sp.durableRecords("ctx"); !reflect.DeepEqual(after, before) {
		t.Fatal("capacity rejection changed durable state")
	}
	if _, err := m.suppressSignalAt("other-ctx", SignalSuppressionRequest{HistoryKey: "new-key", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now); err != nil {
		t.Fatalf("capacity leaked to another context: %v", err)
	}
}

func TestSignalSuppressionImportCapacityByStrategy(t *testing.T) {
	now := time.Now().UTC()
	updated := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "updated")
	added := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "added")
	for _, tt := range []struct {
		strategy string
		want     SignalSuppressionImportResult
	}{
		{strategy: "keepMine", want: SignalSuppressionImportResult{Skipped: 3}},
		{strategy: "useImported", want: SignalSuppressionImportResult{Imported: 1, Skipped: 2, Replaced: 1}},
	} {
		t.Run(tt.strategy, func(t *testing.T) {
			m := newSignalSuppressionTestManager(nil)
			m.signalSuppressions["ctx"] = signalSuppressionCapacityRecords(now, SignalSuppressionMaxRecordsPerContext)
			result, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{
				"key-00000": updated,
				"new-a":     added,
				"new-b":     added,
			}, tt.strategy, now)
			if err != nil || result != tt.want {
				t.Fatalf("result = %+v, %v, want %+v", result, err, tt.want)
			}
			if got := len(m.signalSuppressions["ctx"]); got != SignalSuppressionMaxRecordsPerContext {
				t.Fatalf("record count = %d", got)
			}
		})
	}

	t.Run("replaceSections", func(t *testing.T) {
		incoming := signalSuppressionCapacityRecords(now, SignalSuppressionMaxRecordsPerContext+2)
		m := newSignalSuppressionTestManager(nil)
		result, err := m.importSignalSuppressionsAt("ctx", incoming, "replaceSections", now)
		want := SignalSuppressionImportResult{Imported: SignalSuppressionMaxRecordsPerContext, Skipped: 2}
		if err != nil || result != want {
			t.Fatalf("result = %+v, %v, want %+v", result, err, want)
		}
		got := m.exportSignalSuppressionsAt("ctx", now)
		if len(got) != SignalSuppressionMaxRecordsPerContext || got["key-09999"].Mode == "" {
			t.Fatalf("deterministic retained set count=%d last=%+v", len(got), got["key-09999"])
		}
		if _, exists := got["key-10000"]; exists {
			t.Fatal("replaceSections retained a key beyond the deterministic cap")
		}
	})
}

func TestSignalSuppressionLazyLoadNormalizesAndCapsOversizedState(t *testing.T) {
	now := time.Now().UTC()
	loaded := signalSuppressionCapacityRecords(now, SignalSuppressionMaxRecordsPerContext+2)
	loaded[" bad "] = signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "invalid-key")
	loaded["key-00001"] = SignalSuppressionRecord{Mode: "malformed"}
	sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": loaded}}
	m := newSignalSuppressionTestManager(sp)
	got := m.ExportSignalSuppressions("ctx")
	if len(got) != SignalSuppressionMaxRecordsPerContext {
		t.Fatalf("loaded/exported count = %d", len(got))
	}
	if _, exists := got["key-00001"]; exists {
		t.Fatal("malformed loaded record did not fail open")
	}
	if _, exists := got["key-10000"]; !exists {
		t.Fatal("normalization did not fill capacity with the next sorted valid key")
	}
	if durable := sp.durableRecords("ctx"); len(durable) != len(loaded) {
		t.Fatal("lazy-load normalization unexpectedly mutated persistence")
	}
}

func TestSignalSuppressionUnknownImportStrategyDoesNotMutate(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	original := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	m := newSignalSuppressionTestManager(nil)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"original": original}
	before := m.exportSignalSuppressionsAt("ctx", now)
	if _, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{"new": signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "new")}, "unknown", now); err == nil {
		t.Fatal("unknown import strategy error = nil")
	}
	if after := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(after, before) {
		t.Fatalf("unknown strategy mutated records: before %+v after %+v", before, after)
	}
}

type signalSuppressionErrorPersistence struct {
	snapshotPersistence
	mu sync.Mutex

	loaded                              map[string]SignalSuppressionRecord
	durable                             map[string]map[string]SignalSuppressionRecord
	loadErr, upsertErr, deleteErr       error
	replaceErr, pruneErr                error
	loadCalls, upsertCalls, deleteCalls int
	replaceCalls, pruneCalls            int
	upsertHook                          func(string, string)
	loadHook                            func(string)
	replaceHook                         func(string, map[string]SignalSuppressionRecord)
	pruneHook                           func(string, time.Time, time.Duration)
}

func cloneSignalSuppressionRecords(in map[string]SignalSuppressionRecord) map[string]SignalSuppressionRecord {
	out := make(map[string]SignalSuppressionRecord, len(in))
	for key, rec := range in {
		out[key] = rec
	}
	return out
}

func (p *signalSuppressionErrorPersistence) LoadSignalSuppressions(contextName string) (map[string]SignalSuppressionRecord, error) {
	p.mu.Lock()
	p.loadCalls++
	err, hook := p.loadErr, p.loadHook
	var records map[string]SignalSuppressionRecord
	if err == nil {
		if p.durable != nil {
			records = cloneSignalSuppressionRecords(p.durable[contextName])
		} else {
			records = cloneSignalSuppressionRecords(p.loaded)
		}
	}
	p.mu.Unlock()
	if hook != nil {
		hook(contextName)
	}
	return records, err
}
func (p *signalSuppressionErrorPersistence) UpsertSignalSuppression(contextName, key string, rec SignalSuppressionRecord) error {
	p.mu.Lock()
	p.upsertCalls++
	err, hook := p.upsertErr, p.upsertHook
	p.mu.Unlock()
	if err != nil {
		return err
	}
	if hook != nil {
		hook(contextName, key)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.durable == nil {
		p.durable = map[string]map[string]SignalSuppressionRecord{}
	}
	if p.durable[contextName] == nil {
		p.durable[contextName] = map[string]SignalSuppressionRecord{}
	}
	p.durable[contextName][key] = rec
	return nil
}
func (p *signalSuppressionErrorPersistence) DeleteSignalSuppression(contextName, key string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.deleteCalls++
	if p.deleteErr == nil {
		delete(p.durable[contextName], key)
	}
	return p.deleteErr
}
func (p *signalSuppressionErrorPersistence) ReplaceSignalSuppressions(contextName string, records map[string]SignalSuppressionRecord) error {
	p.mu.Lock()
	p.replaceCalls++
	err, hook := p.replaceErr, p.replaceHook
	p.mu.Unlock()
	if err != nil {
		return err
	}
	if hook != nil {
		hook(contextName, cloneSignalSuppressionRecords(records))
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.durable == nil {
		p.durable = map[string]map[string]SignalSuppressionRecord{}
	}
	p.durable[contextName] = cloneSignalSuppressionRecords(records)
	return nil
}
func (p *signalSuppressionErrorPersistence) PruneSignalSuppressions(contextName string, now time.Time, maxAge time.Duration) error {
	p.mu.Lock()
	p.pruneCalls++
	err, hook := p.pruneErr, p.pruneHook
	p.mu.Unlock()
	if err == nil && hook != nil {
		hook(contextName, now, maxAge)
	}
	return err
}
func (p *signalSuppressionErrorPersistence) durableRecords(contextName string) map[string]SignalSuppressionRecord {
	p.mu.Lock()
	defer p.mu.Unlock()
	return cloneSignalSuppressionRecords(p.durable[contextName])
}

func TestSignalSuppressionLazyLoadErrorsBlockMutations(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	loadErr := fmt.Errorf("load failed")
	record := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "incoming")
	tests := []struct {
		name string
		act  func(*manager) error
	}{
		{
			name: "suppress",
			act: func(m *manager) error {
				_, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: "key", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now)
				return err
			},
		},
		{name: "unsuppress", act: func(m *manager) error { return m.UnsuppressSignal("ctx", "key") }},
		{
			name: "import",
			act: func(m *manager) error {
				_, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{"key": record}, "useImported", now)
				return err
			},
		},
		{
			name: "reset",
			act: func(m *manager) error {
				_, err := m.ResetSignalSuppressions("ctx", "")
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sp := &signalSuppressionErrorPersistence{loadErr: loadErr}
			m := newSignalSuppressionTestManager(sp)
			if err := tt.act(m); !errors.Is(err, loadErr) {
				t.Fatalf("error = %v, want %v", err, loadErr)
			}
			if sp.loadCalls != 1 || sp.upsertCalls != 0 || sp.deleteCalls != 0 {
				t.Fatalf("persistence calls = load %d, upsert %d, delete %d", sp.loadCalls, sp.upsertCalls, sp.deleteCalls)
			}
			if _, installed := m.signalSuppressions["ctx"]; installed {
				t.Fatal("failed load installed in-memory context")
			}
		})
	}
}

func TestSignalSuppressionExportRetriesAfterLoadFailure(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	loadErr := fmt.Errorf("load failed")
	want := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "loaded")
	sp := &signalSuppressionErrorPersistence{loaded: map[string]SignalSuppressionRecord{"key": want}, loadErr: loadErr}
	m := newSignalSuppressionTestManager(sp)

	if got := m.exportSignalSuppressionsAt("ctx", now); len(got) != 0 {
		t.Fatalf("export after failed load = %+v, want empty", got)
	}
	if _, installed := m.signalSuppressions["ctx"]; installed {
		t.Fatal("failed export load installed in-memory context")
	}
	sp.loadErr = nil
	if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"key": want}) {
		t.Fatalf("export after retry = %+v", got)
	}
	if sp.loadCalls != 2 {
		t.Fatalf("load calls = %d, want 2", sp.loadCalls)
	}
}

func TestSignalSuppressionImportReplaceFailureLeavesMemoryUnchanged(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	original := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	replaceErr := fmt.Errorf("replace failed")
	sp := &signalSuppressionErrorPersistence{replaceErr: replaceErr}
	m := newSignalSuppressionTestManager(sp)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"original": original}

	if _, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{"new": signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "new")}, "useImported", now); !errors.Is(err, replaceErr) {
		t.Fatalf("import error = %v, want %v", err, replaceErr)
	}
	if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"original": original}) {
		t.Fatalf("failed import mutated memory: %+v", got)
	}
	if sp.replaceCalls != 1 || sp.upsertCalls != 0 || sp.deleteCalls != 0 {
		t.Fatalf("persistence calls = replace %d, upsert %d, delete %d", sp.replaceCalls, sp.upsertCalls, sp.deleteCalls)
	}
}

func TestSignalSuppressionResetReplaceFailureLeavesMemoryUnchanged(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	original := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "original")
	replaceErr := fmt.Errorf("replace failed")
	sp := &signalSuppressionErrorPersistence{replaceErr: replaceErr}
	m := newSignalSuppressionTestManager(sp)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"key": original}

	if _, err := m.ResetSignalSuppressions("ctx", "key"); !errors.Is(err, replaceErr) {
		t.Fatalf("reset error = %v, want %v", err, replaceErr)
	}
	if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"key": original}) {
		t.Fatalf("failed reset mutated memory: %+v", got)
	}
	if sp.replaceCalls != 1 || sp.upsertCalls != 0 || sp.deleteCalls != 0 {
		t.Fatalf("persistence calls = replace %d, upsert %d, delete %d", sp.replaceCalls, sp.upsertCalls, sp.deleteCalls)
	}
}

func TestSignalSuppressionPersistenceErrorsAreReturnedWithoutMemoryMutation(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	upsertErr := fmt.Errorf("upsert failed")
	m := newSignalSuppressionTestManager(&signalSuppressionErrorPersistence{upsertErr: upsertErr})
	if _, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: "key", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now); !errors.Is(err, upsertErr) {
		t.Fatalf("suppress error = %v, want %v", err, upsertErr)
	}
	if got := m.exportSignalSuppressionsAt("ctx", now); len(got) != 0 {
		t.Fatalf("failed upsert mutated memory: %+v", got)
	}
	deleteErr := fmt.Errorf("delete failed")
	m = newSignalSuppressionTestManager(&signalSuppressionErrorPersistence{deleteErr: deleteErr})
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"key": signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "key")}
	if err := m.UnsuppressSignal("ctx", "key"); !errors.Is(err, deleteErr) {
		t.Fatalf("unsuppress error = %v, want %v", err, deleteErr)
	}
	if _, ok := m.exportSignalSuppressionsAt("ctx", now)["key"]; !ok {
		t.Fatal("failed delete mutated memory")
	}
}

func awaitSuppressionTestValue[T any](t *testing.T, ch <-chan T, message string) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(time.Second):
		t.Fatal(message)
		var zero T
		return zero
	}
}

func TestSignalSuppressionImportAndResetUseSingleAtomicReplace(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	original := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	imported := signalSuppressionTestRecord(now, SignalSuppressionModeSnooze, "new")

	t.Run("import", func(t *testing.T) {
		sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": {"original": original}}}
		m := newSignalSuppressionTestManager(sp)
		m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"original": original}
		if _, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{"new": imported}, "useImported", now); err != nil {
			t.Fatalf("import: %v", err)
		}
		if sp.replaceCalls != 1 || sp.upsertCalls != 0 || sp.deleteCalls != 0 {
			t.Fatalf("persistence calls = replace %d, upsert %d, delete %d", sp.replaceCalls, sp.upsertCalls, sp.deleteCalls)
		}
		want := map[string]SignalSuppressionRecord{"original": original, "new": imported}
		if got := sp.durableRecords("ctx"); !reflect.DeepEqual(got, want) {
			t.Fatalf("durable records = %+v, want %+v", got, want)
		}
	})

	t.Run("reset", func(t *testing.T) {
		sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": {"original": original, "new": imported}}}
		m := newSignalSuppressionTestManager(sp)
		m.signalSuppressions["ctx"] = cloneSignalSuppressionRecords(sp.durable["ctx"])
		if count, err := m.ResetSignalSuppressions("ctx", "original"); err != nil || count != 1 {
			t.Fatalf("reset = %d, %v", count, err)
		}
		if sp.replaceCalls != 1 || sp.upsertCalls != 0 || sp.deleteCalls != 0 {
			t.Fatalf("persistence calls = replace %d, upsert %d, delete %d", sp.replaceCalls, sp.upsertCalls, sp.deleteCalls)
		}
		if got := sp.durableRecords("ctx"); !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"new": imported}) {
			t.Fatalf("durable records = %+v", got)
		}
	})
}

func TestSignalSuppressionPruneReconcilesLoadedMemory(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	retained := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "a")
	removed := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "b")

	t.Run("success invalidates and reloads retained durable state", func(t *testing.T) {
		sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": {"retained": retained, "removed": removed}}}
		sp.pruneHook = func(string, time.Time, time.Duration) {
			sp.mu.Lock()
			sp.durable["ctx"] = map[string]SignalSuppressionRecord{"retained": retained}
			sp.mu.Unlock()
		}
		m := newSignalSuppressionTestManager(sp)
		m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"retained": retained, "removed": removed}
		if err := m.pruneSignalSuppressions(sp, now, 24*time.Hour); err != nil {
			t.Fatalf("prune: %v", err)
		}
		m.signalSuppressionsMu.RLock()
		_, loaded := m.signalSuppressions["ctx"]
		m.signalSuppressionsMu.RUnlock()
		if loaded {
			t.Fatal("successful prune did not invalidate loaded context")
		}
		if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, map[string]SignalSuppressionRecord{"retained": retained}) {
			t.Fatalf("reloaded export = %+v", got)
		}
		if sp.loadCalls != 1 {
			t.Fatalf("load calls = %d, want 1", sp.loadCalls)
		}
	})

	t.Run("failure keeps loaded memory", func(t *testing.T) {
		pruneErr := errors.New("prune failed")
		sp := &signalSuppressionErrorPersistence{pruneErr: pruneErr, durable: map[string]map[string]SignalSuppressionRecord{"ctx": {"retained": retained}}}
		m := newSignalSuppressionTestManager(sp)
		want := map[string]SignalSuppressionRecord{"retained": retained, "memory-only": removed}
		m.signalSuppressions["ctx"] = cloneSignalSuppressionRecords(want)
		if err := m.pruneSignalSuppressions(sp, now, 24*time.Hour); !errors.Is(err, pruneErr) {
			t.Fatalf("prune error = %v, want %v", err, pruneErr)
		}
		if got := m.exportSignalSuppressionsAt("ctx", now); !reflect.DeepEqual(got, want) {
			t.Fatalf("failed prune changed memory: %+v", got)
		}
		if sp.loadCalls != 0 {
			t.Fatalf("failed prune caused reload: %d", sp.loadCalls)
		}
	})
}

func TestSignalSuppressionSameContextOperationsStayDurableAndPublishedInOrder(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	entered := make(chan string, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": {}}}
	sp.upsertHook = func(_ string, key string) {
		entered <- key
		if key == "first" {
			<-release
		}
	}
	m := newSignalSuppressionTestManager(sp)
	errCh := make(chan error, 2)
	start := func(key string, at time.Time) {
		go func() {
			_, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: key, Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, at)
			errCh <- err
		}()
	}
	start("first", now)
	if got := awaitSuppressionTestValue(t, entered, "first suppression did not enter persistence"); got != "first" {
		t.Fatalf("first persistence entry = %q", got)
	}
	start("second", now.Add(time.Minute))
	select {
	case got := <-entered:
		t.Fatalf("same-context operation entered persistence early: %q", got)
	case <-time.After(100 * time.Millisecond):
	}
	releaseOnce.Do(func() { close(release) })
	if got := awaitSuppressionTestValue(t, entered, "second suppression did not enter persistence"); got != "second" {
		t.Fatalf("second persistence entry = %q", got)
	}
	for range 2 {
		if err := awaitSuppressionTestValue(t, errCh, "suppression did not finish"); err != nil {
			t.Fatalf("suppress: %v", err)
		}
	}
	memory, durable := m.exportSignalSuppressionsAt("ctx", now.Add(2*time.Minute)), sp.durableRecords("ctx")
	if !reflect.DeepEqual(memory, durable) || len(memory) != 2 {
		t.Fatalf("memory/durable divergence: memory %+v durable %+v", memory, durable)
	}
}

func TestSignalSuppressionImportRacingSuppressDoesNotLoseEitherOperation(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	imported := signalSuppressionTestRecord(now, SignalSuppressionModeUntilChanged, "c")
	replaceEntered := make(chan struct{}, 1)
	upsertEntered := make(chan struct{}, 1)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx": {}}}
	sp.replaceHook = func(string, map[string]SignalSuppressionRecord) { replaceEntered <- struct{}{}; <-release }
	sp.upsertHook = func(string, string) { upsertEntered <- struct{}{} }
	m := newSignalSuppressionTestManager(sp)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{}
	importErr, suppressErr := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := m.importSignalSuppressionsAt("ctx", map[string]SignalSuppressionRecord{"imported": imported}, "useImported", now)
		importErr <- err
	}()
	awaitSuppressionTestValue(t, replaceEntered, "import did not enter replace")
	go func() {
		_, err := m.suppressSignalAt("ctx", SignalSuppressionRequest{HistoryKey: "suppressed", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now)
		suppressErr <- err
	}()
	select {
	case <-upsertEntered:
		t.Fatal("suppress entered persistence before import published")
	case <-time.After(100 * time.Millisecond):
	}
	releaseOnce.Do(func() { close(release) })
	awaitSuppressionTestValue(t, upsertEntered, "suppress did not enter persistence after import")
	if err := awaitSuppressionTestValue(t, importErr, "import did not finish"); err != nil {
		t.Fatalf("import: %v", err)
	}
	if err := awaitSuppressionTestValue(t, suppressErr, "suppress did not finish"); err != nil {
		t.Fatalf("suppress: %v", err)
	}
	memory, durable := m.exportSignalSuppressionsAt("ctx", now), sp.durableRecords("ctx")
	if !reflect.DeepEqual(memory, durable) || len(memory) != 2 {
		t.Fatalf("race lost an operation: memory %+v durable %+v", memory, durable)
	}
}

func TestSignalSuppressionDifferentContextsPersistConcurrently(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	entered := make(chan string, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	sp := &signalSuppressionErrorPersistence{durable: map[string]map[string]SignalSuppressionRecord{"ctx-a": {}, "ctx-b": {}}}
	sp.upsertHook = func(contextName, _ string) {
		entered <- contextName
		if contextName == "ctx-a" {
			<-release
		}
	}
	m := newSignalSuppressionTestManager(sp)
	errCh := make(chan error, 2)
	start := func(contextName string) {
		go func() {
			_, err := m.suppressSignalAt(contextName, SignalSuppressionRequest{HistoryKey: "key", Mode: SignalSuppressionModeSnooze, DurationSeconds: SignalSuppressionDurationOneHourSeconds}, now)
			errCh <- err
		}()
	}
	start("ctx-a")
	if got := awaitSuppressionTestValue(t, entered, "ctx-a did not enter persistence"); got != "ctx-a" {
		t.Fatalf("first context = %q", got)
	}
	start("ctx-b")
	if got := awaitSuppressionTestValue(t, entered, "ctx-b could not enter persistence concurrently"); got != "ctx-b" {
		t.Fatalf("concurrent context = %q", got)
	}
	releaseOnce.Do(func() { close(release) })
	for range 2 {
		if err := awaitSuppressionTestValue(t, errCh, "suppression did not finish"); err != nil {
			t.Fatalf("suppress: %v", err)
		}
	}
}

func TestProjectSignalSuppressionsPartitionsAndCopiesDefensively(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	base := ClusterDashboardSignal{
		SignalType: "pod_restarts", HistoryKey: "snoozed", Severity: "high",
		ResourceKind: "Pod", ResourceName: "api", Namespace: "apps", Scope: "namespace", ScopeLocation: "apps",
		ActualData: "12 restarts", Labels: map[string]string{"app": "api"}, Annotations: map[string]string{"owner": "platform"},
		MatchLabels: map[string]string{"tier": "api"}, MatchAnnotations: map[string]string{"source": "test"},
		Focus: &ClusterDashboardSignalFocus{Resource: "pods", Filter: "api"},
	}
	until := base
	until.HistoryKey, until.ResourceName, until.Name, until.ActualData = "until", "worker", "worker", "3 restarts"
	visibleInput := base
	visibleInput.HistoryKey, visibleInput.ResourceName, visibleInput.Name = "visible", "clean", "clean"
	input := []ClusterDashboardSignal{base, until, visibleInput}
	m := newSignalSuppressionTestManager(nil)
	m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{
		"snoozed": {Mode: SignalSuppressionModeSnooze, CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), ExpiresAt: now.Add(-time.Minute).Unix() + SignalSuppressionDurationOneHourSeconds, FingerprintVersion: SignalFingerprintVersion, Comment: "maintenance"},
		"until":   {Mode: SignalSuppressionModeUntilChanged, CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), BaselineFingerprint: clusterDashboardSignalStateFingerprint(until), FingerprintVersion: SignalFingerprintVersion, Comment: "known state"},
	}
	visible, suppressed, summary := m.projectSignalSuppressionsAt(context.Background(), "ctx", input, now)
	if len(visible) != 1 || visible[0].HistoryKey != "visible" {
		t.Fatalf("visible = %+v", visible)
	}
	if len(suppressed) != 2 || summary != (SignalSuppressionSummary{Total: 2, Snoozed: 1, UntilChanged: 1}) {
		t.Fatalf("suppressed = %+v summary = %+v", suppressed, summary)
	}
	if suppressed[0].StateFingerprint == "" || suppressed[0].Suppression == nil || suppressed[0].Suppression.Mode != SignalSuppressionModeSnooze || suppressed[0].Suppression.Comment != "maintenance" {
		t.Fatalf("snooze metadata = %+v", suppressed[0])
	}
	if suppressed[1].StateFingerprint != clusterDashboardSignalStateFingerprint(until) || suppressed[1].Suppression == nil || suppressed[1].Suppression.Mode != SignalSuppressionModeUntilChanged {
		t.Fatalf("until-changed metadata = %+v", suppressed[1])
	}
	visible[0].Labels["app"], visible[0].Annotations["owner"], visible[0].MatchLabels["tier"], visible[0].MatchAnnotations["source"], visible[0].Focus.Filter = "mutated", "mutated", "mutated", "mutated", "mutated"
	suppressed[0].Labels["app"] = "mutated"
	suppressed[0].Suppression.Comment = "mutated"
	if input[0].Labels["app"] != "api" || input[0].Suppression != nil || input[0].StateFingerprint != "" || input[0].Focus.Filter != "api" ||
		input[2].Labels["app"] != "api" || input[2].Annotations["owner"] != "platform" || input[2].MatchLabels["tier"] != "api" || input[2].MatchAnnotations["source"] != "test" || input[2].Focus.Filter != "api" {
		t.Fatalf("projection mutated or aliased input: %+v", input)
	}
}

func TestProjectSignalSuppressionsBoundariesChangedEvidenceAndContextIsolation(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	signal := ClusterDashboardSignal{SignalType: "pod_restarts", HistoryKey: "shared", Severity: "medium", ResourceKind: "Pod", ResourceName: "api", Namespace: "apps", ActualData: "4 restarts"}
	m := newSignalSuppressionTestManager(nil)
	m.signalSuppressions["ctx-a"] = map[string]SignalSuppressionRecord{"shared": {Mode: SignalSuppressionModeSnooze, CreatedAt: now.Add(-time.Hour).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), ExpiresAt: now.Unix(), FingerprintVersion: SignalFingerprintVersion}}
	visible, suppressed, _ := m.projectSignalSuppressionsAt(context.Background(), "ctx-a", []ClusterDashboardSignal{signal}, now)
	if len(visible) != 1 || len(suppressed) != 0 {
		t.Fatalf("exact expiry must be visible: visible=%+v suppressed=%+v", visible, suppressed)
	}
	m.signalSuppressions["ctx-a"]["shared"] = SignalSuppressionRecord{Mode: SignalSuppressionModeUntilChanged, CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), BaselineFingerprint: clusterDashboardSignalStateFingerprint(signal), FingerprintVersion: SignalFingerprintVersion}
	changed := signal
	changed.ActualData = "5 restarts"
	visible, suppressed, _ = m.projectSignalSuppressionsAt(context.Background(), "ctx-a", []ClusterDashboardSignal{signal, changed}, now)
	if len(suppressed) != 1 || suppressed[0].ActualData != "4 restarts" || len(visible) != 1 || visible[0].ActualData != "5 restarts" {
		t.Fatalf("same-call evidence partition: visible=%+v suppressed=%+v", visible, suppressed)
	}
	visible, suppressed, _ = m.projectSignalSuppressionsAt(context.Background(), "ctx-b", []ClusterDashboardSignal{signal}, now)
	if len(visible) != 1 || len(suppressed) != 0 {
		t.Fatalf("same history key leaked across contexts: visible=%+v suppressed=%+v", visible, suppressed)
	}
}

func TestProjectSignalSuppressionsFailsOpen(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	signal := ClusterDashboardSignal{SignalType: "pod_restarts", HistoryKey: "key", ResourceKind: "Pod", ResourceName: "api"}
	valid := SignalSuppressionRecord{Mode: SignalSuppressionModeSnooze, CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), ExpiresAt: now.Add(-time.Minute).Unix() + SignalSuppressionDurationOneHourSeconds, FingerprintVersion: SignalFingerprintVersion}
	for name, rec := range map[string]SignalSuppressionRecord{
		"malformed": {Mode: "forever", CreatedAt: now.Add(-time.Minute).Unix(), UpdatedAt: now.Add(-time.Minute).Unix(), FingerprintVersion: SignalFingerprintVersion},
		"version":   func() SignalSuppressionRecord { out := valid; out.FingerprintVersion++; return out }(),
	} {
		t.Run(name, func(t *testing.T) {
			m := newSignalSuppressionTestManager(nil)
			m.signalSuppressions["ctx"] = map[string]SignalSuppressionRecord{"key": rec}
			visible, suppressed, summary := m.projectSignalSuppressionsAt(context.Background(), "ctx", []ClusterDashboardSignal{signal}, now)
			if len(visible) != 1 || len(suppressed) != 0 || summary.Total != 0 {
				t.Fatalf("invalid record did not fail open: visible=%+v suppressed=%+v summary=%+v", visible, suppressed, summary)
			}
		})
	}
	t.Run("load error", func(t *testing.T) {
		m := newSignalSuppressionTestManager(&signalSuppressionErrorPersistence{loadErr: errors.New("load failed")})
		visible, suppressed, summary := m.projectSignalSuppressionsAt(context.Background(), "ctx", []ClusterDashboardSignal{signal}, now)
		if len(visible) != 1 || len(suppressed) != 0 || summary.Total != 0 {
			t.Fatalf("load error did not fail open: visible=%+v suppressed=%+v summary=%+v", visible, suppressed, summary)
		}
	})
}

func TestProjectSignalSuppressionsCancellationDuringLazyLoadFailsOpen(t *testing.T) {
	now := time.Unix(2_000_000_000, 0).UTC()
	signal := ClusterDashboardSignal{SignalType: "pod_restarts", HistoryKey: "key", ResourceKind: "Pod", ResourceName: "api"}
	record := SignalSuppressionRecord{
		Mode:               SignalSuppressionModeSnooze,
		CreatedAt:          now.Add(-time.Minute).Unix(),
		UpdatedAt:          now.Add(-time.Minute).Unix(),
		ExpiresAt:          now.Add(-time.Minute).Unix() + SignalSuppressionDurationOneHourSeconds,
		FingerprintVersion: SignalFingerprintVersion,
	}
	loadStarted := make(chan struct{})
	releaseLoad := make(chan struct{})
	persistence := &signalSuppressionErrorPersistence{
		durable: map[string]map[string]SignalSuppressionRecord{"ctx": {"key": record}},
		loadHook: func(string) {
			close(loadStarted)
			<-releaseLoad
		},
	}
	m := newSignalSuppressionTestManager(persistence)
	ctx, cancel := context.WithCancel(context.Background())
	type result struct {
		visible, suppressed []ClusterDashboardSignal
		summary             SignalSuppressionSummary
	}
	done := make(chan result, 1)
	go func() {
		visible, suppressed, summary := m.projectSignalSuppressionsAt(ctx, "ctx", []ClusterDashboardSignal{signal}, now)
		done <- result{visible: visible, suppressed: suppressed, summary: summary}
	}()

	select {
	case <-loadStarted:
	case <-time.After(time.Second):
		t.Fatal("lazy suppression load did not start")
	}
	cancel()
	close(releaseLoad)

	select {
	case got := <-done:
		if len(got.visible) != 1 || len(got.suppressed) != 0 || got.summary.Total != 0 {
			t.Fatalf("cancellation during lazy load did not fail open: %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("suppression projection did not return after lazy load release")
	}
}
