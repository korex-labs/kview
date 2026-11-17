package localhistory

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// Publication is a dirty source cell, not a snapshot or evidence of health.
// Epoch is bound by the subscription, never supplied by a source writer.
// Consumers must evaluate all dependent domains and preserve unrelated domains.
type Publication struct {
	Context    string
	Epoch      string
	Namespace  string
	Kind       string
	Revision   uint64
	ObservedAt time.Time
}
type publicationKey struct{ namespace, kind string }
type PublicationQueueStatus struct {
	Pending   int    `json:"pending"`
	Coalesced uint64 `json:"coalesced"`
	Overflow  uint64 `json:"overflow"`
	Closed    bool   `json:"closed"`
}

// PublicationQueue bounds both dirty cells and replay tracking. It retains no
// Kubernetes objects. Enqueue never invokes consumer code or waits for work.
// Replay tracking is a bounded LRU; durable domain-generation dedup remains the
// collector's responsibility, especially after eviction, overflow or restart.
type PublicationQueue struct {
	mu             sync.Mutex
	context, epoch string
	capacity       int
	pending        map[publicationKey]*list.Element
	order          list.List
	seen           map[publicationKey]*list.Element
	recent         list.List
	status         PublicationQueueStatus
	wake           chan struct{}
	stop           chan struct{}
	cancel         context.CancelFunc
	running        atomic.Bool
}

func NewPublicationQueue(contextName, epoch string, capacity int) (*PublicationQueue, error) {
	if ValidateScope(Scope{Context: contextName}) != nil || epoch == "" || len(epoch) > 128 || capacity < 1 || capacity > 32768 {
		return nil, errors.New("invalid publication subscription")
	}
	return &PublicationQueue{context: contextName, epoch: epoch, capacity: capacity, pending: make(map[publicationKey]*list.Element), seen: make(map[publicationKey]*list.Element), wake: make(chan struct{}, 1), stop: make(chan struct{})}, nil
}
func publicationCell(p Publication) publicationKey { return publicationKey{p.Namespace, p.Kind} }
func (q *PublicationQueue) signal() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}
func (q *PublicationQueue) Enqueue(p Publication) bool {
	if p.Context != q.context || p.Kind == "" || len(p.Kind) > 128 || p.Revision == 0 || p.ObservedAt.IsZero() || ValidateScope(Scope{Context: p.Context, Namespace: p.Namespace}) != nil {
		return false
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.status.Closed {
		return false
	}
	p.Epoch = q.epoch
	key := publicationCell(p)
	if e := q.pending[key]; e != nil {
		if p.Revision <= e.Value.(Publication).Revision {
			return false
		}
		e.Value = p
		q.status.Coalesced++
		return true
	}
	if e := q.seen[key]; e != nil && p.Revision <= e.Value.(Publication).Revision {
		return false
	}
	if len(q.pending) >= q.capacity {
		q.status.Overflow++
		return false
	}
	q.pending[key] = q.order.PushBack(p)
	q.signal()
	return true
}
func (q *PublicationQueue) pop() (Publication, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.status.Closed || q.order.Len() == 0 {
		return Publication{}, false
	}
	e := q.order.Front()
	p := e.Value.(Publication)
	key := publicationCell(p)
	q.order.Remove(e)
	delete(q.pending, key)
	if prior := q.seen[key]; prior != nil {
		q.recent.Remove(prior)
	}
	q.seen[key] = q.recent.PushBack(p)
	if q.recent.Len() > q.capacity {
		old := q.recent.Front()
		delete(q.seen, publicationCell(old.Value.(Publication)))
		q.recent.Remove(old)
	}
	return p, true
}
func (q *PublicationQueue) Status() PublicationQueueStatus {
	q.mu.Lock()
	defer q.mu.Unlock()
	s := q.status
	s.Pending = len(q.pending)
	return s
}

// Close revokes consent for this queue and cancels the running callback context.
// The lifecycle owner must join Run before closing its storage handle.
func (q *PublicationQueue) Close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.status.Closed {
		return
	}
	q.status.Closed = true
	close(q.stop)
	if q.cancel != nil {
		q.cancel()
	}
	clear(q.pending)
	clear(q.seen)
	q.order.Init()
	q.recent.Init()
}

// Run is a single-use serial worker. A fixed debounce cannot be extended by a
// hot cell. At most 32 cells run per turn, then another debounce yields the CPU.
// Slow consumers cannot block publishers or erase other dirty dependencies.
func (q *PublicationQueue) Run(parent context.Context, debounce time.Duration, consume func(context.Context, Publication)) error {
	return q.RunMaintenance(parent, debounce, consume, nil)
}

// RunMaintenance keeps maintenance and ingestion on the same serial worker.
func (q *PublicationQueue) RunMaintenance(parent context.Context, debounce time.Duration, consume func(context.Context, Publication), maintain func(context.Context)) error {
	if debounce < time.Millisecond || debounce > 250*time.Millisecond || consume == nil {
		return errors.New("invalid publication worker")
	}
	if !q.running.CompareAndSwap(false, true) {
		return errors.New("publication worker already started")
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer q.Close()
	q.mu.Lock()
	q.cancel = cancel
	closed := q.status.Closed
	q.mu.Unlock()
	if closed {
		return nil
	}
	ticker := time.NewTicker(SampleSeconds * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if maintain != nil {
				maintain(ctx)
			}
			continue
		case <-ctx.Done():
			return nil
		case <-q.stop:
			return nil
		case <-q.wake:
		}
		timer := time.NewTimer(debounce)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-q.stop:
			timer.Stop()
			return nil
		case <-timer.C:
		}
		for i := 0; i < 32; i++ {
			if ctx.Err() != nil {
				return nil
			}
			p, ok := q.pop()
			if !ok {
				break
			}
			consume(ctx, p)
		}
		if q.Status().Pending > 0 {
			q.signal()
		}
	}
}
