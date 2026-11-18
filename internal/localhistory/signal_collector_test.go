package localhistory

import (
	"context"
	"testing"
	"time"
)

type invalidPublicationSource struct {
	*publicationCollectorSource
	mode string
}

func (s *invalidPublicationSource) HistoryPublicationBatch(ctx context.Context, e Publication, at time.Time) TrendBatch {
	b := s.publicationCollectorSource.HistoryPublicationBatch(ctx, e, at)
	switch s.mode {
	case "context":
		b.Context += "-other"
	case "epoch":
		b.Epoch += "-other"
	case "time":
		b.At = b.At.Add(time.Second)
	}
	return b
}
func TestPublicationCollectorRejectsMismatchedIdentity(t *testing.T) {
	for _, mode := range []string{"context", "epoch", "time", "cancelled"} {
		t.Run(mode, func(t *testing.T) {
			store, _ := trendStore(t, 30)
			t.Cleanup(func() {
				if err := store.Close(); err != nil {
					t.Error(err)
				}
			})
			source := &invalidPublicationSource{publicationCollectorSource: &publicationCollectorSource{namespaces: []string{"alpha"}, active: map[string]bool{}, revision: map[string]uint64{}}, mode: mode}
			c := &Collector{store: store, source: source, config: Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a"}}
			if err := c.bindPublications(); err != nil {
				t.Fatal(err)
			}
			defer c.publicationRelease()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			c.consumePublication(ctx, Publication{Context: "synthetic-a", Epoch: "epoch"})
			if !c.Status().LastSuccess.IsZero() {
				t.Fatal("invalid publication committed")
			}
			if mode != "cancelled" && c.Status().LastError == "" {
				t.Fatal("rejection hidden")
			}
			if c.SignalsEnabled("synthetic-ab") {
				t.Fatal("context prefix accepted")
			}
		})
	}
}
