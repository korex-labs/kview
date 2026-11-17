package dataplane

import (
	"time"
)

// HistoryNamespaces supplies current-context choices from already loaded cache.
// It neither discovers contexts nor creates, hydrates or refreshes a plane.
func (m *manager) HistoryNamespaces(name string) []string {
	names, _ := m.historyNamespaceInventory(name)
	return names
}
func (m *manager) historyNamespaceInventory(name string) ([]string, bool) {
	m.mu.RLock()
	p := m.planes[name]
	m.mu.RUnlock()
	out := []string{}
	if p == nil || p.persistHydrating.Load() {
		return out, false
	}
	snap, ok := peekClusterSnapshot(&p.nsStore)
	if historyEvidence(snap, ok, time.Now().UTC()).State != "complete" {
		return out, false
	}
	if len(snap.Items) > historyMaxMetricWork {
		return out, false
	}
	for _, ns := range snap.Items {
		if ns.Name != "" {
			out = append(out, ns.Name)
		}
	}
	return out, true
}

const historyMaxMetricWork = 20000
const historyMaxAge = 15 * time.Minute

type historyInputEvidence struct {
	State      string
	ObservedAt time.Time
	SourceAt   time.Time
	Reason     string
}

func historyEvidence[I any](s Snapshot[I], ok bool, now time.Time) historyInputEvidence {
	e := historyInputEvidence{State: "missing", ObservedAt: s.Meta.ObservedAt}
	if !ok {
		return e
	}
	if s.Err != nil {
		if s.Err.Class == NormalizedErrorClassAccessDenied || s.Err.Class == NormalizedErrorClassUnauthorized {
			e.State = "denied"
		}
		return e
	}
	if s.restored || s.Meta.ObservedAt.After(now) || now.Sub(s.Meta.ObservedAt) > historyMaxAge || s.Meta.Freshness == FreshnessClassStale || s.Meta.Freshness == FreshnessClassCold {
		e.State = "stale"
		return e
	}
	if (s.Meta.Freshness != FreshnessClassHot && s.Meta.Freshness != FreshnessClassWarm) || s.Meta.Coverage != CoverageClassFull || s.Meta.Completeness != CompletenessClassComplete {
		e.State = "partial"
		return e
	}
	e.State = "complete"
	return e
}
