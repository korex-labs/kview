package localhistory

import (
	"context"
	"crypto/rand"
	"errors"
	"time"
)

// PublicationTrendSource always owns the full exact-context Dashboard population.
// Events invalidate that population; they never restrict it to a namespace.
type PublicationTrendSource interface {
	SubscribeHistoryPublications(string, string) (*PublicationQueue, func(), error)
	HistoryPublicationBatch(context.Context, Publication, time.Time) TrendBatch
}

var ErrHistorySourceUnavailable = errors.New("history publication source unavailable")

func (v *Collector) bindPublications() error {
	if !v.config.Enabled || !v.config.SignalHistory || v.config.QueryContext == "" || v.config.SignalEpoch == "" {
		return nil
	}
	source := v.source
	if source == nil {
		return ErrHistorySourceUnavailable
	}
	q, release, err := source.SubscribeHistoryPublications(v.config.QueryContext, v.config.SignalEpoch)
	if err != nil {
		return errors.Join(ErrHistorySourceUnavailable, err)
	}
	if q == nil || release == nil {
		if release != nil {
			release()
		}
		return ErrHistorySourceUnavailable
	}
	v.publicationQueue, v.publicationRelease = q, release
	v.publicationSession = rand.Text()
	return nil
}

func (v *Collector) runPublications(ctx context.Context) {
	// Existing cache establishes a baseline, never a reconstructed incident.
	v.consumePublication(ctx, Publication{Context: v.config.QueryContext, Epoch: v.config.SignalEpoch})
	_ = v.publicationQueue.RunMaintenance(ctx, 10*time.Millisecond, v.consumePublication, func(ctx context.Context) {
		if ctx.Err() == nil {
			v.consumePublication(ctx, Publication{Context: v.config.QueryContext, Epoch: v.config.SignalEpoch, Kind: "canonical-maintenance"})
			v.record(time.Now().UTC(), 0, v.store.pruneTrends(time.Now().UTC()))
		}
	})
}
func (v *Collector) consumePublication(ctx context.Context, event Publication) {
	if ctx.Err() != nil || event.Context != v.config.QueryContext || event.Epoch != v.config.SignalEpoch {
		return
	}
	// One rebuild covers every currently dirty cell, not one rebuild per namespace.
	skipped := uint64(0)
	for {
		if _, ok := v.publicationQueue.pop(); !ok {
			break
		}
		skipped++
	}
	if skipped > 0 {
		v.publicationQueue.mu.Lock()
		v.publicationQueue.status.Coalesced += skipped
		v.publicationQueue.mu.Unlock()
	}
	at := time.Now().UTC()
	b := v.source.HistoryPublicationBatch(ctx, event, at)
	if ctx.Err() != nil {
		return
	}
	if b.Context != event.Context || b.Epoch != event.Epoch || !b.At.Equal(at) {
		v.record(at, 0, errors.New("publication identity mismatch"))
		return
	}
	status := v.publicationQueue.Status()
	if b.Diagnostics.Reasons == nil {
		b.Diagnostics.Reasons = map[string]int{}
	}
	// Counters are cumulative. Lost transitions never become complete just because
	// the queue subsequently drains; persisted changes coverage must stay honest.
	b.Diagnostics.Coalesced, b.Diagnostics.Overflow = status.Coalesced, status.Overflow
	if status.Coalesced > 0 {
		b.Diagnostics.Reasons["publication-coalesced"] = 1
	}
	if status.Overflow > 0 {
		b.Diagnostics.Reasons["publication-overflow"] = 1
	}
	// A process-local policy suffix rebases each domain independently on startup
	// (including domains first observed after startup). It never rotates consent's
	// durable identity and does not poison the next valid transition's baseline.
	b.Policy += "/" + v.publicationSession
	if event.Kind == "" {
		b.Diagnostics.Reasons["publication-baseline"] = 1
	}
	v.record(at, 0, v.store.AppendTrends(b))
}
