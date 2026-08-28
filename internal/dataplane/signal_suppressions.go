package dataplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	SignalFingerprintVersion = 1

	SignalSuppressionModeSnooze       = "snooze"
	SignalSuppressionModeUntilChanged = "until_changed"

	SignalSuppressionDurationOneHourSeconds int64 = 3600
	SignalSuppressionDurationOneDaySeconds  int64 = 86400

	// SignalSuppressionMaxRecordsPerContext bounds durable and in-memory
	// suppression state independently for each Kubernetes context.
	SignalSuppressionMaxRecordsPerContext = 10000
	// SignalSuppressionProjectionSampleLimit bounds diagnostic suppressed-signal
	// samples while their accompanying counts remain exact.
	SignalSuppressionProjectionSampleLimit = 500

	maxSignalSuppressionHistoryKeyLen  = 1024
	maxSignalSuppressionCommentLen     = 2000
	maxSignalSuppressionFingerprintLen = 128
)

const signalFingerprintPrefix = "v1:"

// ErrSignalSuppressionCapacity classifies an otherwise valid create that
// cannot add a new suppression because the active context is at capacity.
var ErrSignalSuppressionCapacity = errors.New("signal suppression capacity reached")

func suppressionProjectionSample(items []ClusterDashboardSignal) []ClusterDashboardSignal {
	out := make([]ClusterDashboardSignal, len(items))
	for i := range items {
		out[i] = cloneClusterDashboardSignal(items[i])
	}
	sort.SliceStable(out, func(i, j int) bool { return dashboardSignalLess(out[i], out[j]) })
	if len(out) > SignalSuppressionProjectionSampleLimit {
		out = out[:SignalSuppressionProjectionSampleLimit]
	}
	return out
}

// projectSignalSuppressionsAt computes a current fingerprint for every
// post-history signal and partitions active runtime suppressions. Reads fail
// open when their context or persistence state is unavailable.
func (m *manager) projectSignalSuppressionsAt(ctx context.Context, contextName string, items []ClusterDashboardSignal, now time.Time) (visible, suppressed []ClusterDashboardSignal, summary SignalSuppressionSummary) {
	prepared := make([]ClusterDashboardSignal, 0, len(items))
	for _, item := range items {
		item = cloneClusterDashboardSignal(item)
		item.StateFingerprint = clusterDashboardSignalStateFingerprint(item)
		item.Suppression = nil
		prepared = append(prepared, item)
	}
	visible = make([]ClusterDashboardSignal, 0, len(items))
	suppressed = make([]ClusterDashboardSignal, 0)
	contextName = strings.TrimSpace(contextName)
	if contextName == "" || ctx == nil || ctx.Err() != nil {
		return append(visible, prepared...), suppressed, summary
	}

	m.signalSuppressionsPruneMu.RLock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	err := m.ensureSignalSuppressions(contextName, now)
	records := map[string]SignalSuppressionRecord{}
	if err == nil {
		m.signalSuppressionsMu.RLock()
		for key, record := range m.signalSuppressions[contextName] {
			records[key] = record
		}
		m.signalSuppressionsMu.RUnlock()
	}
	contextLock.Unlock()
	m.signalSuppressionsPruneMu.RUnlock()
	if err != nil || ctx.Err() != nil {
		return append(visible, prepared...), suppressed, summary
	}

	for _, item := range prepared {
		key := strings.TrimSpace(item.HistoryKey)
		record, ok := records[key]
		if key == "" || !ok || !signalSuppressionRecordActive(record, item.StateFingerprint, now.UTC()) {
			visible = append(visible, item)
			continue
		}
		item.Suppression = &SignalSuppressionMetadata{Mode: record.Mode, ExpiresAt: record.ExpiresAt, Comment: record.Comment}
		suppressed = append(suppressed, item)
		summary.Total++
		switch record.Mode {
		case SignalSuppressionModeSnooze:
			summary.Snoozed++
		case SignalSuppressionModeUntilChanged:
			summary.UntilChanged++
		}
	}
	return visible, suppressed, summary
}

