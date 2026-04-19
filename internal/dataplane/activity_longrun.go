package dataplane

import (
	"context"
	"fmt"
	"time"

	"github.com/korex-labs/kview/internal/runtime"
)

const dataplaneSnapshotActivityTTL = 3 * time.Minute

// newDataplaneLongRunRecorder registers completed snapshot runs that held a scheduler slot for at least the configured threshold.
func newDataplaneLongRunRecorder(reg runtime.ActivityRegistry) func(workKey, WorkPriority, time.Duration, error) {
	if reg == nil {
		return nil
	}
	return func(key workKey, prio WorkPriority, d time.Duration, err error) {
		id := fmt.Sprintf("snap-%s-%s-%s-%d", key.Cluster, key.Kind, key.Namespace, time.Now().UnixNano())
		now := time.Now().UTC()
		start := now.Add(-d)
		st := runtime.ActivityStatusStopped
		if err != nil {
			st = runtime.ActivityStatusFailed
		}
		title := fmt.Sprintf("Snapshot %s · %s", key.Cluster, key.Kind)
		if key.Namespace != "" {
			title = fmt.Sprintf("%s · ns=%s", title, key.Namespace)
		}
		outcome := "ok"
		if err != nil {
			outcome = err.Error()
			if len(outcome) > 240 {
				outcome = outcome[:240] + "…"
			}
		}
		a := runtime.Activity{
			ID:           id,
			Kind:         runtime.ActivityKindWorker,
			Type:         runtime.ActivityTypeDataplaneSnapshot,
			Title:        title,
			Status:       st,
			CreatedAt:    start,
			UpdatedAt:    now,
			StartedAt:    start,
			ResourceType: fmt.Sprintf("snapshot:%s", key.Kind),
			Metadata: map[string]string{
				"cluster":   key.Cluster,
				"namespace": key.Namespace,
				"kind":      string(key.Kind),
				"priority":  prio.String(),
				"class":     string(key.Class),
				"outcome":   outcome,
			},
		}
		_ = reg.Register(context.Background(), a)
		runtime.ScheduleActivityTTLRemoval(reg, id, a.UpdatedAt, dataplaneSnapshotActivityTTL)
	}
}
