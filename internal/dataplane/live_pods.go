package dataplane

import (
	"context"
	"errors"
	"math/rand/v2"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/apimachinery/pkg/watch"
)

const (
	podLiveMaxCells           = 8
	podLiveMaxSubscribers     = 32
	podLiveMaxCellSubscribers = 8
	podLiveMaxObjects         = 10000
	podLiveMaxBytes           = 32 << 20
	podLiveCoalesce           = 250 * time.Millisecond
	podLiveResyncInterval     = 5 * time.Second
)

var (
	ErrPodLiveCapacity    = errors.New("live pods capacity exceeded")
	ErrPodLiveUnavailable = errors.New("live pods unavailable")
	ErrPodLiveScope       = errors.New("invalid live pods scope")
)

type PodLiveState string

const (
	PodLiveStarting     PodLiveState = "starting"
	PodLiveLive         PodLiveState = "live"
	PodLiveReconnecting PodLiveState = "reconnecting"
	PodLiveBlocked      PodLiveState = "blocked"
	PodLiveStopped      PodLiveState = "stopped"
)

type PodLiveUpdate struct {
	Resource        ResourceKind `json:"resource,omitempty"`
	Context         string       `json:"context"`
	Namespace       string       `json:"namespace"`
	State           PodLiveState `json:"state"`
	Revision        uint64       `json:"revision"`
	ResourceVersion string       `json:"resourceVersion,omitempty"`
	Stale           bool         `json:"stale"`
	ObservedAt      time.Time    `json:"observedAt,omitzero"`
	Reason          string       `json:"reason,omitempty"`
}
type PodLiveSubscription interface {
	Updates() <-chan PodLiveUpdate
	Close()
}
type podLiveSubscription struct {
	updates chan PodLiveUpdate
	done    chan struct{}
	once    sync.Once
	release func()
}

func (s *podLiveSubscription) Updates() <-chan PodLiveUpdate { return s.updates }
func (s *podLiveSubscription) Close()                        { s.once.Do(func() { s.release(); close(s.done) }) }

// All cell/subscriber state is protected by the plane publication mutex.
type podLiveCell struct {
	epoch      uint64
	cancel     context.CancelFunc
	resync     chan struct{}
	lastResync time.Time
	// Only a successful LIST started after an invalidation covers it.
	invalidationGeneration uint64
	observedGeneration     uint64
	subscribers            map[*podLiveSubscription]struct{}
	update                 PodLiveUpdate
}

// requestResync is called under the resource publication mutex. The worker
// rate-limits consumption, so a request during cooldown is retained, not lost.
func (c *podLiveCell) requestResync() {
	if c.update.State == PodLiveBlocked || c.update.State == PodLiveStopped {
		return
	}
	select {
	case c.resync <- struct{}{}:
	default:
	}
}

// waitResourceResync runs only in the existing worker, after taking a request.
// Its timer is owned by that worker and cancellation never waits under a lock.
func (p *clusterPlane) waitResourceResync(ctx context.Context, ns string, cell *podLiveCell, kind ResourceKind) bool {
	mu, epochs, cells := p.resourceOwnership(kind)
	mu.Lock()
	delay := time.Until(cell.lastResync.Add(podLiveResyncInterval))
	mu.Unlock()
	if delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return false
		case <-timer.C:
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if ctx.Err() != nil || (*cells)[ns] != cell || (*epochs)[ns] != cell.epoch || cell.update.State == PodLiveBlocked || cell.update.State == PodLiveStopped {
		return false
	}
	// Everything requested before this LIST starts is covered by the same LIST.
	select {
	case <-cell.resync:
	default:
	}
	cell.lastResync = time.Now()
	return true
}

