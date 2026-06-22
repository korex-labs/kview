package dataplane

import (
	"context"
	"testing"
	"time"
)

func TestEffectiveSnapshotTTL_SourceAware(t *testing.T) {
	base := 30 * time.Second
	health := SchedulerHealthSnapshot{BackgroundAdmission: SchedulerBackgroundAdmissionPaused}
	pressure := SchedulerClusterPressureSnapshot{Running: 4, Queued: 1, LowPriorityQueued: 1, MaxSlots: 4, LongestQueueWaitMs: 2500}

	if got := effectiveSnapshotTTL(base, WorkSourceAPI, WorkPriorityCritical, ResourceKindPods, health, pressure); got != base {
		t.Fatalf("critical api TTL should not change, got %s", got)
	}
	if got := effectiveSnapshotTTL(base, WorkSourceObserver, WorkPriorityLow, ResourceKindPods, health, pressure); got <= base {
		t.Fatalf("background observer TTL should increase under pressure, got %s", got)
	}
	if got := effectiveSnapshotTTL(base, WorkSourceEnrichment, WorkPriorityLow, ResourceKindCustomResources, health, pressure); got != 7*base {
		t.Fatalf("expensive background TTL should compound health, queue, and kind pressure, got %s", got)
	}
}

func TestEffectiveSnapshotTTL_LimitedAdmission(t *testing.T) {
	base := time.Minute
	health := SchedulerHealthSnapshot{BackgroundAdmission: SchedulerBackgroundAdmissionLimited}
	got := effectiveSnapshotTTL(base, WorkSourceAllContexts, WorkPriorityLow, ResourceKindDeployments, health, SchedulerClusterPressureSnapshot{})
	if got != 2*base {
		t.Fatalf("limited admission TTL = %s, want %s", got, 2*base)
	}
}

func TestWorkScheduler_ClusterPressureSnapshot(t *testing.T) {
	s := newWorkScheduler(1)
	ctx := ContextWithWorkSource(context.Background(), WorkSourceEnrichment)
	keyRunning := workKey{Cluster: "c1", Class: WorkClassSnapshot, Kind: ResourceKindPods, Namespace: "app"}
	keyQueued := workKey{Cluster: "c1", Class: WorkClassSnapshot, Kind: ResourceKindDeployments, Namespace: "app"}
	infRunning := &inFlight{done: make(chan struct{}), effectivePriority: WorkPriorityLow}
	infQueued := &inFlight{done: make(chan struct{}), effectivePriority: WorkPriorityLow}

	runCtx, release, err := s.acquireSlot("c1", WorkPriorityLow, ctx, keyRunning, infRunning)
	if err != nil || runCtx == nil {
		t.Fatalf("acquire running slot: ctx=%v err=%v", runCtx, err)
	}
	done := make(chan struct{})
	go func() {
		_, rel, err := s.acquireSlot("c1", WorkPriorityLow, ctx, keyQueued, infQueued)
		if err == nil && rel != nil {
			rel()
		}
		close(done)
	}()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		pressure := s.ClusterPressureSnapshot("c1")
		if pressure.Running == 1 && pressure.Queued == 1 && pressure.LowPriorityQueued == 1 && pressure.MaxSlots == 1 {
			release()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatalf("queued worker did not drain after release")
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	release()
	t.Fatalf("queued pressure not observed: %+v", s.ClusterPressureSnapshot("c1"))
}
