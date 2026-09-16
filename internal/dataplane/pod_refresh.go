package dataplane

import "context"

type podManualRefreshKey struct{}

// WithPodManualRefresh marks an explicit foreground refresh of the requested
// context/namespace pod cell. Only PodsSnapshot consumes it; scheduler admission,
// deduplication and authorization remain unchanged.
func WithPodManualRefresh(ctx context.Context) context.Context {
	return context.WithValue(ctx, podManualRefreshKey{}, true)
}

func podManualRefresh(ctx context.Context) bool {
	value, _ := ctx.Value(podManualRefreshKey{}).(bool)
	return value
}