func cloneClusterDashboardSignal(item ClusterDashboardSignal) ClusterDashboardSignal {
	cloneMap := func(in map[string]string) map[string]string {
		if in == nil {
			return nil
		}
		out := make(map[string]string, len(in))
		for key, value := range in {
			out[key] = value
		}
		return out
	}
	item.Labels = cloneMap(item.Labels)
	item.Annotations = cloneMap(item.Annotations)
	item.MatchLabels = cloneMap(item.MatchLabels)
	item.MatchAnnotations = cloneMap(item.MatchAnnotations)
	if item.Focus != nil {
		focus := *item.Focus
		item.Focus = &focus
	}
	if item.Suppression != nil {
		metadata := *item.Suppression
		item.Suppression = &metadata
	}
	return item
}

type SignalSuppressionRecord struct {
	Mode                string `json:"mode"`
	CreatedAt           int64  `json:"createdAt"`
	UpdatedAt           int64  `json:"updatedAt"`
	ExpiresAt           int64  `json:"expiresAt,omitempty"`
	BaselineFingerprint string `json:"baselineFingerprint,omitempty"`
	FingerprintVersion  int    `json:"fingerprintVersion"`
	Comment             string `json:"comment,omitempty"`
}

type SignalSuppressionRequest struct {
	HistoryKey          string `json:"historyKey"`
	Mode                string `json:"mode"`
	DurationSeconds     int64  `json:"durationSeconds,omitempty"`
	BaselineFingerprint string `json:"baselineFingerprint,omitempty"`
	Comment             string `json:"comment,omitempty"`
}

type SignalSuppressionImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Replaced int `json:"replaced"`
}

// ValidateSignalSuppressionHistoryKey trims and validates a suppression key
// without accepting any client-owned context or record metadata.
func ValidateSignalSuppressionHistoryKey(historyKey string) (string, error) {
	historyKey = strings.TrimSpace(historyKey)
	if historyKey == "" {
		return "", fmt.Errorf("history key is required")
	}
	if utf8.RuneCountInString(historyKey) > maxSignalSuppressionHistoryKeyLen {
		return "", fmt.Errorf("history key exceeds %d characters", maxSignalSuppressionHistoryKeyLen)
	}
	return historyKey, nil
}

// ValidateSignalSuppressionRequest applies the same normalization and
// validation used by SuppressSignal. HTTP boundaries use it to distinguish
// invalid client input from persistence failures returned by the manager.
func ValidateSignalSuppressionRequest(in SignalSuppressionRequest) (SignalSuppressionRequest, error) {
	return normalizeSignalSuppressionRequest(in)
}

func normalizeSignalSuppressionRequest(in SignalSuppressionRequest) (SignalSuppressionRequest, error) {
	historyKey, err := ValidateSignalSuppressionHistoryKey(in.HistoryKey)
	if err != nil {
		return SignalSuppressionRequest{}, err
	}
	out := SignalSuppressionRequest{
		HistoryKey:          historyKey,
		Mode:                strings.TrimSpace(in.Mode),
		DurationSeconds:     in.DurationSeconds,
		BaselineFingerprint: strings.TrimSpace(in.BaselineFingerprint),
		Comment:             strings.TrimSpace(in.Comment),
	}
	if utf8.RuneCountInString(out.Comment) > maxSignalSuppressionCommentLen {
		return SignalSuppressionRequest{}, fmt.Errorf("comment exceeds %d characters", maxSignalSuppressionCommentLen)
	}
	if len(out.BaselineFingerprint) > maxSignalSuppressionFingerprintLen {
		return SignalSuppressionRequest{}, fmt.Errorf("baseline fingerprint exceeds %d characters", maxSignalSuppressionFingerprintLen)
	}

	switch out.Mode {
	case SignalSuppressionModeSnooze:
		if out.DurationSeconds != SignalSuppressionDurationOneHourSeconds && out.DurationSeconds != SignalSuppressionDurationOneDaySeconds {
			return SignalSuppressionRequest{}, fmt.Errorf("snooze duration must be %d or %d seconds", SignalSuppressionDurationOneHourSeconds, SignalSuppressionDurationOneDaySeconds)
		}
		if out.BaselineFingerprint != "" {
			return SignalSuppressionRequest{}, fmt.Errorf("baseline fingerprint is only valid for %s mode", SignalSuppressionModeUntilChanged)
		}
	case SignalSuppressionModeUntilChanged:
		if out.DurationSeconds != 0 {
			return SignalSuppressionRequest{}, fmt.Errorf("duration is only valid for %s mode", SignalSuppressionModeSnooze)
		}
		if !validSignalStateFingerprint(out.BaselineFingerprint) {
			return SignalSuppressionRequest{}, fmt.Errorf("valid baseline fingerprint is required")
		}
	default:
		return SignalSuppressionRequest{}, fmt.Errorf("unsupported signal suppression mode %q", out.Mode)
	}
	return out, nil
}

