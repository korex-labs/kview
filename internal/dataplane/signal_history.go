package dataplane

import (
	"sort"
	"strings"
	"time"
)

type signalHistoryRecord struct {
	FirstSeenAt int64  `json:"firstSeenAt"`
	LastSeenAt  int64  `json:"lastSeenAt"`
	SeenCount   uint64 `json:"seenCount,omitempty"`
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
	loaded := map[string]signalHistoryRecord{}
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
	changed := map[string]signalHistoryRecord{}

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
		if observedUnix > rec.LastSeenAt {
			rec.LastSeenAt = observedUnix
		}
		rec.SeenCount++
		clusterHistory[key] = rec
		changed[key] = rec
		items[i].HistoryKey = key
		items[i].FirstSeenAt = rec.FirstSeenAt
		items[i].LastSeenAt = rec.LastSeenAt
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
