package dataplane

import "time"

const ObserverStateDisabled ObserverState = "disabled"

// DataplaneExplanationSnapshot is a bounded, cache-only view of runtime state
// for one exact Kubernetes context.
type DataplaneExplanationSnapshot struct {
	Loaded         bool                                `json:"loaded"`
	Profile        DataplaneProfile                    `json:"profile"`
	Observers      []DataplaneExplanationObserver      `json:"observers"`
	Scheduler      *DataplaneExplanationScheduler      `json:"scheduler,omitempty"`
	Pressure       *DataplaneExplanationPressure       `json:"pressure,omitempty"`
	NamespaceSweep *DataplaneExplanationNamespaceSweep `json:"namespaceSweep,omitempty"`
}

// DataplaneExplanationObserver describes one of the fixed cluster observers.
type DataplaneExplanationObserver struct {
	Kind    string        `json:"kind"`
	Enabled bool          `json:"enabled"`
	State   ObserverState `json:"state,omitempty"`
}

// DataplaneExplanationScheduler contains exact-context scheduler history.
type DataplaneExplanationScheduler struct {
	State               SchedulerHealthState         `json:"state"`
	BackgroundAdmission SchedulerBackgroundAdmission `json:"backgroundAdmission"`
	ConsecutiveFailures int                          `json:"consecutiveFailures"`
	RecentFailures      int                          `json:"recentFailures"`
	RecentSuccesses     int                          `json:"recentSuccesses"`
	LastErrorClass      string                       `json:"lastErrorClass,omitempty"`
	LastTransition      time.Time                    `json:"lastTransition,omitempty"`
	LastEvent           time.Time                    `json:"lastEvent,omitempty"`
	Reason              string                       `json:"reason,omitempty"`
}

// DataplaneExplanationPressure contains exact-context scheduler lane pressure.
type DataplaneExplanationPressure struct {
	Running            int   `json:"running"`
	Queued             int   `json:"queued"`
	LowPriorityQueued  int   `json:"lowPriorityQueued"`
	LongestQueueWaitMs int64 `json:"longestQueueWaitMs"`
	MaxSlots           int   `json:"maxSlots"`
}

// DataplaneExplanationNamespaceSweep contains exact-context in-memory sweep coverage.
type DataplaneExplanationNamespaceSweep struct {
	Enabled                      bool   `json:"enabled"`
	TotalNamespaces              int    `json:"totalNamespaces"`
	CachedEnrichmentNamespaces   int    `json:"cachedEnrichmentNamespaces"`
	NoCachedEnrichmentNamespaces int    `json:"noCachedEnrichmentNamespaces"`
	CachedHotNamespaces          int    `json:"cachedHotNamespaces"`
	CachedWarmNamespaces         int    `json:"cachedWarmNamespaces"`
	CachedColdNamespaces         int    `json:"cachedColdNamespaces"`
	CachedStaleNamespaces        int    `json:"cachedStaleNamespaces"`
	CachedUnknownNamespaces      int    `json:"cachedUnknownNamespaces"`
	EnrichedNamespaces           int    `json:"enrichedNamespaces"`
	StaleNamespaces              int    `json:"staleNamespaces"`
	NeverScannedNamespaces       int    `json:"neverScannedNamespaces"`
	SystemNamespacesSkipped      int    `json:"systemNamespacesSkipped"`
	InFlight                     bool   `json:"inFlight,omitempty"`
	Stage                        string `json:"stage,omitempty"`
	DetailDone                   int    `json:"detailDone,omitempty"`
	RelatedDone                  int    `json:"relatedDone,omitempty"`
	EnrichTargets                int    `json:"enrichTargets,omitempty"`
	HourUsed                     int    `json:"hourUsed,omitempty"`
	HourLimit                    int    `json:"hourLimit,omitempty"`
	PausedReason                 string `json:"pausedReason,omitempty"`
}

// DataplaneExplanation peeks already-loaded runtime evidence for contextName.
// It does not create or warm a plane, schedule work, or hydrate persisted state.
func (m *manager) DataplaneExplanation(contextName string) DataplaneExplanationSnapshot {
	now := time.Now().UTC()
	policy := m.EffectivePolicy(contextName)
	out := DataplaneExplanationSnapshot{
		Profile: policy.Profile,
		Observers: []DataplaneExplanationObserver{
			explanationObserver("namespaces", policy.Observers.Enabled && policy.Observers.NamespacesEnabled),
			explanationObserver("nodes", policy.Observers.Enabled && policy.Observers.NodesEnabled),
		},
	}

	m.mu.RLock()
	plane := m.planes[contextName]
	m.mu.RUnlock()
	if plane == nil {
		return out
	}
	out.Loaded = true

	plane.obsMu.Lock()
	if plane.observers != nil {
		if out.Observers[0].Enabled && plane.observers.namespacesState != "" {
			out.Observers[0].State = plane.observers.namespacesState
		}
		if out.Observers[1].Enabled && plane.observers.nodesState != "" {
			out.Observers[1].State = plane.observers.nodesState
		}
	}
	plane.obsMu.Unlock()

	out.Scheduler = m.dataplaneExplanationScheduler(contextName)
	out.Pressure = m.dataplaneExplanationPressure(contextName, now)
	out.NamespaceSweep = m.dataplaneExplanationNamespaceSweep(contextName, plane, policy, now)
	return out
}

