package server

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestKeyedRequestLocksDoNotBlockUnrelatedKeys(t *testing.T) {
	var locks keyedRequestLocks
	releaseA, err := locks.acquire(context.Background(), "pod-a")
	if err != nil {
		t.Fatalf("acquire pod-a: %v", err)
	}
	defer releaseA()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	releaseB, err := locks.acquire(ctx, "pod-b")
	if err != nil {
		t.Fatalf("unrelated pod-b was blocked: %v", err)
	}
	releaseB()
}

func TestKeyedRequestLocksWaitCancellationAndCleanup(t *testing.T) {
	var locks keyedRequestLocks
	release, err := locks.acquire(context.Background(), "same-request")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		waitingRelease, acquireErr := locks.acquire(ctx, "same-request")
		if waitingRelease != nil {
			waitingRelease()
		}
		result <- acquireErr
	}()
	cancel()
	select {
	case acquireErr := <-result:
		if !errors.Is(acquireErr, context.Canceled) {
			t.Fatalf("waiting acquire: got %v, want context canceled", acquireErr)
		}
	case <-time.After(time.Second):
		t.Fatal("waiting acquire ignored cancellation")
	}

	release()
	locks.mu.Lock()
	defer locks.mu.Unlock()
	if len(locks.entries) != 0 {
		t.Fatalf("lock entries leaked: %d", len(locks.entries))
	}
}
