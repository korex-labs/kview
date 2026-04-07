package dataplane

import (
	"container/heap"
	"context"
	"sync"
	"time"
)

// WorkClass represents a broad scheduler work category.
type WorkClass string

const (
	WorkClassSnapshot WorkClass = "snapshot"
)

// ResourceKind identifies scheduler work keys for dataplane snapshots.
type ResourceKind string

const (
	ResourceKindNamespaces      ResourceKind = "namespaces"
	ResourceKindPods            ResourceKind = "pods"
	ResourceKindDeployments     ResourceKind = "deployments"
	ResourceKindNodes           ResourceKind = "nodes"
	ResourceKindServices        ResourceKind = "services"
	ResourceKindIngresses       ResourceKind = "ingresses"
	ResourceKindPVCs            ResourceKind = "persistentvolumeclaims"
	ResourceKindConfigMaps      ResourceKind = "configmaps"
	ResourceKindSecrets         ResourceKind = "secrets"
	ResourceKindServiceAccounts ResourceKind = "serviceaccounts"
	ResourceKindRoles           ResourceKind = "roles"
	ResourceKindRoleBindings    ResourceKind = "rolebindings"
	ResourceKindHelmReleases    ResourceKind = "helmreleases"
	ResourceKindDaemonSets      ResourceKind = "daemonsets"
	ResourceKindStatefulSets    ResourceKind = "statefulsets"
	ResourceKindReplicaSets     ResourceKind = "replicasets"
	ResourceKindJobs            ResourceKind = "jobs"
	ResourceKindCronJobs        ResourceKind = "cronjobs"
)

func dataplaneNamespacedListResourceKinds() []ResourceKind {
	return []ResourceKind{
		ResourceKindPods,
		ResourceKindDeployments,
		ResourceKindDaemonSets,
		ResourceKindStatefulSets,
		ResourceKindReplicaSets,
		ResourceKindJobs,
		ResourceKindCronJobs,
		ResourceKindServices,
		ResourceKindIngresses,
		ResourceKindPVCs,
		ResourceKindConfigMaps,
		ResourceKindSecrets,
		ResourceKindServiceAccounts,
		ResourceKindRoles,
		ResourceKindRoleBindings,
		ResourceKindHelmReleases,
	}
}

func dataplaneNamespacedListResourceKindStrings() []string {
	kinds := dataplaneNamespacedListResourceKinds()
	out := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		out = append(out, string(kind))
	}
	return out
}

// WorkPriority orders dataplane snapshot work. Smaller value = higher priority.
type WorkPriority int

const (
	// WorkPriorityCritical is user-facing namespaces list and namespaced resource list APIs.
	WorkPriorityCritical WorkPriority = iota
	// WorkPriorityHigh is drawer-led projections (e.g. namespace summary from snapshots).
	WorkPriorityHigh
	// WorkPriorityMedium is dashboard rollups and other cross-namespace snapshot sampling.
	WorkPriorityMedium
	// WorkPriorityLow is observers and bounded namespace-list row enrichment.
	WorkPriorityLow
)

func (p WorkPriority) String() string {
	switch p {
	case WorkPriorityCritical:
		return "critical"
	case WorkPriorityHigh:
		return "high"
	case WorkPriorityMedium:
		return "medium"
	case WorkPriorityLow:
		return "low"
	default:
		return "unknown"
	}
}

type workKey struct {
	Cluster   string
	Class     WorkClass
	Kind      ResourceKind
	Namespace string
}

type inFlight struct {
	done              chan struct{}
	err               error
	effectivePriority WorkPriority
}

// slotTicket identifies a granted cluster slot (release uses pointer identity; CancelFunc is not comparable).
type slotTicket struct{}

type laneRunner struct {
	key          workKey
	inf          *inFlight
	cancel       context.CancelFunc
	ticket       *slotTicket
	startedAt    time.Time
	priority     WorkPriority
	source       string
	queuedWaitMs int64 // time from enqueue to slot grant (0 if acquired immediately)
}