type signalFingerprintPayload struct {
	Version        int    `json:"version"`
	SignalType     string `json:"signalType"`
	Severity       string `json:"severity"`
	Scope          string `json:"scope"`
	ScopeLocation  string `json:"scopeLocation"`
	ResourceKind   string `json:"resourceKind"`
	ResourceName   string `json:"resourceName"`
	Namespace      string `json:"namespace"`
	ActualData     string `json:"actualData"`
	CalculatedData string `json:"calculatedData"`
	Reason         string `json:"reason"`
}

func clusterDashboardSignalStateFingerprint(signal ClusterDashboardSignal) string {
	actualData := normalizeSignalFingerprintText(signal.ActualData)
	calculatedData := normalizeSignalFingerprintText(signal.CalculatedData)
	reason := ""
	if actualData == "" && calculatedData == "" {
		reason = normalizeSignalFingerprintText(signal.Reason)
	}
	resourceKind := signal.ResourceKind
	if strings.TrimSpace(resourceKind) == "" {
		resourceKind = signal.Kind
	}
	resourceName := signal.ResourceName
	if strings.TrimSpace(resourceName) == "" {
		resourceName = signal.Name
	}
	payload := signalFingerprintPayload{
		Version:        SignalFingerprintVersion,
		SignalType:     normalizeSignalFingerprintText(signal.SignalType),
		Severity:       normalizeSignalFingerprintText(signal.Severity),
		Scope:          normalizeSignalFingerprintText(signal.Scope),
		ScopeLocation:  normalizeSignalFingerprintText(signal.ScopeLocation),
		ResourceKind:   normalizeSignalFingerprintText(resourceKind),
		ResourceName:   normalizeSignalFingerprintText(resourceName),
		Namespace:      normalizeSignalFingerprintText(signal.Namespace),
		ActualData:     actualData,
		CalculatedData: calculatedData,
		Reason:         reason,
	}
	canonical, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(canonical)
	return signalFingerprintPrefix + hex.EncodeToString(sum[:])
}

func normalizeSignalFingerprintText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func validSignalStateFingerprint(fingerprint string) bool {
	if len(fingerprint) != len(signalFingerprintPrefix)+sha256.Size*2 || !strings.HasPrefix(fingerprint, signalFingerprintPrefix) {
		return false
	}
	_, err := hex.DecodeString(fingerprint[len(signalFingerprintPrefix):])
	return err == nil
}

func signalSuppressionRecordActive(record SignalSuppressionRecord, currentFingerprint string, now time.Time) bool {
	if record.FingerprintVersion != SignalFingerprintVersion || !validSignalStateFingerprint(strings.TrimSpace(currentFingerprint)) {
		return false
	}
	nowUnix := now.Unix()
	if record.CreatedAt <= 0 || record.CreatedAt > nowUnix || record.UpdatedAt < record.CreatedAt || record.UpdatedAt > nowUnix || utf8.RuneCountInString(record.Comment) > maxSignalSuppressionCommentLen {
		return false
	}

	switch record.Mode {
	case SignalSuppressionModeSnooze:
		duration := record.ExpiresAt - record.CreatedAt
		return record.ExpiresAt > record.CreatedAt &&
			(duration == SignalSuppressionDurationOneHourSeconds || duration == SignalSuppressionDurationOneDaySeconds) &&
			record.BaselineFingerprint == "" && nowUnix < record.ExpiresAt
	case SignalSuppressionModeUntilChanged:
		baseline := strings.TrimSpace(record.BaselineFingerprint)
		return record.ExpiresAt == 0 && validSignalStateFingerprint(baseline) && baseline == strings.TrimSpace(currentFingerprint)
	default:
		return false
	}
}