// invalidateResourceLiveLocked preserves rows and publishes their stale status
// before waking the worker. The caller owns the resource publication mutex.
func (p *clusterPlane) invalidateResourceLiveLocked(ns string, cell *podLiveCell, kind ResourceKind) {
	cell.invalidationGeneration++
	a := resourceAdapter(kind)
	a.stale(p, ns)
	cell.update.Stale = true
	if snap, ok := a.cached(p, ns); ok {
		cell.update.Revision = snap.Meta.Revision
		cell.update.ObservedAt = snap.Meta.ObservedAt
	}
	for sub := range cell.subscribers {
		latestPodUpdate(sub.updates, cell.update)
	}
	cell.requestResync()
}

func latestPodUpdate(ch chan PodLiveUpdate, u PodLiveUpdate) {
	select {
	case ch <- u:
		return
	default:
	}
	select {
	case <-ch:
	default:
	}
	select {
	case ch <- u:
	default:
	}
}
func (m *manager) PodsCachedSnapshot(name, ns string) (PodsSnapshot, bool) {
	m.mu.RLock()
	p := m.planes[name]
	m.mu.RUnlock()
	if p == nil {
		return PodsSnapshot{}, false
	}
	return p.podsStore.getCached(ns)
}
func (m *manager) SubscribePods(ctx context.Context, name, ns string) (PodLiveSubscription, error) {
	return m.SubscribeResourceLive(ctx, name, ns, ResourceKindPods)
}
func (m *manager) CachedResourceSnapshot(name, ns string, kind ResourceKind) (ResourceLiveSnapshot, bool) {
	if !liveEnabled(kind) || name == "" || strings.TrimSpace(name) != name || len(validation.IsDNS1123Label(ns)) != 0 {
		return ResourceLiveSnapshot{}, false
	}
	m.mu.RLock()
	p := m.planes[name]
	m.mu.RUnlock()
	if p == nil {
		return ResourceLiveSnapshot{}, false
	}
	return resourceAdapter(kind).cached(p, ns)
}
func (m *manager) SubscribeResourceLive(ctx context.Context, name, ns string, kind ResourceKind) (ResourceLiveSubscription, error) {
	if !liveEnabled(kind) || name == "" || strings.TrimSpace(name) != name || len(validation.IsDNS1123Label(ns)) != 0 {
		return nil, ErrPodLiveScope
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	m.liveMu.Lock()
	closed := m.liveClosed
	m.liveMu.Unlock()
	if closed {
		return nil, ErrPodLiveUnavailable
	}
	if m.clients == nil {
		return nil, ErrPodLiveUnavailable
	}
	// Resolves only the exact kubeconfig identity; this does not issue an API read.
	c, active, err := m.clients.GetClientsForContext(ctx, name)
	if err != nil || active != name || c == nil {
		return nil, ErrPodLiveScope
	}
	plane, err := m.PlaneForCluster(ctx, name)
	if err != nil {
		return nil, ErrPodLiveUnavailable
	}
	p := plane.(*clusterPlane)
	a := resourceAdapter(kind)
	mu, epochs, cells := p.resourceOwnership(kind)
	mu.Lock()
	defer mu.Unlock()
	m.liveMu.Lock()
	defer m.liveMu.Unlock()
	if m.liveClosed {
		return nil, ErrPodLiveUnavailable
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	cell := (*cells)[ns]
	if m.liveSubscribers >= podLiveMaxSubscribers || (cell == nil && m.liveCells >= podLiveMaxCells) || (cell != nil && len(cell.subscribers) >= podLiveMaxCellSubscribers) {
		return nil, ErrPodLiveCapacity
	}
	if cell == nil {
		if (*cells) == nil {
			(*cells) = make(map[string]*podLiveCell)
		}
		if (*epochs) == nil {
			(*epochs) = make(map[string]uint64)
		}
		(*epochs)[ns]++
		if kind == ResourceKindPods {
			if cancel := p.podEventsJobs[ns]; cancel != nil {
				cancel()
			}
		}
		workerCtx, cancel := context.WithCancel(context.Background())
		cell = &podLiveCell{epoch: (*epochs)[ns], cancel: cancel, resync: make(chan struct{}, 1), subscribers: make(map[*podLiveSubscription]struct{}), update: PodLiveUpdate{Resource: kind, Context: name, Namespace: ns, State: PodLiveStarting, Stale: true}}
		(*cells)[ns] = cell
		m.liveCells++
		go m.runResourceLive(workerCtx, p, ns, cell, a)
	}
	sub := &podLiveSubscription{updates: make(chan PodLiveUpdate, 1), done: make(chan struct{})}
	cell.subscribers[sub] = struct{}{}
	m.liveSubscribers++
	latestPodUpdate(sub.updates, cell.update)
	sub.release = func() {
		mu.Lock()
		defer mu.Unlock()
		m.liveMu.Lock()
		defer m.liveMu.Unlock()
		if _, ok := cell.subscribers[sub]; !ok {
			return
		}
		delete(cell.subscribers, sub)
		m.liveSubscribers--
		stopped := cell.update
		stopped.State, stopped.Stale = PodLiveStopped, true
		latestPodUpdate(sub.updates, stopped)
		close(sub.updates)
		if len(cell.subscribers) == 0 && (*cells)[ns] == cell {
			cell.cancel()
			delete((*cells), ns)
			(*epochs)[ns]++
			m.liveCells--
			a.stale(p, ns)
		}
	}
	go func() {
		select {
		case <-ctx.Done():
			sub.Close()
		case <-sub.done:
		}
	}()
	return sub, nil
}

// ClosePodsLive cancels upstream workers and closes all subscriptions at shutdown.
func (m *manager) ClosePodsLive() {
	// Do not hold the lifecycle lock while acquiring liveMu or podPublishMu.
	// Cancellation reaches private and future planes, not just this map snapshot.
	m.podEventsLifecycle.close()
	m.liveMu.Lock()
	m.liveClosed = true
	m.liveMu.Unlock()
	m.mu.RLock()
	planes := make([]*clusterPlane, 0, len(m.planes))
	for _, p := range m.planes {
		planes = append(planes, p)
	}
	m.mu.RUnlock()
	var subs []*podLiveSubscription
	for _, p := range planes {
		for _, kind := range []ResourceKind{ResourceKindPods, ResourceKindDeployments, ResourceKindStatefulSets, ResourceKindDaemonSets, ResourceKindReplicaSets, ResourceKindJobs, ResourceKindCronJobs} {
			mu, _, cells := p.resourceOwnership(kind)
			mu.Lock()
			for _, c := range *cells {
				c.cancel()
				for s := range c.subscribers {
					subs = append(subs, s)
				}
			}
			mu.Unlock()
		}
	}

	for _, s := range subs {
		s.Close()
	}
}
func (p *clusterPlane) publishPodLive(ns string, cell *podLiveCell, state PodLiveState, reason, rv string, objects map[string]*corev1.Pod) {
	var converted map[string]liveObject
	if objects != nil {
		converted = make(map[string]liveObject, len(objects))
		for k, v := range objects {
			converted[k] = v
		}
	}
	p.publishResourceLive(ns, cell, state, reason, rv, converted, resourceAdapter(ResourceKindPods))
}
func (p *clusterPlane) publishResourceLive(ns string, cell *podLiveCell, state PodLiveState, reason, rv string, objects map[string]liveObject, a resourceLiveAdapter) {
	mu, epochs, cells := p.resourceOwnership(a.kind)
	mu.Lock()
	defer mu.Unlock()
	if (*cells)[ns] != cell || (*epochs)[ns] != cell.epoch {
		return
	}
	if objects != nil {
		keys := make([]string, 0, len(objects))
		for key := range objects {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		list := make([]liveObject, 0, len(keys))
		for _, key := range keys {
			list = append(list, objects[key])
		}
		a.publish(p, ns, list)
	}
	// A LIST or watch event that predates an invalidation may update rows,
	// but cannot clear stale while the covering resync is still pending.
	if state != PodLiveLive || cell.observedGeneration != cell.invalidationGeneration {
		a.stale(p, ns)
	}
	snap, _ := a.cached(p, ns)
	cell.update = PodLiveUpdate{Resource: a.kind, Context: p.name, Namespace: ns, State: state, Reason: reason, ResourceVersion: rv, Stale: state != PodLiveLive || snap.Meta.Freshness == FreshnessClassStale, Revision: snap.Meta.Revision, ObservedAt: snap.Meta.ObservedAt}
	for sub := range cell.subscribers {
		latestPodUpdate(sub.updates, cell.update)
	}
}
func (m *manager) runResourceLive(ctx context.Context, p *clusterPlane, ns string, cell *podLiveCell, a resourceLiveAdapter) {
	var rv string
	objects := map[string]liveObject{}
	delay := time.Second
	for ctx.Err() == nil {
		listed := false
		c, active, err := m.clients.GetClientsForContext(ctx, p.name)
		if err == nil && (c == nil || c.Clientset == nil || active != p.name) {
			err = ErrPodLiveUnavailable
		}
		if err == nil && rv == "" {
			listCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			// A separate key prevents joining a legacy LIST which cannot supply an RV.
			key := workKey{Cluster: p.name, Class: WorkClass("resource-live-" + strconv.FormatUint(cell.epoch, 10)), Kind: a.kind, Namespace: ns}
			err = m.scheduler.Run(listCtx, WorkPriorityCritical, key, func(runCtx context.Context) error {
				mu, _, _ := p.resourceOwnership(a.kind)
				mu.Lock()
				generation := cell.invalidationGeneration
				mu.Unlock()
				result, e := a.list(runCtx, c, ns, metav1.ListOptions{Limit: podLiveMaxObjects + 1})
				p.capRegistry.LearnReadResult(p.name, a.group, a.resource, ns, "list", CapabilityScopeNamespace, e)
				if e != nil {
					return e
				}
				if len(result.items) > podLiveMaxObjects || result.continuation != "" {
					return ErrPodLiveCapacity
				}
				next := make(map[string]liveObject, len(result.items))
				size := 0
				for i := range result.items {
					pod := result.items[i]
					size += pod.Size()
					if size > podLiveMaxBytes {
						return ErrPodLiveCapacity
					}
					if !a.valid(pod) || pod.GetNamespace() != ns || pod.GetName() == "" {
						return ErrPodLiveScope
					}
					if next[pod.GetName()] != nil {
						return ErrPodLiveScope
					}
					next[pod.GetName()] = pod.DeepCopyObject().(liveObject)
				}
				mu.Lock()
				cell.observedGeneration = generation
				mu.Unlock()
				objects = next
				rv = result.rv
				listed = true
				return nil
			})
			cancel()
		}
		if ctx.Err() != nil {
			return
		}
		var stream watch.Interface
		watchCtx, cancelWatch := context.WithTimeout(ctx, 75*time.Second)
		if err == nil {
			if listed {
				p.publishResourceLive(ns, cell, PodLiveStarting, "", rv, objects, a)
			}
			timeout := int64(60)
			stream, err = a.watch(watchCtx, c, ns, metav1.ListOptions{ResourceVersion: rv, AllowWatchBookmarks: true, TimeoutSeconds: &timeout})
			p.capRegistry.LearnReadResult(p.name, a.group, a.resource, ns, "watch", CapabilityScopeNamespace, err)
		}
		if err == nil {
			if listed {
				p.publishResourceLive(ns, cell, PodLiveLive, "", rv, objects, a)
			} else {
				// Opening a transport is not a new observation of retained rows.
				p.publishResourceLive(ns, cell, PodLiveLive, "", rv, nil, a)
			}
			started := time.Now()
			// Transport timeout closes the stream; a pending resync belongs to
			// the worker and must survive that timeout during its cooldown.
			err = m.consumeResourceWatch(ctx, p, ns, cell, stream, objects, &rv, a)
			stream.Stop()
			if time.Since(started) >= time.Second {
				delay = time.Second
			}
		}
		cancelWatch()
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, errPodResync) {
			rv = ""
			p.publishResourceLive(ns, cell, PodLiveReconnecting, "resync", rv, nil, a)
			continue
		}
		if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) || errors.Is(err, ErrPodLiveCapacity) {
			reason := "access denied"
			if errors.Is(err, ErrPodLiveCapacity) {
				reason = "capacity exceeded"
			}
			p.publishResourceLive(ns, cell, PodLiveBlocked, reason, rv, nil, a)
			return
		}
		if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
			rv = ""
		}
		p.publishResourceLive(ns, cell, PodLiveReconnecting, "upstream disconnected", rv, nil, a)
		timer := time.NewTimer(min(30*time.Second, delay+time.Duration(rand.Int64N(int64(delay/4)))))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-cell.resync:
			timer.Stop()
			if !p.waitResourceResync(ctx, ns, cell, a.kind) {
				return
			}
			rv = ""
		case <-timer.C:
		}
		delay = min(delay*2, 30*time.Second)
	}
}

