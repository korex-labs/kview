package dataplane

import (
	"sync"
	"time"
)

// SchedulerRunStatsSnapshot is a process-lifetime summary of completed snapshot runs
// (actual kube list work after a slot was acquired). Suitable for a future diagnostics UI.
type SchedulerRunStatsSnapshot struct {
	ByPriority  []PriorityRunStats
	ByKind      []KindRunStats
	Preemptions uint64
	Health      []SchedulerHealthSnapshot
}

// PriorityRunStats aggregates run durations for one priority band.
type PriorityRunStats struct {
	Priority WorkPriority
	Runs     uint64
	Total    time.Duration
	Max      time.Duration
}

// KindRunStats aggregates run durations for one resource kind (cross-priority).
type KindRunStats struct {
	Kind  ResourceKind
	Runs  uint64
	Total time.Duration
	Max   time.Duration
}

type runStats struct {
	mu sync.Mutex

	byPriority [4]struct {
		runs    uint64
		totalNs int64
		maxNs   int64
	}
	byKind map[ResourceKind]struct {
		runs    uint64
		totalNs int64
		maxNs   int64
	}
	preemptions uint64
}

func newRunStats() *runStats {
	return &runStats{
		byKind: make(map[ResourceKind]struct {
			runs    uint64
			totalNs int64
			maxNs   int64
		}),
	}
}

func (st *runStats) recordPreemption() {
	st.mu.Lock()
	st.preemptions++
	st.mu.Unlock()
}

func (st *runStats) recordRun(priority WorkPriority, kind ResourceKind, d time.Duration) {
	if int(priority) < 0 || int(priority) >= len(st.byPriority) {
		return
	}
	ns := d.Nanoseconds()
	if ns < 0 {
		ns = 0
	}

	st.mu.Lock()
	defer st.mu.Unlock()

	b := &st.byPriority[priority]
	b.runs++
	b.totalNs += ns
	if ns > b.maxNs {
		b.maxNs = ns
	}

	kb := st.byKind[kind]
	kb.runs++
	kb.totalNs += ns
	if ns > kb.maxNs {
		kb.maxNs = ns
	}
	st.byKind[kind] = kb
}

func (st *runStats) snapshot() SchedulerRunStatsSnapshot {
	st.mu.Lock()
	defer st.mu.Unlock()

	out := SchedulerRunStatsSnapshot{
		Preemptions: st.preemptions,
		ByPriority:  make([]PriorityRunStats, 0, 4),
		ByKind:      make([]KindRunStats, 0, len(st.byKind)),
	}

	for p := WorkPriorityCritical; p <= WorkPriorityLow; p++ {
		b := st.byPriority[p]
		if b.runs == 0 {
			continue
		}
		out.ByPriority = append(out.ByPriority, PriorityRunStats{
			Priority: p,
			Runs:     b.runs,
			Total:    time.Duration(b.totalNs),
			Max:      time.Duration(b.maxNs),
		})
	}

	for kind, b := range st.byKind {
		if b.runs == 0 {
			continue
		}
		out.ByKind = append(out.ByKind, KindRunStats{
			Kind:  kind,
			Runs:  b.runs,
			Total: time.Duration(b.totalNs),
			Max:   time.Duration(b.maxNs),
		})
	}
	return out
}