func normalizeImportedSignalSuppression(record SignalSuppressionRecord, now time.Time) (SignalSuppressionRecord, bool) {
	nowUnix := now.UTC().Unix()
	record.Mode = strings.TrimSpace(record.Mode)
	record.Comment = strings.TrimSpace(record.Comment)
	record.BaselineFingerprint = strings.TrimSpace(record.BaselineFingerprint)
	if record.FingerprintVersion != SignalFingerprintVersion || record.CreatedAt <= 0 || record.UpdatedAt < record.CreatedAt || record.UpdatedAt > nowUnix || utf8.RuneCountInString(record.Comment) > maxSignalSuppressionCommentLen {
		return SignalSuppressionRecord{}, false
	}
	switch record.Mode {
	case SignalSuppressionModeSnooze:
		duration := record.ExpiresAt - record.CreatedAt
		if (duration != SignalSuppressionDurationOneHourSeconds && duration != SignalSuppressionDurationOneDaySeconds) || record.ExpiresAt <= nowUnix || record.BaselineFingerprint != "" {
			return SignalSuppressionRecord{}, false
		}
	case SignalSuppressionModeUntilChanged:
		if record.ExpiresAt != 0 || !validSignalStateFingerprint(record.BaselineFingerprint) {
			return SignalSuppressionRecord{}, false
		}
	default:
		return SignalSuppressionRecord{}, false
	}
	return record, true
}

func (m *manager) signalSuppressionContextLock(contextName string) *sync.Mutex {
	m.signalSuppressionOpsMu.Lock()
	defer m.signalSuppressionOpsMu.Unlock()
	if m.signalSuppressionOps == nil {
		m.signalSuppressionOps = map[string]*sync.Mutex{}
	}
	if m.signalSuppressionOps[contextName] == nil {
		m.signalSuppressionOps[contextName] = &sync.Mutex{}
	}
	return m.signalSuppressionOps[contextName]
}

// ensureSignalSuppressions must be called while holding the suppression prune
// barrier for reading and the context operation lock. That serializes lazy load
// with persistence mutations and in-memory publication for the context.
func (m *manager) ensureSignalSuppressions(contextName string, now time.Time) error {
	if contextName == "" {
		return nil
	}
	m.signalSuppressionsMu.RLock()
	_, ok := m.signalSuppressions[contextName]
	m.signalSuppressionsMu.RUnlock()
	if ok {
		return nil
	}
	loaded := map[string]SignalSuppressionRecord{}
	if sp := m.currentPersistence(); sp != nil {
		records, err := sp.LoadSignalSuppressions(contextName)
		if err != nil {
			return err
		}
		if records != nil {
			loaded = normalizedSignalSuppressionRecords(records, now.UTC())
		}
	}
	m.signalSuppressionsMu.Lock()
	if _, ok := m.signalSuppressions[contextName]; !ok {
		m.signalSuppressions[contextName] = loaded
	}
	m.signalSuppressionsMu.Unlock()
	return nil
}

