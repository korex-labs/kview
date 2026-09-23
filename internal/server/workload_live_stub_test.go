package server

import (
	"context"
	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func (*stubDataplane) SubscribeResourceLive(context.Context, string, string, dataplane.ResourceKind) (dataplane.ResourceLiveSubscription, error) {
	return nil, dataplane.ErrPodLiveUnavailable
}
func (*stubDataplane) CachedResourceSnapshot(string, string, dataplane.ResourceKind) (dataplane.ResourceLiveSnapshot, bool) {
	return dataplane.ResourceLiveSnapshot{}, false
}
func (*stubDataplane) InvalidateReplicaSetsSnapshot(context.Context, string, string) error {
	return nil
}
func (*stubDataplane) InvalidateCronJobsSnapshot(context.Context, string, string) error { return nil }
