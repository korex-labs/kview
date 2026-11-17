package localhistory

import (
	"context"
	"testing"
	"testing/synctest"
	"time"
)

func TestPublicationMaintenanceNeverEvaluatesWithoutPublication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		q, err := NewPublicationQueue("synthetic", "epoch", 2)
		if err != nil {
			t.Fatal(err)
		}
		evaluations, maintenance := 0, 0
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			done <- q.RunMaintenance(ctx, time.Millisecond, func(context.Context, Publication) { evaluations++ }, func(context.Context) { maintenance++ })
		}()
		synctest.Wait()
		time.Sleep(time.Duration(SampleSeconds) * time.Second)
		synctest.Wait()
		if evaluations != 0 || maintenance != 1 {
			t.Fatal(evaluations, maintenance)
		}
		cancel()
		synctest.Wait()
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})
}
