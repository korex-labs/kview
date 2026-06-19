package dataplane

import (
	"sync"
	"time"
)

type SchedulerHealthState string

const (
	SchedulerHealthHealthy    SchedulerHealthState = "healthy"
	SchedulerHealthLimited    SchedulerHealthState = "limited"
	SchedulerHealthThrottled  SchedulerHealthState = "throttled"
	SchedulerHealthRecovering SchedulerHealthState = "recovering"
)

type SchedulerBackgroundAdmission string

const (
	SchedulerBackgroundAdmissionOpen    SchedulerBackgroundAdmission = "open"
	SchedulerBackgroundAdmissionLimited SchedulerBackgroundAdmission = "limited"
	SchedulerBackgroundAdmissionPaused  SchedulerBackgroundAdmission = "paused"
)

type SchedulerHealthSnapshot struct {
	Cluster             string                       `json:"cluster"`
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

type schedulerHealthEvent struct {
	at     time.Time
	failed bool
	class  NormalizedErrorClass
}

type clusterSchedulerHealth struct {
	state          SchedulerHealthState
	lastTransition time.Time
	lastEvent      time.Time
	lastErrorClass NormalizedErrorClass
	consecutive    int
	events         []schedulerHealthEvent
}

type schedulerHealthTracker struct {
	mu       sync.Mutex
	clusters map[string]*clusterSchedulerHealth
	now      func() time.Time
	window   time.Duration
}

func newSchedulerHealthTracker() *schedulerHealthTracker {
	return &schedulerHealthTracker{
		clusters: map[string]*clusterSchedulerHealth{},
		now:      time.Now,
		window:   2 * time.Minute,
	}
}

func (h *schedulerHealthTracker) snapshot(cluster string) SchedulerHealthSnapshot {
	if h == nil {
		return SchedulerHealthSnapshot{Cluster: cluster, State: SchedulerHealthHealthy, BackgroundAdmission: SchedulerBackgroundAdmissionOpen}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked(cluster, h.now())
}

func (h *schedulerHealthTracker) allSnapshots() []SchedulerHealthSnapshot {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	out := make([]SchedulerHealthSnapshot, 0, len(h.clusters))
	for cluster := range h.clusters {
		out = append(out, h.snapshotLocked(cluster, now))
	}
	return out
}

func (h *schedulerHealthTracker) recordSuccess(cluster string) {
	if h == nil || cluster == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	st := h.clusterLocked(cluster, now)
	st.consecutive = 0
	st.lastEvent = now
	st.events = append(st.events, schedulerHealthEvent{at: now})
	h.pruneLocked(st, now)
	h.updateStateLocked(st, now)
}

func (h *schedulerHealthTracker) recordError(cluster string, class NormalizedErrorClass) {
	if h == nil || cluster == "" || !schedulerHealthClassCountsAsPressure(class) {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	st := h.clusterLocked(cluster, now)
	st.consecutive++
	st.lastEvent = now
	st.lastErrorClass = class
	st.events = append(st.events, schedulerHealthEvent{at: now, failed: true, class: class})
	h.pruneLocked(st, now)
	h.updateStateLocked(st, now)
}

func (h *schedulerHealthTracker) clusterLocked(cluster string, now time.Time) *clusterSchedulerHealth {
	st := h.clusters[cluster]
	if st == nil {
		st = &clusterSchedulerHealth{state: SchedulerHealthHealthy, lastTransition: now}
		h.clusters[cluster] = st
	}
	return st
}

func (h *schedulerHealthTracker) pruneLocked(st *clusterSchedulerHealth, now time.Time) {
	cutoff := now.Add(-h.window)
	keep := 0
	for _, ev := range st.events {
		if ev.at.After(cutoff) || ev.at.Equal(cutoff) {
			st.events[keep] = ev
			keep++
		}
	}
	st.events = st.events[:keep]
}

func (h *schedulerHealthTracker) updateStateLocked(st *clusterSchedulerHealth, now time.Time) {
	failures, successes := schedulerHealthCounts(st.events)
	next := SchedulerHealthHealthy
	if st.consecutive >= 3 || failures >= 5 {
		next = SchedulerHealthThrottled
	} else if st.consecutive >= 2 || failures >= 3 {
		next = SchedulerHealthLimited
	} else if st.state != SchedulerHealthHealthy && successes >= 2 && failures == 0 {
		next = SchedulerHealthRecovering
	}
	if next != st.state {
		st.state = next
		st.lastTransition = now
	}
}

func (h *schedulerHealthTracker) snapshotLocked(cluster string, now time.Time) SchedulerHealthSnapshot {
	st := h.clusterLocked(cluster, now)
	h.pruneLocked(st, now)
	h.updateStateLocked(st, now)
	failures, successes := schedulerHealthCounts(st.events)
	admission := SchedulerBackgroundAdmissionOpen
	reason := ""
	switch st.state {
	case SchedulerHealthThrottled:
		admission = SchedulerBackgroundAdmissionPaused
		reason = "recent rate-limit/timeout/connectivity pressure"
	case SchedulerHealthLimited:
		admission = SchedulerBackgroundAdmissionLimited
		reason = "recent transient pressure"
	case SchedulerHealthRecovering:
		admission = SchedulerBackgroundAdmissionLimited
		reason = "recovering after scheduler pressure"
	}
	lastClass := ""
	if st.lastErrorClass != "" {
		lastClass = string(st.lastErrorClass)
	}
	return SchedulerHealthSnapshot{
		Cluster:             cluster,
		State:               st.state,
		BackgroundAdmission: admission,
		ConsecutiveFailures: st.consecutive,
		RecentFailures:      failures,
		RecentSuccesses:     successes,
		LastErrorClass:      lastClass,
		LastTransition:      st.lastTransition,
		LastEvent:           st.lastEvent,
		Reason:              reason,
	}
}

func schedulerHealthCounts(events []schedulerHealthEvent) (failures int, successes int) {
	for _, ev := range events {
		if ev.failed {
			failures++
		} else {
			successes++
		}
	}
	return failures, successes
}

func schedulerHealthClassCountsAsPressure(class NormalizedErrorClass) bool {
	switch class {
	case NormalizedErrorClassRateLimited,
		NormalizedErrorClassTimeout,
		NormalizedErrorClassTransient,
		NormalizedErrorClassProxyFailure,
		NormalizedErrorClassConnectivity:
		return true
	default:
		return false
	}
}
