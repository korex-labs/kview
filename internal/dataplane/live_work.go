package dataplane

import (
	"fmt"
	"time"
)

// SchedulerLiveWork is a point-in-time view of dataplane scheduler slots for operators.
type SchedulerLiveWork struct {
	MaxSlotsPerCluster int                       `json:"maxSlotsPerCluster"`
	Running            []SchedulerWorkRow        `json:"running"`
	Queued             []SchedulerWorkRow        `json:"queued"`
	Health             []SchedulerHealthSnapshot `json:"health,omitempty"`
}

// SchedulerWorkRow describes one running or queued snapshot execution.
type SchedulerWorkRow struct {
	WorkKey   string `json:"workKey"`
	Cluster   string `json:"cluster"`
	Class     string `json:"class"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Priority  string `json:"priority"`
	Source    string `json:"source"`
	State     string `json:"state"`
	WaitMs    int64  `json:"waitMs"`    // queue wait before run started (running), or time waiting in queue (queued)
	RunningMs int64  `json:"runningMs"` // wall time in slot for running rows; 0 when queued
}

func makeSchedulerWorkRow(k workKey, state string, prio WorkPriority, source string, waitMs, runningMs int64) SchedulerWorkRow {
	ns := k.Namespace
	wk := fmt.Sprintf("%s|%s|%s|%s", k.Cluster, k.Class, k.Kind, ns)
	src := source
	if src == "" {
		src = WorkSourceAPI
	}
	return SchedulerWorkRow{
		WorkKey:   wk,
		Cluster:   k.Cluster,
		Class:     string(k.Class),
		Kind:      string(k.Kind),
		Namespace: ns,
		Priority:  prio.String(),
		Source:    src,
		State:     state,
		WaitMs:    waitMs,
		RunningMs: runningMs,
	}
}

// LiveWorkSnapshot returns running and queued work as of now.
func (s *workScheduler) LiveWorkSnapshot(now time.Time) SchedulerLiveWork {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := SchedulerLiveWork{
		MaxSlotsPerCluster: s.maxPerCluster,
		Running:            []SchedulerWorkRow{},
		Queued:             []SchedulerWorkRow{},
		Health:             s.health.allSnapshots(),
	}
	for _, lane := range s.lanes {
		for _, r := range lane.runners {
			rm := now.Sub(r.startedAt).Milliseconds()
			if rm < 0 {
				rm = 0
			}
			out.Running = append(out.Running, makeSchedulerWorkRow(r.key, "running", r.priority, r.source, r.queuedWaitMs, rm))
		}
		for _, w := range lane.waiters {
			qm := now.Sub(w.enqueuedAt).Milliseconds()
			if qm < 0 {
				qm = 0
			}
			out.Queued = append(out.Queued, makeSchedulerWorkRow(w.key, "queued", w.priority, w.source, qm, 0))
		}
	}
	return out
}
