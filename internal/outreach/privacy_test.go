package outreach

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestRollbackVersionReportsAgain(t *testing.T) {
	calls := 0
	c := testClient(t, func(*http.Request) (*http.Response, error) { calls++; return response(204, ""), nil })
	for _, version := range []string{"v5.2.1", "v5.2.2", "v5.2.1", "v5.2.1"} {
		if err := c.Send(context.Background(), version); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 3 {
		t.Fatalf("rollback must send once, got %d", calls)
	}
}

func TestCanceledConsentDoesNotCreateIdentity(t *testing.T) {
	c := testClient(t, func(*http.Request) (*http.Response, error) { t.Fatal("canceled request sent"); return nil, nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if c.Send(ctx, "v5.2.1") == nil {
		t.Fatal("expected cancellation")
	}
	if _, err := os.Stat(c.path); !os.IsNotExist(err) {
		t.Fatal("canceled request created identity")
	}
}

func TestQueuedCanceledRequestDoesNotSend(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	calls := 0
	c := testClient(t, func(*http.Request) (*http.Response, error) {
		calls++
		close(started)
		<-release
		return response(204, ""), nil
	})
	first := make(chan error, 1)
	go func() { first <- c.Send(context.Background(), "v5.2.1") }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	second := make(chan error, 1)
	go func() { second <- c.Send(ctx, "v5.2.2") }()
	cancel()
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-second:
		if err == nil {
			t.Fatal("expected cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("queued request stuck")
	}
	if calls != 1 {
		t.Fatal(calls)
	}
}
