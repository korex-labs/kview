package localhistory

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Deterministically cancel at a cooperative checkpoint, without timing sleeps.
type trendCheckpointContext struct {
	context.Context
	cancel    context.CancelFunc
	remaining int
}

func (c *trendCheckpointContext) Err() error {
	c.remaining--
	if c.remaining <= 0 {
		c.cancel()
	}
	return c.Context.Err()
}

func TestTrendsQueryCancellationAndCompatibility(t *testing.T) {
	s, _ := trendStore(t, 30)
	if err := s.AppendTrends(trendFixture(epoch, TrendSignal{ID: "one", Severity: "high", IdentityKnown: true})); err != nil {
		t.Fatal(err)
	}
	q := TrendQuery{Context: "synthetic-a", From: epoch.Truncate(time.Hour), To: epoch.Truncate(time.Hour).Add(24 * time.Hour)}
	baseline, err := s.QueryTrends(q)
	if err != nil {
		t.Fatal(err)
	}
	// Exercise cancellation during transaction scan, projection/catalog and point expansion.
	for _, checkpoint := range []int{1, 2, 4, 9, 20, 40} {
		ctx, cancel := context.WithCancel(context.Background())
		bounded := &trendCheckpointContext{Context: ctx, cancel: cancel, remaining: checkpoint}
		_, err := s.QueryTrendsContext(bounded, q)
		cancel()
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("checkpoint %d: %v", checkpoint, err)
		}
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if _, err := s.QueryTrendsContext(ctx, q); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	after, err := s.QueryTrends(q)
	if err != nil || len(after.Severity[0].Points) != len(baseline.Severity[0].Points) || after.Severity[0].Points[0].Counts.High != 1 {
		t.Fatal("cancel damaged readback", after, err)
	}
	c := &Collector{store: s, config: Config{Enabled: true, SignalHistory: true, QueryContext: q.Context}}
	if _, err := c.QueryTrendsContext(ctx, q); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("collector lost context", err)
	}
}
