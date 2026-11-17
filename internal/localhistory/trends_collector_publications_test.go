package localhistory

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

type publicationCollectorSource struct {
	mu         sync.Mutex
	namespaces []string
	active     map[string]bool
	revision   map[string]uint64
	q          *PublicationQueue
	subscribed int
	calls      chan []Scope
	entered    chan struct{}
	// Fanout-only fixtures measure admission, not quadratic retained-state rewrites.
	noDomains bool
}

func (s *publicationCollectorSource) SubscribeHistoryPublications(name, epoch string) (*PublicationQueue, func(), error) {
	s.subscribed++
	q, err := NewPublicationQueue(name, epoch, 2048)
	s.q = q
	return q, func() { q.Close() }, err
}
func (s *publicationCollectorSource) HistoryPublicationBatch(ctx context.Context, e Publication, at time.Time) TrendBatch {
	if s.entered != nil && e.Kind != "" {
		close(s.entered)
		<-ctx.Done()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b := TrendBatch{Context: e.Context, Epoch: e.Epoch, Policy: "synthetic-policy", At: at, Diagnostics: TrendDiagnostics{Reasons: map[string]int{}, SupportedRules: []string{"synthetic-rule"}}}
	scopes := make([]Scope, 0, len(s.namespaces))
	for _, ns := range s.namespaces {
		scope := Scope{Context: e.Context, Namespace: ns}
		scopes = append(scopes, scope)
		if s.noDomains {
			continue
		}
		d := TrendDomain{Namespace: scope.Namespace, Rule: "synthetic-rule", SourceAt: at, Generation: fmt.Sprint(s.revision[scope.Namespace]), Complete: true}
		if s.active[scope.Namespace] {
			d.Signals = []TrendSignal{{ID: scope.Namespace + "-signal", Severity: "high", IdentityKnown: true}}
		}
		b.Domains = append(b.Domains, d)
	}
	if s.calls != nil {
		s.calls <- append([]Scope(nil), scopes...)
	}
	return b
}
func newPublicationCollectorTest(t *testing.T, s *publicationCollectorSource) *Collector {
	t.Helper()
	store, _ := trendStore(t, 30)
	ctx, cancel := context.WithCancel(context.Background())
	c := &Collector{store: store, source: s, config: Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic-a", SignalEpoch: "epoch"}, cancel: cancel, done: make(chan struct{})}
	if err := c.bindPublications(); err != nil {
		t.Fatal(err)
	}
	go func() { defer close(c.done); defer c.publicationRelease(); c.runPublications(ctx) }()
	t.Cleanup(c.Close)
	return c
}
func waitPublicationCollection(t *testing.T, c *Collector, predicate func(TrendResponse) bool) TrendResponse {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		now := time.Now().UTC()
		out, err := c.QueryTrends(TrendQuery{Context: "synthetic-a", From: now.Truncate(time.Hour), To: now.Truncate(time.Hour).Add(time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		if predicate(out) {
			return out
		}
		select {
		case <-deadline.C:
			t.Fatalf("publication not persisted: %+v / %+v", out, c.Status())
		case <-tick.C:
		}
	}
}
func publicationHigh(out TrendResponse) int {
	if len(out.Severity) == 0 || len(out.Severity[0].Points) == 0 || out.Severity[0].Points[0].Counts == nil {
		return -1
	}
	return out.Severity[0].Points[0].Counts.High
}
func publicationChanges(out TrendResponse) int {
	if len(out.Severity) == 0 || len(out.Severity[0].Points) == 0 {
		return -1
	}
	return out.Severity[0].Points[0].ConfirmedChanges
}
func TestPublicationCollectorCapturesBeforePollAndIndependentBaseline(t *testing.T) {
	s := &publicationCollectorSource{namespaces: []string{"alpha", "beta"}, active: map[string]bool{}, revision: map[string]uint64{}}
	c := newPublicationCollectorTest(t, s)
	waitPublicationCollection(t, c, func(out TrendResponse) bool { return publicationHigh(out) == 0 })
	for i, ns := range s.namespaces {
		s.mu.Lock()
		s.active[ns] = true
		s.revision[ns]++
		s.mu.Unlock()
		s.q.Enqueue(Publication{Context: "synthetic-a", Namespace: ns, Kind: "pods", Revision: 1, ObservedAt: time.Now().UTC()})
		waitPublicationCollection(t, c, func(out TrendResponse) bool { return publicationHigh(out) == i+1 && publicationChanges(out) == i+1 })
	}
	if c.Status().LastError != "" {
		t.Fatal(c.Status())
	}
}
func TestPublicationCollectorFullPopulationBeyondOldScopeCap(t *testing.T) {
	s := &publicationCollectorSource{active: map[string]bool{}, revision: map[string]uint64{}, calls: make(chan []Scope, 4096), noDomains: true}
	for i := 0; i < TrendMaxScopes+17; i++ {
		s.namespaces = append(s.namespaces, fmt.Sprintf("ns-%04d", i))
	}
	c := newPublicationCollectorTest(t, s)
	seen := map[string]bool{}
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()
	for len(seen) < len(s.namespaces) {
		select {
		case scopes := <-s.calls:
			if len(scopes) != len(s.namespaces) {
				t.Fatal("population filtered", len(scopes))
			}
			for _, scope := range scopes {
				seen[scope.Namespace] = true
			}
		case <-timeout.C:
			t.Fatal("scope-prefix starvation", len(seen), len(s.namespaces))
		}
	}
	c.Close()
}
func TestPublicationCollectorDisabledConsentNeverSubscribes(t *testing.T) {
	for _, cfg := range []Config{{}, {Enabled: true}, {Enabled: true, SignalHistory: true, QueryContext: "synthetic-a"}} {
		s := &publicationCollectorSource{}
		c := &Collector{source: s, config: cfg}
		if err := c.bindPublications(); err != nil || s.subscribed != 0 || c.publicationQueue != nil {
			t.Fatal("implicit subscription", err)
		}
	}
}
func TestPublicationCollectorShutdownCancelsJoinAndRejectsLateEvents(t *testing.T) {
	s := &publicationCollectorSource{namespaces: []string{"alpha"}, active: map[string]bool{}, revision: map[string]uint64{}, entered: make(chan struct{})}
	c := newPublicationCollectorTest(t, s)
	waitPublicationCollection(t, c, func(out TrendResponse) bool { return publicationHigh(out) == 0 })
	s.q.Enqueue(Publication{Context: "synthetic-a", Namespace: "alpha", Kind: "pods", Revision: 1, ObservedAt: time.Now().UTC()})
	select {
	case <-s.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("worker not entered")
	}
	done := make(chan struct{})
	go func() { c.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not cancel and join")
	}
	if s.q.Enqueue(Publication{Context: "synthetic-a", Namespace: "alpha", Kind: "pods", Revision: 2, ObservedAt: time.Now().UTC()}) {
		t.Fatal("late event accepted")
	}
}
func TestPublicationCollectorQueueLossDegradesChangesCoverage(t *testing.T) {
	s := &publicationCollectorSource{namespaces: []string{"alpha"}, active: map[string]bool{}, revision: map[string]uint64{}}
	store, _ := trendStore(t, 30)
	c := &Collector{store: store, source: s, config: Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic-a", SignalEpoch: "epoch"}}
	if err := c.bindPublications(); err != nil {
		t.Fatal(err)
	}
	defer c.publicationRelease()
	// Synchronous adapter invocation isolates deterministic queue loss from timing.
	c.consumePublication(context.Background(), Publication{Context: "synthetic-a", Epoch: "epoch"})
	q, _ := NewPublicationQueue("synthetic-a", "epoch", 1)
	c.publicationQueue = q
	at := time.Now().UTC()
	e := Publication{Context: "synthetic-a", Epoch: "epoch", Namespace: "alpha", Kind: "pods", Revision: 1, ObservedAt: at}
	q.Enqueue(e)
	e.Revision++
	q.Enqueue(e)
	overflow := e
	overflow.Namespace = "beta"
	q.Enqueue(overflow)
	s.active["alpha"] = true
	s.revision["alpha"] = 2
	c.consumePublication(context.Background(), e)
	out := waitPublicationCollection(t, c, func(out TrendResponse) bool { return publicationHigh(out) == 1 })
	if out.Diagnostics.Coalesced != 2 || out.Diagnostics.Overflow != 1 || out.Severity[0].Points[0].ChangesCoverage == "complete" {
		t.Fatal("loss presented as complete", out)
	}
}
