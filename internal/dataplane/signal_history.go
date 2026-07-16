package dataplane

import (
	"sort"
	"strings"
	"time"
)

type SignalHistoryRecord struct {
	FirstSeenAt  int64   `json:"firstSeenAt"`
	LastSeenAt   int64   `json:"lastSeenAt"`
	SeenCount    uint64  `json:"seenCount,omitempty"`
	ObservedDays []int64 `json:"observedDays,omitempty"`
}

type SignalAcknowledgementRecord struct {
	AcknowledgedAt int64  `json:"acknowledgedAt"`
	AcknowledgedBy string `json:"acknowledgedBy,omitempty"`
	Comment        string `json:"comment,omitempty"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type SignalAcknowledgementRequest struct {
	HistoryKey string `json:"historyKey"`
	Comment    string `json:"comment,omitempty"`
}

type SignalAcknowledgementImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Replaced int `json:"replaced"`
}

type SignalHistoryImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Replaced int `json:"replaced"`
}

func (m *manager) ensureSignalHistory(clusterName string) {
	if clusterName == "" {
		return
	}
	m.signalHistoryMu.RLock()
	_, ok := m.signalHistory[clusterName]
	m.signalHistoryMu.RUnlock()
	if ok {
		return
	}
	loaded := map[string]SignalHistoryRecord{}
	if sp := m.currentPersistence(); sp != nil {
		if hist, err := sp.LoadSignalHistory(clusterName); err == nil && hist != nil {
			loaded = hist
		}
	}
	m.signalHistoryMu.Lock()
	if _, ok := m.signalHistory[clusterName]; !ok {
		m.signalHistory[clusterName] = loaded
	}
	m.signalHistoryMu.Unlock()
}

func (m *manager) ensureSignalAcknowledgements(clusterName string) {
	if clusterName == "" {
		return
	}
	m.signalAckMu.RLock()
	_, ok := m.signalAck[clusterName]
	m.signalAckMu.RUnlock()
	if ok {
		return
	}
	loaded := map[string]SignalAcknowledgementRecord{}
	if sp := m.currentPersistence(); sp != nil {
		if ack, err := sp.LoadSignalAcknowledgements(clusterName); err == nil && ack != nil {
			loaded = ack
		}
	}
	m.signalAckMu.Lock()
	if _, ok := m.signalAck[clusterName]; !ok {
		m.signalAck[clusterName] = loaded
	}
	m.signalAckMu.Unlock()
}

func (m *manager) attachSignalHistory(clusterName string, observedAt time.Time, items ...ClusterDashboardSignal) []ClusterDashboardSignal {
	if len(items) == 0 || clusterName == "" {
		return items
	}
	m.ensureSignalHistory(clusterName)
	m.ensureSignalAcknowledgements(clusterName)
	observedUnix := observedAt.UTC().Unix()
	changed := map[string]SignalHistoryRecord{}

	m.signalHistoryMu.Lock()
	clusterHistory := m.signalHistory[clusterName]
	for i := range items {
		key := signalHistoryIdentity(items[i])
		if key == "" {
			continue
		}
		rec := clusterHistory[key]
		if rec.FirstSeenAt <= 0 {
			rec.FirstSeenAt = observedUnix
		}
		rec.ObservedDays = updateSignalObservedDays(rec, observedUnix)
		if observedUnix > rec.LastSeenAt {
			rec.LastSeenAt = observedUnix
		}
		rec.SeenCount++
		observedDays7d := countSignalObservedDays(rec.ObservedDays, rec.LastSeenAt, 7)
		observedDays30d := countSignalObservedDays(rec.ObservedDays, rec.LastSeenAt, 30)
		clusterHistory[key] = rec
		changed[key] = rec
		items[i].HistoryKey = key
		items[i].FirstSeenAt = rec.FirstSeenAt
		items[i].LastSeenAt = rec.LastSeenAt
		items[i].ObservedDays7d = observedDays7d
		items[i].ObservedDays30d = observedDays30d
		items[i].Recurring = observedDays7d >= 2
	}
	m.signalHistoryMu.Unlock()

	m.signalAckMu.RLock()
	clusterAck := m.signalAck[clusterName]
	for i := range items {
		if ack, ok := clusterAck[items[i].HistoryKey]; ok && ack.AcknowledgedAt > 0 {
			items[i].Acknowledged = true
			items[i].AcknowledgedAt = ack.AcknowledgedAt
			items[i].AckComment = ack.Comment
		}
	}
	m.signalAckMu.RUnlock()

	if sp := m.currentPersistence(); sp != nil && len(changed) > 0 {
		_ = sp.UpsertSignalHistory(clusterName, changed)
	}
	return items
}

const signalObservedDayRetention = 30

func signalObservedDay(unix int64) int64 {
	if unix <= 0 {
		return 0
	}
	return time.Unix(unix, 0).UTC().Truncate(24 * time.Hour).Unix()
}

func updateSignalObservedDays(rec SignalHistoryRecord, observedUnix int64) []int64 {
	latestUnix := observedUnix
	if rec.LastSeenAt > latestUnix {
		latestUnix = rec.LastSeenAt
	}
	latestDay := signalObservedDay(latestUnix)
	observedDay := signalObservedDay(observedUnix)
	if latestDay <= 0 || observedDay <= 0 {
		return nil
	}
	cutoff := latestDay - int64(signalObservedDayRetention-1)*int64(24*time.Hour/time.Second)
	candidates := make([]int64, 0, len(rec.ObservedDays)+3)
	candidates = append(candidates, rec.ObservedDays...)
	candidates = append(candidates, signalObservedDay(rec.FirstSeenAt), signalObservedDay(rec.LastSeenAt), observedDay)
	sort.Slice(candidates, func(i, j int) bool { return candidates[i] < candidates[j] })
	out := make([]int64, 0, len(candidates))
	for _, day := range candidates {
		if day < cutoff || day > latestDay {
			continue
		}
		if len(out) > 0 && out[len(out)-1] == day {
			continue
		}
		out = append(out, day)
	}
	return out
}

func countSignalObservedDays(days []int64, observedUnix int64, windowDays int) int {
	if windowDays <= 0 {
		return 0
	}
	observedDay := signalObservedDay(observedUnix)
	if observedDay <= 0 {
		return 0
	}
	cutoff := observedDay - int64(windowDays-1)*int64(24*time.Hour/time.Second)
	count := 0
	for _, day := range days {
		if day >= cutoff && day <= observedDay {
			count++
		}
	}
	return count
}

func (m *manager) AcknowledgeSignal(clusterName string, req SignalAcknowledgementRequest) (SignalAcknowledgementRecord, error) {
	key := strings.TrimSpace(req.HistoryKey)
	if clusterName == "" || key == "" {
		return SignalAcknowledgementRecord{}, nil
	}
	m.ensureSignalAcknowledgements(clusterName)
	now := time.Now().UTC().Unix()
	comment := strings.TrimSpace(req.Comment)
	rec := SignalAcknowledgementRecord{
		AcknowledgedAt: now,
		Comment:        comment,
		UpdatedAt:      now,
	}
	m.signalAckMu.Lock()
	if m.signalAck[clusterName] == nil {
		m.signalAck[clusterName] = map[string]SignalAcknowledgementRecord{}
	}
	if existing := m.signalAck[clusterName][key]; existing.AcknowledgedAt > 0 {
		rec.AcknowledgedAt = existing.AcknowledgedAt
	}
	m.signalAck[clusterName][key] = rec
	m.signalAckMu.Unlock()
	if sp := m.currentPersistence(); sp != nil {
		if err := sp.UpsertSignalAcknowledgement(clusterName, key, rec); err != nil {
			return SignalAcknowledgementRecord{}, err
		}
	}
	return rec, nil
}

func (m *manager) UnacknowledgeSignal(clusterName, historyKey string) error {
	key := strings.TrimSpace(historyKey)
	if clusterName == "" || key == "" {
		return nil
	}
	m.ensureSignalAcknowledgements(clusterName)
	m.signalAckMu.Lock()
	if m.signalAck[clusterName] != nil {
		delete(m.signalAck[clusterName], key)
	}
	m.signalAckMu.Unlock()
	if sp := m.currentPersistence(); sp != nil {
		return sp.DeleteSignalAcknowledgement(clusterName, key)
	}
	return nil
}

func (m *manager) ExportSignalAcknowledgements(clusterName string) map[string]SignalAcknowledgementRecord {
	if clusterName == "" {
		return map[string]SignalAcknowledgementRecord{}
	}
	m.ensureSignalAcknowledgements(clusterName)
	m.signalAckMu.RLock()
	defer m.signalAckMu.RUnlock()
	out := map[string]SignalAcknowledgementRecord{}
	for key, rec := range m.signalAck[clusterName] {
		if strings.TrimSpace(key) == "" || rec.AcknowledgedAt <= 0 {
			continue
		}
		out[key] = rec
	}
	return out
}

func (m *manager) ImportSignalAcknowledgements(clusterName string, incoming map[string]SignalAcknowledgementRecord, strategy string) (SignalAcknowledgementImportResult, error) {
	var result SignalAcknowledgementImportResult
	if clusterName == "" {
		return result, nil
	}
	m.ensureSignalAcknowledgements(clusterName)
	cleaned := map[string]SignalAcknowledgementRecord{}
	for key, rec := range incoming {
		key = strings.TrimSpace(key)
		if key == "" || rec.AcknowledgedAt <= 0 {
			continue
		}
		rec.Comment = strings.TrimSpace(rec.Comment)
		rec.AcknowledgedBy = strings.TrimSpace(rec.AcknowledgedBy)
		if rec.UpdatedAt <= 0 {
			rec.UpdatedAt = rec.AcknowledgedAt
		}
		cleaned[key] = rec
	}

	m.signalAckMu.Lock()
	if m.signalAck[clusterName] == nil {
		m.signalAck[clusterName] = map[string]SignalAcknowledgementRecord{}
	}
	current := m.signalAck[clusterName]
	deleteKeys := []string{}
	if strategy == "replaceSections" {
		for key := range current {
			if _, ok := cleaned[key]; !ok {
				delete(current, key)
				deleteKeys = append(deleteKeys, key)
				result.Replaced++
			}
		}
	}
	upserts := map[string]SignalAcknowledgementRecord{}
	for key, rec := range cleaned {
		_, exists := current[key]
		if exists && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		if exists {
			result.Replaced++
		}
		current[key] = rec
		upserts[key] = rec
		result.Imported++
	}
	m.signalAckMu.Unlock()

	if sp := m.currentPersistence(); sp != nil {
		for _, key := range deleteKeys {
			if err := sp.DeleteSignalAcknowledgement(clusterName, key); err != nil {
				return result, err
			}
		}
		for key, rec := range upserts {
			if err := sp.UpsertSignalAcknowledgement(clusterName, key, rec); err != nil {
				return result, err
			}
		}
	}
	return result, nil
}

func (m *manager) ExportSignalHistory(clusterName string) map[string]SignalHistoryRecord {
	if clusterName == "" {
		return map[string]SignalHistoryRecord{}
	}
	m.ensureSignalHistory(clusterName)
	m.signalHistoryMu.RLock()
	defer m.signalHistoryMu.RUnlock()
	out := map[string]SignalHistoryRecord{}
	for key, rec := range m.signalHistory[clusterName] {
		if strings.TrimSpace(key) == "" || rec.LastSeenAt <= 0 {
			continue
		}
		rec.ObservedDays = append([]int64(nil), rec.ObservedDays...)
		out[key] = rec
	}
	return out
}

func normalizeImportedSignalHistory(rec SignalHistoryRecord) (SignalHistoryRecord, bool) {
	if rec.FirstSeenAt <= 0 || rec.LastSeenAt <= 0 || rec.LastSeenAt < rec.FirstSeenAt {
		return SignalHistoryRecord{}, false
	}
	latestDay := signalObservedDay(rec.LastSeenAt)
	filteredDays := make([]int64, 0, len(rec.ObservedDays))
	for _, day := range rec.ObservedDays {
		day = signalObservedDay(day)
		if day > 0 && day <= latestDay {
			filteredDays = append(filteredDays, day)
		}
	}
	rec.ObservedDays = filteredDays
	rec.ObservedDays = updateSignalObservedDays(rec, rec.LastSeenAt)
	if len(rec.ObservedDays) == 0 {
		return SignalHistoryRecord{}, false
	}
	if rec.SeenCount == 0 {
		rec.SeenCount = uint64(len(rec.ObservedDays))
	}
	return rec, true
}

func (m *manager) ImportSignalHistory(clusterName string, incoming map[string]SignalHistoryRecord, strategy string) (SignalHistoryImportResult, error) {
	var result SignalHistoryImportResult
	if clusterName == "" {
		return result, nil
	}
	m.ensureSignalHistory(clusterName)
	cleaned := map[string]SignalHistoryRecord{}
	for key, rec := range incoming {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if normalized, ok := normalizeImportedSignalHistory(rec); ok {
			cleaned[key] = normalized
		}
	}

	m.signalHistoryMu.Lock()
	if m.signalHistory[clusterName] == nil {
		m.signalHistory[clusterName] = map[string]SignalHistoryRecord{}
	}
	current := m.signalHistory[clusterName]
	deleteKeys := []string{}
	if strategy == "replaceSections" {
		for key := range current {
			if _, ok := cleaned[key]; !ok {
				delete(current, key)
				deleteKeys = append(deleteKeys, key)
				result.Replaced++
			}
		}
	}
	upserts := map[string]SignalHistoryRecord{}
	for key, rec := range cleaned {
		_, exists := current[key]
		if exists && strategy == "keepMine" {
			result.Skipped++
			continue
		}
		if exists {
			result.Replaced++
		}
		current[key] = rec
		upserts[key] = rec
		result.Imported++
	}
	m.signalHistoryMu.Unlock()

	if sp := m.currentPersistence(); sp != nil {
		for _, key := range deleteKeys {
			if err := sp.DeleteSignalHistory(clusterName, key); err != nil {
				return result, err
			}
		}
		if err := sp.UpsertSignalHistory(clusterName, upserts); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (m *manager) ResetSignalHistory(clusterName, historyKey string) (int, error) {
	if clusterName == "" {
		return 0, nil
	}
	m.ensureSignalHistory(clusterName)
	key := strings.TrimSpace(historyKey)
	m.signalHistoryMu.Lock()
	current := m.signalHistory[clusterName]
	keys := []string{}
	if key != "" {
		if _, ok := current[key]; ok {
			delete(current, key)
			keys = append(keys, key)
		}
	} else {
		for currentKey := range current {
			keys = append(keys, currentKey)
		}
		m.signalHistory[clusterName] = map[string]SignalHistoryRecord{}
	}
	m.signalHistoryMu.Unlock()
	if sp := m.currentPersistence(); sp != nil {
		for _, deleteKey := range keys {
			if err := sp.DeleteSignalHistory(clusterName, deleteKey); err != nil {
				return len(keys), err
			}
		}
	}
	return len(keys), nil
}

func signalHistoryIdentity(item ClusterDashboardSignal) string {
	if trimmed := strings.TrimSpace(item.HistoryKey); trimmed != "" {
		return trimmed
	}
	parts := []string{
		strings.TrimSpace(item.SignalType),
		strings.TrimSpace(item.Scope),
		strings.TrimSpace(item.ScopeLocation),
		strings.TrimSpace(signalIdentityKind(item)),
		strings.TrimSpace(signalIdentityName(item)),
	}
	filtered := parts[:0]
	for _, part := range parts {
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, "|")
}

func signalIdentityKind(item ClusterDashboardSignal) string {
	if item.ResourceKind != "" {
		return item.ResourceKind
	}
	return item.Kind
}

func signalIdentityName(item ClusterDashboardSignal) string {
	if item.ResourceName != "" {
		return item.ResourceName
	}
	if item.Name != "" {
		return item.Name
	}
	return item.Namespace
}

func sortDashboardSignalsForItems(items []ClusterDashboardSignal, sortBy string) {
	sortBy = strings.TrimSpace(sortBy)
	if sortBy == "" || sortBy == "priority" || len(items) <= 1 {
		return
	}
	sort.Slice(items, func(i, j int) bool {
		switch sortBy {
		case "discovered_desc":
			if items[i].FirstSeenAt != items[j].FirstSeenAt {
				return items[i].FirstSeenAt > items[j].FirstSeenAt
			}
		case "discovered_asc":
			if items[i].FirstSeenAt != items[j].FirstSeenAt {
				return items[i].FirstSeenAt < items[j].FirstSeenAt
			}
		case "last_seen_desc":
			if items[i].LastSeenAt != items[j].LastSeenAt {
				return items[i].LastSeenAt > items[j].LastSeenAt
			}
		case "last_seen_asc":
			if items[i].LastSeenAt != items[j].LastSeenAt {
				return items[i].LastSeenAt < items[j].LastSeenAt
			}
		default:
			return dashboardSignalLess(items[i], items[j])
		}
		return dashboardSignalLess(items[i], items[j])
	})
}

func dashboardSignalLess(a, b ClusterDashboardSignal) bool {
	if sa, sb := dashboardSignalSeverityPriority(a.Severity), dashboardSignalSeverityPriority(b.Severity); sa != sb {
		return sa < sb
	}
	if pa, pb := dashboardSignalPriority(a), dashboardSignalPriority(b); pa != pb {
		return pa < pb
	}
	if ka, kb := dashboardSignalKindPriority(a.Kind), dashboardSignalKindPriority(b.Kind); ka != kb {
		return ka < kb
	}
	if a.Score != b.Score {
		return a.Score > b.Score
	}
	if a.Namespace != b.Namespace {
		return a.Namespace < b.Namespace
	}
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.Name < b.Name
}