type waiterNode struct {
	priority   WorkPriority
	seq        uint64
	key        workKey
	inf        *inFlight
	parentCtx  context.Context
	ready      chan struct{}
	runCtx     context.Context
	cancel     context.CancelFunc
	ticket     *slotTicket
	abandoned  bool
	enqueuedAt time.Time
	source     string
}

type waiterHeap []*waiterNode

func (h waiterHeap) Len() int { return len(h) }

func (h waiterHeap) Less(i, j int) bool {
	if h[i].priority != h[j].priority {
		return h[i].priority < h[j].priority
	}
	return h[i].seq < h[j].seq
}

func (h waiterHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *waiterHeap) Push(x any) { *h = append(*h, x.(*waiterNode)) }

func (h *waiterHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

type clusterLane struct {
	runners []*laneRunner
	waiters waiterHeap
	seq     uint64
}

// workScheduler provides per-cluster concurrency, in-flight de-duplication, priority ordering,
// preemption of strictly lower effective priority, bounded retry on transient errors, and
// simple run-duration stats (no Prometheus).
type workScheduler struct {
	mu   sync.Mutex
	cond *sync.Cond

	inFlight      map[workKey]*inFlight
	lanes         map[string]*clusterLane
	maxPerCluster int
	stats         *runStats

	// Optional: record very slow snapshot runs into the activity registry (set from NewManager).
	longRunMin time.Duration
	onLongRun  func(key workKey, priority WorkPriority, d time.Duration, err error)
}

func newWorkScheduler(maxPerCluster int) *workScheduler {
	if maxPerCluster <= 0 {
		maxPerCluster = 4
	}
	s := &workScheduler{
		inFlight:      make(map[workKey]*inFlight),
		lanes:         make(map[string]*clusterLane),
		maxPerCluster: maxPerCluster,
		stats:         newRunStats(),
	}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *workScheduler) configureLongRun(min time.Duration, fn func(workKey, WorkPriority, time.Duration, error)) {
	s.longRunMin = min
	s.onLongRun = fn
}

func (s *workScheduler) StatsSnapshot() SchedulerRunStatsSnapshot {
	return s.stats.snapshot()
}

func (s *workScheduler) laneLocked(cluster string) *clusterLane {
	l, ok := s.lanes[cluster]
	if !ok {
		l = &clusterLane{}
		s.lanes[cluster] = l
	}
	return l
}

func findPreemptVictim(lane *clusterLane, need WorkPriority) int {
	bestIdx := -1
	var bestPri WorkPriority
	first := true
	for i, r := range lane.runners {
		ep := r.inf.effectivePriority
		if ep > need {
			if first || ep > bestPri {
				bestPri = ep
				bestIdx = i
				first = false
			}
		}
	}
	return bestIdx
}

func (s *workScheduler) grantNextWaitersLocked(lane *clusterLane) {
	for len(lane.runners) < s.maxPerCluster && len(lane.waiters) > 0 {
		w := heap.Pop(&lane.waiters).(*waiterNode)
		if w.abandoned || w.parentCtx.Err() != nil {
			continue
		}
		runCtx, cancel := context.WithCancel(w.parentCtx)
		ticket := &slotTicket{}
		now := time.Now()
		qw := now.Sub(w.enqueuedAt).Milliseconds()
		if qw < 0 {
			qw = 0
		}
		lane.runners = append(lane.runners, &laneRunner{
			key:          w.key,
			inf:          w.inf,
			cancel:       cancel,
			ticket:       ticket,
			startedAt:    now,
			priority:     w.priority,
			source:       w.source,
			queuedWaitMs: qw,
		})
		w.runCtx = runCtx
		w.cancel = cancel
		w.ticket = ticket
		close(w.ready)
	}
}

func (s *workScheduler) acquireSlot(cluster string, prio WorkPriority, parentCtx context.Context, key workKey, inf *inFlight) (context.Context, func(), error) {
	for {
		if err := parentCtx.Err(); err != nil {
			return nil, nil, err
		}

		s.mu.Lock()
		lane := s.laneLocked(cluster)
		s.grantNextWaitersLocked(lane)

		if len(lane.runners) < s.maxPerCluster {
			runCtx, cancel := context.WithCancel(parentCtx)
			ticket := &slotTicket{}
			now := time.Now()
			lane.runners = append(lane.runners, &laneRunner{
				key:          key,
				inf:          inf,
				cancel:       cancel,
				ticket:       ticket,
				startedAt:    now,
				priority:     prio,
				source:       workSourceOrAPI(parentCtx),
				queuedWaitMs: 0,
			})
			s.mu.Unlock()
			release := func() { s.releaseSlot(cluster, ticket) }
			return runCtx, release, nil
		}

		if idx := findPreemptVictim(lane, prio); idx >= 0 {
			s.stats.recordPreemption()
			lane.runners[idx].cancel()
			s.cond.Wait()
			s.mu.Unlock()
			continue
		}

		lane.seq++
		me := &waiterNode{
			priority:   prio,
			seq:        lane.seq,
			key:        key,
			inf:        inf,
			parentCtx:  parentCtx,
			ready:      make(chan struct{}),
			enqueuedAt: time.Now(),
			source:     workSourceOrAPI(parentCtx),
		}
		heap.Push(&lane.waiters, me)
		s.mu.Unlock()

		select {
		case <-parentCtx.Done():
			s.mu.Lock()
			me.abandoned = true
			s.mu.Unlock()
			return nil, nil, parentCtx.Err()
		case <-me.ready:
			release := func() { s.releaseSlot(cluster, me.ticket) }
			return me.runCtx, release, nil
		}
	}
}

func (s *workScheduler) releaseSlot(cluster string, ticket *slotTicket) {
	s.mu.Lock()
	lane := s.laneLocked(cluster)
	for i, r := range lane.runners {
		if r.ticket == ticket {
			lane.runners = append(lane.runners[:i], lane.runners[i+1:]...)
			break
		}
	}
	s.grantNextWaitersLocked(lane)
	s.mu.Unlock()
	s.cond.Broadcast()
}

// Run executes work for key with in-flight de-duplication. Equivalent in-flight shares one result;
// effective priority is the best (minimum) priority among waiters so shared runs are not preempted
// inappropriately. Slot time is recorded in stats from successful acquire until Run returns.
func (s *workScheduler) Run(ctx context.Context, priority WorkPriority, key workKey, fn func(context.Context) error) error {
	s.mu.Lock()
	if existing, ok := s.inFlight[key]; ok {
		if priority < existing.effectivePriority {
			existing.effectivePriority = priority
		}
		done := existing.done
		s.mu.Unlock()
		select {
		case <-done:
			return existing.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	inf := &inFlight{
		done:              make(chan struct{}),
		effectivePriority: priority,
	}
	s.inFlight[key] = inf
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.inFlight, key)
		s.mu.Unlock()
		close(inf.done)
	}()

	runCtx, release, err := s.acquireSlot(key.Cluster, priority, ctx, key, inf)
	if err != nil {
		inf.err = err
		return err
	}
	defer release()

	slotStart := time.Now()
	var fnErr error
	defer func() {
		d := time.Since(slotStart)
		s.stats.recordRun(priority, key.Kind, d)
		if s.onLongRun != nil && s.longRunMin > 0 && d >= s.longRunMin {
			s.onLongRun(key, priority, d, fnErr)
		}
	}()

	backoff := 100 * time.Millisecond
	maxBackoff := 1500 * time.Millisecond

	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				inf.err = ctx.Err()
				fnErr = ctx.Err()
				return ctx.Err()
			case <-runCtx.Done():
				inf.err = runCtx.Err()
				fnErr = runCtx.Err()
				return runCtx.Err()
			}
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}

		err := fn(runCtx)
		fnErr = err
		if err == nil {
			inf.err = nil
			return nil
		}

		norm := NormalizeError(err)
		switch norm.Class {
		case NormalizedErrorClassRateLimited,
			NormalizedErrorClassTimeout,
			NormalizedErrorClassTransient,
			NormalizedErrorClassProxyFailure,
			NormalizedErrorClassConnectivity:
			continue
		default:
			inf.err = err
			return err
		}
	}

	inf.err = context.DeadlineExceeded
	fnErr = context.DeadlineExceeded
	return inf.err
}
