package dataplane

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
)

const (
	// Separate from the authoritative Pods key: an optional source never owns
	// or coalesces with a foreground Pods LIST. Admission bounds waiter goroutines
	// as well as requests, including when the scheduler has no free slots.
	resourceKindPodEvents ResourceKind = "podevents"
	podEventsMaxJobs                   = 4
	podEventsTimeout                   = 30 * time.Second
)

// podEventsLifecycle serializes admission/publication with manager shutdown.
// Lock order: podPublishMu -> lifecycle.mu. Shutdown releases lifecycle.mu before
// taking any manager/plane locks; this lock never calls back into those locks.
// The zero value is usable by managers constructed directly in tests.
type podEventsLifecycle struct {
	mu     sync.Mutex
	ctx    context.Context
	cancel context.CancelFunc
	closed bool
}

func (l *podEventsLifecycle) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	if l.cancel != nil {
		l.cancel()
	}
}

// Keep request-scoped attribution values, but inherit cancellation exclusively
// from the manager (plus the per-job timeout and Live takeover).
type podEventsContext struct {
	context.Context
	values context.Context
}

func (c podEventsContext) Value(key any) any {
	// Preserve the cancellation parent's internal values so child cancellation
	// propagates synchronously rather than through a bridge goroutine.
	if value := c.Context.Value(key); value != nil {
		return value
	}
	return c.values.Value(key)
}

// refreshPodEventsLocked is called under podPublishMu after a successful source
// publication. Cache-only reads and failed Pods reads cannot initiate work.
// One attempt per source publication; denied Events are not retried on cache hits.
func (p *clusterPlane) refreshPodEventsLocked(ctx context.Context, sched *workScheduler, clients ClientsProvider, ns string) {
	// Standalone planes have no manager-owned background lifecycle.
	l := p.podEventsLifecycle
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	if l.ctx == nil {
		l.ctx, l.cancel = context.WithCancel(context.Background())
	}
	if ctx.Err() != nil || clients == nil || sched == nil || p.podLive[ns] != nil || p.podEventsJobs[ns] != nil || len(p.podEventsJobs) >= podEventsMaxJobs {
		return
	}
	if sched.BackgroundAdmission(p.name) == SchedulerBackgroundAdmissionPaused {
		return
	}
	snap, ok := p.podsStore.getCached(ns)
	if !ok || snap.Err != nil || snap.restored {
		return
	}
	targets := make(map[kubeevents.ObjectIdentity]struct{}, len(snap.Items))
	for _, row := range snap.Items {
		if row.Namespace == ns && row.Name != "" && row.UID != "" {
			targets[podEventIdentity(row)] = struct{}{}
		}
	}
	if len(targets) == 0 {
		return
	}
	epoch := p.podEpoch[ns]
	// The response ending is not cancellation of admitted cache-owned work.
	// Deadline, Live takeover and shutdown bound its independent lifetime.
	refreshCtx, cancel := context.WithTimeout(ContextWithWorkSource(podEventsContext{Context: l.ctx, values: context.WithoutCancel(ctx)}, WorkSourceEnrichment), podEventsTimeout)
	if p.podEventsJobs == nil {
		p.podEventsJobs = make(map[string]context.CancelFunc)
	}
	p.podEventsJobs[ns] = cancel
	go func() {
		defer func() {
			cancel()
			p.podPublishMu.Lock()
			delete(p.podEventsJobs, ns)
			p.podPublishMu.Unlock()
		}()
		var latest map[kubeevents.ObjectIdentity]dto.EventBriefDTO
		var observed time.Time
		err := sched.Run(refreshCtx, WorkPriorityLow, workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: resourceKindPodEvents, Namespace: ns}, func(runCtx context.Context) error {
			if err := runCtx.Err(); err != nil {
				return err
			}
			c, active, err := clients.GetClientsForContext(runCtx, p.name)
			if err != nil {
				return err
			}
			if active != p.name || c == nil || c.Clientset == nil {
				return errors.New("pod Events context mismatch or unavailable client")
			}
			if err := runCtx.Err(); err != nil {
				return err
			}
			if p.stats != nil {
				p.stats.recordFetchAttempt(WorkSourceEnrichment, resourceKindPodEvents)
			}
			latest, err = kubeevents.LatestEventsByObjectIdentity(runCtx, c, ns, "Pod")
			p.capRegistry.LearnReadResult(p.name, "", "events", ns, "list", CapabilityScopeNamespace, err)
			if p.stats != nil {
				p.stats.recordFetchResult(WorkSourceEnrichment, resourceKindPodEvents, estimateSnapshotPayloadBytes(latest), err)
			}
			if err == nil && runCtx.Err() != nil {
				return runCtx.Err()
			}
			if err == nil {
				observed = time.Now().UTC()
			}
			return err
		})
		// Failure is unknown optional evidence, never an invented empty success or
		// a Pod error. A scheduler follower also has no locally observed result.
		if err != nil || observed.IsZero() || refreshCtx.Err() != nil {
			return
		}
		p.podPublishMu.Lock()
		defer p.podPublishMu.Unlock()
		l.mu.Lock()
		defer l.mu.Unlock()
		if refreshCtx.Err() != nil || l.closed || p.podEpoch[ns] != epoch || p.podLive[ns] != nil {
			return
		}
		current, ok := p.podsStore.getCached(ns)
		if !ok || current.Err != nil || current.restored {
			return
		}
		// Never mutate an item slice already handed to HTTP/cached readers. Merge
		// only into surviving exact UIDs, preserving newer Pod rows and metadata.
		rows := append([]dto.PodListItemDTO(nil), current.Items...)
		changed := false
		for i := range rows {
			key := podEventIdentity(rows[i])
			if _, ok := targets[key]; !ok {
				continue
			}
			rows[i].LastEvent = nil
			if event, ok := latest[key]; ok {
				eventCopy := event
				rows[i].LastEvent = &eventCopy
			}
			rows[i].EventsObservedAt = observed.Unix()
			changed = true
		}
		if !changed {
			return
		}
		current.Items = rows
		// Revision changes, but Pod ObservedAt/freshness and relationships do not.
		setNamespacedSnapshot(&p.podsStore, ns, current)
		if sp := p.currentPersistence(); sp != nil {
			current, _ = p.podsStore.getCached(ns)
			_ = sp.Save(p.name, ResourceKindPods, ns, current)
		}
	}()
}

func podEventIdentity(row dto.PodListItemDTO) kubeevents.ObjectIdentity {
	return kubeevents.ObjectIdentity{Namespace: row.Namespace, Name: row.Name, UID: row.UID}
}