func sortedSignalSuppressionKeys(records map[string]SignalSuppressionRecord) []string {
	keys := make([]string, 0, len(records))
	for key := range records {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func normalizedSignalSuppressionRecords(records map[string]SignalSuppressionRecord, now time.Time) map[string]SignalSuppressionRecord {
	capacity := len(records)
	if capacity > SignalSuppressionMaxRecordsPerContext {
		capacity = SignalSuppressionMaxRecordsPerContext
	}
	out := make(map[string]SignalSuppressionRecord, capacity)
	for _, key := range sortedSignalSuppressionKeys(records) {
		if len(out) == SignalSuppressionMaxRecordsPerContext {
			break
		}
		if cleanKey := strings.TrimSpace(key); cleanKey == "" || cleanKey != key || utf8.RuneCountInString(key) > maxSignalSuppressionHistoryKeyLen {
			continue
		}
		if normalized, ok := normalizeImportedSignalSuppression(records[key], now); ok {
			out[key] = normalized
		}
	}
	return out
}

func (m *manager) SuppressSignal(contextName string, req SignalSuppressionRequest) (SignalSuppressionRecord, error) {
	return m.suppressSignalAt(contextName, req, time.Now().UTC())
}

func (m *manager) suppressSignalAt(contextName string, req SignalSuppressionRequest, now time.Time) (SignalSuppressionRecord, error) {
	contextName = strings.TrimSpace(contextName)
	if contextName == "" {
		return SignalSuppressionRecord{}, fmt.Errorf("context is required")
	}
	normalized, err := normalizeSignalSuppressionRequest(req)
	if err != nil {
		return SignalSuppressionRecord{}, err
	}
	nowUnix := now.UTC().Unix()
	rec := SignalSuppressionRecord{Mode: normalized.Mode, CreatedAt: nowUnix, UpdatedAt: nowUnix, FingerprintVersion: SignalFingerprintVersion, Comment: normalized.Comment}
	if normalized.Mode == SignalSuppressionModeSnooze {
		rec.ExpiresAt = nowUnix + normalized.DurationSeconds
	} else {
		rec.BaselineFingerprint = normalized.BaselineFingerprint
	}
	m.signalSuppressionsPruneMu.RLock()
	defer m.signalSuppressionsPruneMu.RUnlock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	defer contextLock.Unlock()
	if err := m.ensureSignalSuppressions(contextName, now); err != nil {
		return SignalSuppressionRecord{}, err
	}
	m.signalSuppressionsMu.RLock()
	_, replacing := m.signalSuppressions[contextName][normalized.HistoryKey]
	atCapacity := len(m.signalSuppressions[contextName]) >= SignalSuppressionMaxRecordsPerContext
	m.signalSuppressionsMu.RUnlock()
	if atCapacity && !replacing {
		return SignalSuppressionRecord{}, ErrSignalSuppressionCapacity
	}
	if sp := m.currentPersistence(); sp != nil {
		if err := sp.UpsertSignalSuppression(contextName, normalized.HistoryKey, rec); err != nil {
			return SignalSuppressionRecord{}, err
		}
	}
	m.signalSuppressionsMu.Lock()
	if m.signalSuppressions[contextName] == nil {
		m.signalSuppressions[contextName] = map[string]SignalSuppressionRecord{}
	}
	m.signalSuppressions[contextName][normalized.HistoryKey] = rec
	m.signalSuppressionsMu.Unlock()
	return rec, nil
}

func (m *manager) UnsuppressSignal(contextName, historyKey string) error {
	contextName = strings.TrimSpace(contextName)
	if contextName == "" {
		return fmt.Errorf("context is required")
	}
	var err error
	historyKey, err = ValidateSignalSuppressionHistoryKey(historyKey)
	if err != nil {
		return err
	}
	m.signalSuppressionsPruneMu.RLock()
	defer m.signalSuppressionsPruneMu.RUnlock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	defer contextLock.Unlock()
	if err := m.ensureSignalSuppressions(contextName, time.Now().UTC()); err != nil {
		return err
	}
	if sp := m.currentPersistence(); sp != nil {
		if err := sp.DeleteSignalSuppression(contextName, historyKey); err != nil {
			return err
		}
	}
	m.signalSuppressionsMu.Lock()
	delete(m.signalSuppressions[contextName], historyKey)
	m.signalSuppressionsMu.Unlock()
	return nil
}

func (m *manager) ExportSignalSuppressions(contextName string) map[string]SignalSuppressionRecord {
	return m.exportSignalSuppressionsAt(contextName, time.Now().UTC())
}

func (m *manager) exportSignalSuppressionsAt(contextName string, now time.Time) map[string]SignalSuppressionRecord {
	out := map[string]SignalSuppressionRecord{}
	contextName = strings.TrimSpace(contextName)
	if contextName == "" {
		return out
	}
	m.signalSuppressionsPruneMu.RLock()
	defer m.signalSuppressionsPruneMu.RUnlock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	defer contextLock.Unlock()
	if err := m.ensureSignalSuppressions(contextName, now); err != nil {
		return out
	}
	m.signalSuppressionsMu.RLock()
	defer m.signalSuppressionsMu.RUnlock()
	for key, rec := range m.signalSuppressions[contextName] {
		if cleanKey := strings.TrimSpace(key); cleanKey == "" || cleanKey != key {
			continue
		}
		if normalized, ok := normalizeImportedSignalSuppression(rec, now); ok {
			out[key] = normalized
		}
	}
	return out
}

func (m *manager) ImportSignalSuppressions(contextName string, incoming map[string]SignalSuppressionRecord, strategy string) (SignalSuppressionImportResult, error) {
	return m.importSignalSuppressionsAt(contextName, incoming, strategy, time.Now().UTC())
}

func (m *manager) importSignalSuppressionsAt(contextName string, incoming map[string]SignalSuppressionRecord, strategy string, now time.Time) (SignalSuppressionImportResult, error) {
	var result SignalSuppressionImportResult
	if strategy != "keepMine" && strategy != "useImported" && strategy != "replaceSections" {
		return result, fmt.Errorf("unsupported signal suppression import strategy %q", strategy)
	}
	contextName = strings.TrimSpace(contextName)
	if contextName == "" {
		return result, fmt.Errorf("context is required")
	}
	cleaned := map[string]SignalSuppressionRecord{}
	for _, key := range sortedSignalSuppressionKeys(incoming) {
		rec := incoming[key]
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" || cleanKey != key || utf8.RuneCountInString(key) > maxSignalSuppressionHistoryKeyLen {
			result.Skipped++
			continue
		}
		normalized, ok := normalizeImportedSignalSuppression(rec, now)
		if !ok {
			result.Skipped++
			continue
		}
		cleaned[key] = normalized
	}
	m.signalSuppressionsPruneMu.RLock()
	defer m.signalSuppressionsPruneMu.RUnlock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	defer contextLock.Unlock()
	if err := m.ensureSignalSuppressions(contextName, now); err != nil {
		return SignalSuppressionImportResult{}, err
	}
	m.signalSuppressionsMu.RLock()
	current := make(map[string]SignalSuppressionRecord, len(m.signalSuppressions[contextName]))
	for key, rec := range m.signalSuppressions[contextName] {
		current[key] = rec
	}
	m.signalSuppressionsMu.RUnlock()
	if strategy == "replaceSections" && len(cleaned) > SignalSuppressionMaxRecordsPerContext {
		bounded := make(map[string]SignalSuppressionRecord, SignalSuppressionMaxRecordsPerContext)
		for _, key := range sortedSignalSuppressionKeys(cleaned) {
			if len(bounded) == SignalSuppressionMaxRecordsPerContext {
				result.Skipped++
				continue
			}
			bounded[key] = cleaned[key]
		}
		cleaned = bounded
	}
	next := make(map[string]SignalSuppressionRecord, len(current)+len(cleaned))
	for key, rec := range current {
		next[key] = rec
	}
	if strategy == "replaceSections" {
		for key := range current {
			if _, ok := cleaned[key]; !ok {
				delete(next, key)
				result.Replaced++
			}
		}
	}
	for _, key := range sortedSignalSuppressionKeys(cleaned) {
		rec := cleaned[key]
		_, exists := current[key]
		if exists && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		if !exists && len(next) >= SignalSuppressionMaxRecordsPerContext {
			result.Skipped++
			continue
		}
		if exists {
			result.Replaced++
		}
		next[key] = rec
		result.Imported++
	}
	if sp := m.currentPersistence(); sp != nil {
		if err := sp.ReplaceSignalSuppressions(contextName, next); err != nil {
			return SignalSuppressionImportResult{}, err
		}
	}
	m.signalSuppressionsMu.Lock()
	m.signalSuppressions[contextName] = next
	m.signalSuppressionsMu.Unlock()
	return result, nil
}

func (m *manager) ResetSignalSuppressions(contextName, historyKey string) (int, error) {
	contextName, historyKey = strings.TrimSpace(contextName), strings.TrimSpace(historyKey)
	if contextName == "" {
		return 0, fmt.Errorf("context is required")
	}
	m.signalSuppressionsPruneMu.RLock()
	defer m.signalSuppressionsPruneMu.RUnlock()
	contextLock := m.signalSuppressionContextLock(contextName)
	contextLock.Lock()
	defer contextLock.Unlock()
	if err := m.ensureSignalSuppressions(contextName, time.Now().UTC()); err != nil {
		return 0, err
	}
	m.signalSuppressionsMu.RLock()
	current := m.signalSuppressions[contextName]
	next := make(map[string]SignalSuppressionRecord, len(current))
	for key, rec := range current {
		next[key] = rec
	}
	removed := 0
	if historyKey != "" {
		if _, ok := next[historyKey]; ok {
			delete(next, historyKey)
			removed = 1
		}
	} else {
		removed = len(next)
		next = map[string]SignalSuppressionRecord{}
	}
	m.signalSuppressionsMu.RUnlock()
	if sp := m.currentPersistence(); sp != nil {
		if err := sp.ReplaceSignalSuppressions(contextName, next); err != nil {
			return 0, err
		}
	}
	m.signalSuppressionsMu.Lock()
	m.signalSuppressions[contextName] = next
	m.signalSuppressionsMu.Unlock()
	return removed, nil
}
