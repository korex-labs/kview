package dataplane

import (
	"context"
	"testing"
	"time"
)

func TestSchedulerHealth_BackgroundAdmissionTransitions(t *testing.T) {
	h := newSchedulerHealthTracker()
	now := time.Unix(1000, 0)
	h.now = func() time.Time { return now }

	if got := h.snapshot("c1").BackgroundAdmission; got != SchedulerBackgroundAdmissionOpen {
		t.Fatalf("initial admission = %s", got)
	}

	h.recordError("c1", NormalizedErrorClassTimeout)
	h.recordError("c1", NormalizedErrorClassRateLimited)
	limited := h.snapshot("c1")
	if limited.State != SchedulerHealthLimited || limited.BackgroundAdmission != SchedulerBackgroundAdmissionLimited {
		t.Fatalf("limited snapshot: %+v", limited)
	}

	h.recordError("c1", NormalizedErrorClassTimeout)
	paused := h.snapshot("c1")
	if paused.State != SchedulerHealthThrottled || paused.BackgroundAdmission != SchedulerBackgroundAdmissionPaused {
		t.Fatalf("paused snapshot: %+v", paused)
	}

	now = now.Add(3 * time.Minute)
	h.recordSuccess("c1")
	h.recordSuccess("c1")
	recovered := h.snapshot("c1")
	if recovered.State != SchedulerHealthHealthy || recovered.BackgroundAdmission != SchedulerBackgroundAdmissionOpen {
		t.Fatalf("recovered snapshot: %+v", recovered)
	}
}

func TestWorkScheduler_RecordsPressureHealth(t *testing.T) {
	s := newWorkScheduler(1)
	s.configureRetries(1, time.Millisecond, time.Millisecond)
	key := workKey{Cluster: "c1", Class: WorkClassSnapshot, Kind: ResourceKindPods, Namespace: "ns"}

	for i := 0; i < 3; i++ {
		_ = s.Run(context.Background(), WorkPriorityLow, key, func(runCtx context.Context) error {
			return context.DeadlineExceeded
		})
	}

	health := s.HealthSnapshot("c1")
	if health.BackgroundAdmission != SchedulerBackgroundAdmissionPaused {
		t.Fatalf("expected paused admission, got %+v", health)
	}
	stats := s.StatsSnapshot()
	if len(stats.Health) == 0 || stats.Health[0].Cluster != "c1" {
		t.Fatalf("expected health in stats, got %+v", stats.Health)
	}
}

func TestSchedulerHealth_IgnoresAccessDeniedForPressure(t *testing.T) {
	h := newSchedulerHealthTracker()
	h.recordError("c1", NormalizedErrorClassAccessDenied)
	if got := h.snapshot("c1").BackgroundAdmission; got != SchedulerBackgroundAdmissionOpen {
		t.Fatalf("access denied should not throttle background, got %s", got)
	}
}

func TestWorkScheduler_RecordsTransientErrorClass(t *testing.T) {
	s := newWorkScheduler(1)
	s.configureRetries(1, time.Millisecond, time.Millisecond)
	key := workKey{Cluster: "c1", Class: WorkClassSnapshot, Kind: ResourceKindPods, Namespace: "ns"}
	_ = s.Run(context.Background(), WorkPriorityLow, key, func(runCtx context.Context) error {
		return context.DeadlineExceeded
	})
	if health := s.HealthSnapshot("c1"); health.RecentFailures < 1 {
		t.Fatalf("expected pressure failure, got %+v", health)
	}
}
