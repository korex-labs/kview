package localhistory

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func publicationFixture(ns, kind string, revision uint64) Publication {
	return Publication{Context: "synthetic", Namespace: ns, Kind: kind, Revision: revision, ObservedAt: time.Unix(1700000000, 0)}
}
func publicationQueue(t *testing.T, capacity int) *PublicationQueue {
	t.Helper()
	q, err := NewPublicationQueue("synthetic", "epoch-a", capacity)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(q.Close)
	return q
}
func TestPublicationQueueCoalescesCellsNotNamespaces(t *testing.T) {
	q := publicationQueue(t, 3)
	for _, p := range []Publication{publicationFixture("ns", "pods", 1), publicationFixture("ns", "services", 1), publicationFixture("", "nodes", 1), publicationFixture("ns", "pods", 2)} {
		if !q.Enqueue(p) {
			t.Fatal("rejected", p)
		}
	}
	if q.Enqueue(publicationFixture("ns", "pods", 1)) {
		t.Fatal("old revision")
	}
	for _, want := range []Publication{publicationFixture("ns", "pods", 2), publicationFixture("ns", "services", 1), publicationFixture("", "nodes", 1)} {
		got, ok := q.pop()
		if !ok || got.Kind != want.Kind || got.Revision != want.Revision || got.Epoch != "epoch-a" || !got.ObservedAt.Equal(want.ObservedAt) {
			t.Fatalf("got %+v, want %+v", got, want)
		}
		if q.Enqueue(want) {
			t.Fatal("replayed popped revision")
		}
	}
	if s := q.Status(); s.Pending != 0 || s.Coalesced != 1 || s.Overflow != 0 {
		t.Fatal(s)
	}
}
func TestPublicationQueueOverflowAndBoundedReplay(t *testing.T) {
	q := publicationQueue(t, 2)
	q.Enqueue(publicationFixture("a", "pods", 1))
	q.Enqueue(publicationFixture("b", "pods", 1))
	if q.Enqueue(publicationFixture("c", "pods", 1)) || q.Status().Overflow != 1 {
		t.Fatal(q.Status())
	}
	q.pop()
	if !q.Enqueue(publicationFixture("c", "pods", 1)) {
		t.Fatal("new cell starved after draining")
	}
	q.pop()
	q.pop()
	if len(q.seen) > 2 || q.recent.Len() > 2 {
		t.Fatal("unbounded replay tracking")
	}
	// Old replay eviction is intentional; durable generation dedup is separate.
	if !q.Enqueue(publicationFixture("a", "pods", 1)) {
		t.Fatal("expected bounded replay eviction")
	}
}
func TestPublicationQueueIdentityAndClose(t *testing.T) {
	for _, args := range []struct {
		name, epoch string
		cap         int
	}{{"", "epoch", 1}, {"synthetic", "", 1}, {"synthetic", "epoch", 0}, {"synthetic", "epoch", 32769}} {
		if _, err := NewPublicationQueue(args.name, args.epoch, args.cap); err == nil {
			t.Fatal(args)
		}
	}
	q := publicationQueue(t, 2)
	p := publicationFixture("ns", "pods", 1)
	p.Context = "other"
	if q.Enqueue(p) {
		t.Fatal("cross context")
	}
	p.Context = "synthetic"
	p.Revision = 0
	if q.Enqueue(p) {
		t.Fatal("zero revision")
	}
	q.Close()
	q.Close()
	if q.Enqueue(publicationFixture("ns", "pods", 1)) || !q.Status().Closed {
		t.Fatal("closed queue accepted work")
	}
}
func TestPublicationWorkerSlowConsumer595NamespacesAndCancellation(t *testing.T) {
	q := publicationQueue(t, 1024)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	got := make(chan Publication, 600)
	go func() {
		done <- q.Run(ctx, time.Millisecond, func(ctx context.Context, p Publication) {
			if p.Namespace == "ns-000" {
				close(entered)
				select {
				case <-release:
				case <-ctx.Done():
					return
				}
			}
			got <- p
		})
	}()
	q.Enqueue(publicationFixture("ns-000", "pods", 1))
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not start")
	}
	for i := 1; i < 595; i++ {
		if !q.Enqueue(publicationFixture(fmt.Sprintf("ns-%03d", i), "pods", 1)) {
			t.Fatal("enqueue blocked/lost", i)
		}
	}
	// Repeated hot-source updates retain FIFO order and do not erase other cells.
	for i := uint64(2); i < 200; i++ {
		q.Enqueue(publicationFixture("ns-001", "pods", i))
	}
	if s := q.Status(); s.Pending != 594 || s.Overflow != 0 {
		t.Fatal(s)
	}
	close(release)
	for i := 0; i < 595; i++ {
		select {
		case p := <-got:
			if p.Namespace != fmt.Sprintf("ns-%03d", i) {
				t.Fatal("not FIFO", i, p)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("starved", i)
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not join")
	}
	if !q.Status().Closed {
		t.Fatal("cancellation left subscription open")
	}
}
func TestPublicationWorkerCloseCancelsInFlightAndRacesPublishers(t *testing.T) {
	q := publicationQueue(t, 16)
	entered := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- q.Run(context.Background(), time.Millisecond, func(ctx context.Context, _ Publication) { close(entered); <-ctx.Done() })
	}()
	q.Enqueue(publicationFixture("ns", "pods", 1))
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not start")
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := uint64(2); j < 1000; j++ {
				q.Enqueue(publicationFixture("ns", "pods", j))
				q.Status()
			}
		}()
	}
	q.Close()
	wg.Wait()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("close did not cancel consumer")
	}
	if err := q.Run(context.Background(), time.Millisecond, func(context.Context, Publication) {}); err == nil {
		t.Fatal("second worker allowed")
	}
	if s := q.Status(); s.Pending != 0 || !s.Closed {
		t.Fatal(s)
	}
}
