package localhistory

import (
	"context"
	"testing"
)

func TestTrendsCollectorRequiresPublicationProvider(t *testing.T) {
	c := &Collector{config: Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a"}}
	if err := c.bindPublications(); err == nil {
		t.Fatal("missing publication provider accepted")
	}
	if c, err := StartManaged(context.Background(), Config{Enabled: true, SignalHistory: true, SignalEpoch: "epoch", QueryContext: "synthetic-a", Directory: t.TempDir(), RetentionDays: 30}, nil); err == nil || c != nil {
		t.Fatal("missing provider started", err)
	}
}