var errPodResync = errors.New("pod live resync")

func (m *manager) consumeResourceWatch(ctx context.Context, p *clusterPlane, ns string, cell *podLiveCell, w watch.Interface, objects map[string]liveObject, rv *string, a resourceLiveAdapter) error {
	tick := time.NewTicker(podLiveCoalesce)
	defer tick.Stop()
	dirty := false
	defer func() {
		// Preserve processed events/RV on every exit, including timeout or ERROR.
		if dirty && ctx.Err() != context.Canceled {
			p.publishResourceLive(ns, cell, PodLiveReconnecting, "upstream disconnected", *rv, objects, a)
		}
	}()
	size := 0
	for _, pod := range objects {
		size += pod.Size()
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-cell.resync:
			if !p.waitResourceResync(ctx, ns, cell, a.kind) {
				return context.Canceled
			}
			return errPodResync
		case <-tick.C:
			if dirty {
				p.publishResourceLive(ns, cell, PodLiveLive, "", *rv, objects, a)
				dirty = false
			}
		case event, ok := <-w.ResultChan():
			if !ok {
				return errors.New("watch closed")
			}
			if event.Type == watch.Error {
				err := apierrors.FromObject(event.Object)
				p.capRegistry.LearnReadResult(p.name, a.group, a.resource, ns, "watch", CapabilityScopeNamespace, err)
				return err
			}
			obj, e := meta.Accessor(event.Object)
			if e != nil {
				return e
			}
			if event.Type == watch.Bookmark {
				*rv = obj.GetResourceVersion()
				continue
			}
			pod, ok := event.Object.(liveObject)
			if !ok || !a.valid(event.Object) || pod.GetNamespace() != ns || pod.GetName() == "" {
				return errors.New("invalid pod watch event")
			}
			old := objects[pod.GetName()]
			switch event.Type {
			case watch.Added, watch.Modified:
				if old != nil {
					size -= old.Size()
				}
				size += pod.Size()
				if size > podLiveMaxBytes || (old == nil && len(objects) >= podLiveMaxObjects) {
					return ErrPodLiveCapacity
				}
				objects[pod.GetName()] = pod.DeepCopyObject().(liveObject)
				dirty = true
			case watch.Deleted:
				if old != nil && old.GetUID() == pod.GetUID() {
					size -= old.Size()
					delete(objects, pod.GetName())
					dirty = true
				}
			default:
				return errors.New("unknown pod watch event")
			}
			*rv = pod.GetResourceVersion()
		}
	}
}

func (m *manager) consumePodWatch(ctx context.Context, p *clusterPlane, ns string, cell *podLiveCell, w watch.Interface, objects map[string]*corev1.Pod, rv *string) error {
	converted := make(map[string]liveObject, len(objects))
	for k, v := range objects {
		converted[k] = v
	}
	defer func() {
		clear(objects)
		for k, v := range converted {
			objects[k] = v.(*corev1.Pod)
		}
	}()
	return m.consumeResourceWatch(ctx, p, ns, cell, w, converted, rv, resourceAdapter(ResourceKindPods))
}
