package dataplane

import (
	"context"
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"time"
)

// HistoryPublicationBatch delegates to the canonical Dashboard population at the
// accepted observation time. Notifications trigger evaluation; their historical
// timestamps and scopes do not select or backdate the captured population.
func (m *manager) HistoryPublicationBatch(ctx context.Context, event localhistory.Publication, accepted time.Time) localhistory.TrendBatch {
	return m.canonicalHistoryBatch(ctx, event.Context, event.Epoch, accepted)
}

func historyPublishedMetadata[I any](s Snapshot[I]) (SnapshotMetadata, bool) {
	return s.Meta, !s.restored && s.Err == nil && !s.Meta.ObservedAt.IsZero() && s.Meta.Coverage == CoverageClassFull && s.Meta.Completeness == CompletenessClassComplete && s.Meta.Freshness == FreshnessClassHot && s.Meta.Degradation == DegradationClassNone
}
