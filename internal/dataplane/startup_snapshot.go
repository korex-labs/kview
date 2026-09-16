package dataplane

import (
	"context"
	"time"
)

// Only the first read of a successfully restored, still-retained snapshot may
// avoid the live source. Errors (including authorization failures), ordinary
// runtime stale cells, metrics and explicit refreshes keep their existing path.
// This is not used by cache-only explanation/revision APIs.
func serveStartupSnapshot[I any](ctx context.Context, priority WorkPriority, snap Snapshot[I], maxAge time.Duration) bool {
	return ctx.Err() == nil && priority == WorkPriorityCritical && workSourceOrAPI(ctx) == WorkSourceAPI &&
		snap.restored && snap.Err == nil && !snap.Meta.ObservedAt.IsZero() &&
		(maxAge <= 0 || time.Since(snap.Meta.ObservedAt) <= maxAge)
}

// Admission is bounded per exact context/kind/namespace, independently of the
// scheduler's in-flight coalescing: repeated reads must not spawn waiter
// goroutines while a slow client or LIST is in progress. The normal execution
// path owns publication, persistence, Pod epochs and Live ownership checks.
func (p *clusterPlane) refreshStartupSnapshot(ctx context.Context, sched *workScheduler, key workKey, refresh func(context.Context)) {
	if sched != nil && sched.BackgroundAdmission(p.name) == SchedulerBackgroundAdmissionPaused {
		return
	}
	p.startupRefreshMu.Lock()
	if p.startupRefreshes[key] {
		p.startupRefreshMu.Unlock()
		return
	}
	if p.startupRefreshes == nil {
		p.startupRefreshes = make(map[workKey]bool)
	}
	p.startupRefreshes[key] = true
	p.startupRefreshMu.Unlock()
	go func() {
		defer func() {
			p.startupRefreshMu.Lock()
			delete(p.startupRefreshes, key)
			p.startupRefreshMu.Unlock()
		}()
		refreshCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		refresh(refreshCtx)
	}()
}
