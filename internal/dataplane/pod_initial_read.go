package dataplane

import (
	"context"
	"time"
)

type podInitialReadKey struct{}
type podInitialRevalidationKey struct{}

// WithPodInitialRead marks the initial Pods list read, not an automatic,
// manual or revision refresh. Only this foreground intent may serve retained
// runtime rows while revalidating; cache-only consumers never use it.
func WithPodInitialRead(ctx context.Context) context.Context {
	return context.WithValue(ctx, podInitialReadKey{}, true)
}

func podInitialRevalidation(ctx context.Context) bool {
	value, _ := ctx.Value(podInitialRevalidationKey{}).(bool)
	return value
}

func servePodInitialSnapshot[I any](ctx context.Context, priority WorkPriority, snap Snapshot[I], maxAge time.Duration) bool {
	initial, _ := ctx.Value(podInitialReadKey{}).(bool)
	age := time.Since(snap.Meta.ObservedAt)
	return initial && !podManualRefresh(ctx) && ctx.Err() == nil && priority == WorkPriorityCritical &&
		workSourceOrAPI(ctx) == WorkSourceAPI && !snap.restored && snap.Err == nil &&
		!snap.Meta.ObservedAt.IsZero() && age >= 0 && maxAge > 0 && age <= maxAge &&
		snap.Meta.Coverage == CoverageClassFull && snap.Meta.Completeness == CompletenessClassComplete &&
		(snap.Meta.Freshness == FreshnessClassHot || snap.Meta.Freshness == FreshnessClassStale)
}