func explanationObserver(kind string, enabled bool) DataplaneExplanationObserver {
	observer := DataplaneExplanationObserver{Kind: kind, Enabled: enabled}
	if !observer.Enabled {
		observer.State = ObserverStateDisabled
	}
	return observer
}

func (m *manager) dataplaneExplanationScheduler(contextName string) *DataplaneExplanationScheduler {
	if m.scheduler == nil || m.scheduler.health == nil {
		return nil
	}
	row, ok := m.scheduler.health.snapshotIfTracked(contextName)
	if !ok {
		return nil
	}
	return &DataplaneExplanationScheduler{
		State:               row.State,
		BackgroundAdmission: row.BackgroundAdmission,
		ConsecutiveFailures: row.ConsecutiveFailures,
		RecentFailures:      row.RecentFailures,
		RecentSuccesses:     row.RecentSuccesses,
		LastErrorClass:      row.LastErrorClass,
		LastTransition:      row.LastTransition,
		LastEvent:           row.LastEvent,
		Reason:              row.Reason,
	}
}

func (m *manager) dataplaneExplanationPressure(contextName string, now time.Time) *DataplaneExplanationPressure {
	if m.scheduler == nil {
		return nil
	}
	m.scheduler.mu.Lock()
	defer m.scheduler.mu.Unlock()
	lane := m.scheduler.lanes[contextName]
	if lane == nil {
		return nil
	}
	out := &DataplaneExplanationPressure{
		Running:  len(lane.runners),
		Queued:   len(lane.waiters),
		MaxSlots: m.scheduler.maxPerCluster,
	}
	for _, waiter := range lane.waiters {
		if waiter == nil || waiter.abandoned {
			continue
		}
		if waiter.priority >= WorkPriorityLow {
			out.LowPriorityQueued++
		}
		waitMs := now.Sub(waiter.enqueuedAt).Milliseconds()
		if waitMs > out.LongestQueueWaitMs {
			out.LongestQueueWaitMs = waitMs
		}
	}
	return out
}

func (m *manager) dataplaneExplanationNamespaceSweep(
	contextName string,
	plane *clusterPlane,
	policy DataplanePolicy,
	now time.Time,
) *DataplaneExplanationNamespaceSweep {
	_, hasNamespaceSnapshot := peekClusterSnapshot(&plane.nsStore)

	m.nsSweepMu.Lock()
	_, hasSweepHistory := m.nsSweepLast[contextName]
	_, hasHourUsage := m.nsSweepHourCount[contextName]
	m.nsSweepMu.Unlock()

	m.nsEnrich.mu.Lock()
	_, hasEnrichmentSession := m.nsEnrich.byCluster[contextName]
	m.nsEnrich.mu.Unlock()
	if !hasNamespaceSnapshot && !hasSweepHistory && !hasHourUsage && !hasEnrichmentSession {
		return nil
	}

	coverage := m.namespaceSweepCoverageForPlane(contextName, plane, policy.NamespaceEnrichment, now)
	return &DataplaneExplanationNamespaceSweep{
		Enabled:                      coverage.Enabled,
		TotalNamespaces:              coverage.TotalNamespaces,
		CachedEnrichmentNamespaces:   coverage.CachedEnrichmentNamespaces,
		NoCachedEnrichmentNamespaces: coverage.NoCachedEnrichmentNamespaces,
		CachedHotNamespaces:          coverage.CachedHotNamespaces,
		CachedWarmNamespaces:         coverage.CachedWarmNamespaces,
		CachedColdNamespaces:         coverage.CachedColdNamespaces,
		CachedStaleNamespaces:        coverage.CachedStaleNamespaces,
		CachedUnknownNamespaces:      coverage.CachedUnknownNamespaces,
		EnrichedNamespaces:           coverage.EnrichedNamespaces,
		StaleNamespaces:              coverage.StaleNamespaces,
		NeverScannedNamespaces:       coverage.NeverScannedNamespaces,
		SystemNamespacesSkipped:      coverage.SystemNamespacesSkipped,
		InFlight:                     coverage.InFlight,
		Stage:                        coverage.Stage,
		DetailDone:                   coverage.DetailDone,
		RelatedDone:                  coverage.RelatedDone,
		EnrichTargets:                coverage.EnrichTargets,
		HourUsed:                     coverage.HourUsed,
		HourLimit:                    coverage.HourLimit,
		PausedReason:                 coverage.PausedReason,
	}
}
