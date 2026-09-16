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

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/pods"
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
	epoch       uint64
	cancel      context.CancelFunc
	resync      chan struct{}
	lastResync  time.Time
	subscribers map[*podLiveSubscription]struct{}
	update      PodLiveUpdate
}

// requestResync is called under podPublishMu. Bound requests even when the
// worker drains the one-slot queue immediately; blocked workers stay blocked.
func (c *podLiveCell) requestResync(now time.Time) {
	if c.update.State == PodLiveBlocked || (!c.lastResync.IsZero() && now.Sub(c.lastResync) < podLiveResyncInterval) {
		return
	}
	select {
	case c.resync <- struct{}{}:
		c.lastResync = now
	default:
	}
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
	if name == "" || strings.TrimSpace(name) != name || len(validation.IsDNS1123Label(ns)) != 0 {
		return nil, ErrPodLiveScope
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
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
	m.liveMu.Lock()
	defer m.liveMu.Unlock()
	if m.liveClosed {
		return nil, ErrPodLiveUnavailable
	}
	p.podPublishMu.Lock()
	defer p.podPublishMu.Unlock()
	cell := p.podLive[ns]
	if m.liveSubscribers >= podLiveMaxSubscribers || (cell == nil && m.liveCells >= podLiveMaxCells) || (cell != nil && len(cell.subscribers) >= podLiveMaxCellSubscribers) {
		return nil, ErrPodLiveCapacity
	}
	if cell == nil {
		if p.podLive == nil {
			p.podLive = make(map[string]*podLiveCell)
		}
		if p.podEpoch == nil {
			p.podEpoch = make(map[string]uint64)
		}
		p.podEpoch[ns]++
		if cancel := p.podEventsJobs[ns]; cancel != nil {
			cancel()
		}
		workerCtx, cancel := context.WithCancel(context.Background())
		cell = &podLiveCell{epoch: p.podEpoch[ns], cancel: cancel, resync: make(chan struct{}, 1), subscribers: make(map[*podLiveSubscription]struct{}), update: PodLiveUpdate{Context: name, Namespace: ns, State: PodLiveStarting, Stale: true}}
		p.podLive[ns] = cell
		m.liveCells++
		go m.runPodLive(workerCtx, p, ns, cell)
	}
	sub := &podLiveSubscription{updates: make(chan PodLiveUpdate, 1), done: make(chan struct{})}
	cell.subscribers[sub] = struct{}{}
	m.liveSubscribers++
	latestPodUpdate(sub.updates, cell.update)
	sub.release = func() {
		m.liveMu.Lock()
		defer m.liveMu.Unlock()
		p.podPublishMu.Lock()
		defer p.podPublishMu.Unlock()
		if _, ok := cell.subscribers[sub]; !ok {
			return
		}
		delete(cell.subscribers, sub)
		m.liveSubscribers--
		stopped := cell.update
		stopped.State, stopped.Stale = PodLiveStopped, true
		latestPodUpdate(sub.updates, stopped)
		close(sub.updates)
		if len(cell.subscribers) == 0 && p.podLive[ns] == cell {
			cell.cancel()
			delete(p.podLive, ns)
			p.podEpoch[ns]++
			m.liveCells--
			if snap, ok := p.podsStore.getCached(ns); ok {
				snap.Meta.Freshness = FreshnessClassStale
				setNamespacedSnapshot(&p.podsStore, ns, snap)
			}
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
	m.mu.RLock()
	planes := make([]*clusterPlane, 0, len(m.planes))
	for _, p := range m.planes {
		planes = append(planes, p)
	}
	m.mu.RUnlock()
	var subs []*podLiveSubscription
	for _, p := range planes {
		p.podPublishMu.Lock()
		for _, c := range p.podLive {
			c.cancel()
			for s := range c.subscribers {
				subs = append(subs, s)
			}
		}
		p.podPublishMu.Unlock()
	}
	m.liveMu.Unlock()
	for _, s := range subs {
		s.Close()
	}
}
func (p *clusterPlane) publishPodLive(ns string, cell *podLiveCell, state PodLiveState, reason, rv string, objects map[string]*corev1.Pod) {
	p.podPublishMu.Lock()
	defer p.podPublishMu.Unlock()
	if p.podLive[ns] != cell || p.podEpoch[ns] != cell.epoch {
		return
	}
	if objects != nil {
		keys := make([]string, 0, len(objects))
		for key := range objects {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		list := make([]corev1.Pod, 0, len(keys))
		for _, key := range keys {
			list = append(list, *objects[key])
		}
		items := pods.MapPodListItems(list, nil, time.Now())
		snap := PodsSnapshot{Items: items, Meta: p.snapshotMetaHot(time.Now().UTC())}
		snap.Relationships, snap.RelationshipMetadata = normalizeSnapshotRelationships(items, dto.ExtractResourceRelationships[dto.PodListItemDTO], []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyLabels})
		setNamespacedSnapshot(&p.podsStore, ns, snap)
	}
	snap, ok := p.podsStore.getCached(ns)
	if ok && state != PodLiveLive && snap.Meta.Freshness != FreshnessClassStale {
		snap.Meta.Freshness = FreshnessClassStale
		setNamespacedSnapshot(&p.podsStore, ns, snap)
		snap, _ = p.podsStore.getCached(ns)
	}
	cell.update = PodLiveUpdate{Context: p.name, Namespace: ns, State: state, Reason: reason, ResourceVersion: rv, Stale: state != PodLiveLive || snap.Meta.Freshness == FreshnessClassStale, Revision: snap.Meta.Revision, ObservedAt: snap.Meta.ObservedAt}
	for sub := range cell.subscribers {
		latestPodUpdate(sub.updates, cell.update)
	}
}
func (m *manager) runPodLive(ctx context.Context, p *clusterPlane, ns string, cell *podLiveCell) {
	var rv string
	objects := map[string]*corev1.Pod{}
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
			key := workKey{Cluster: p.name, Class: WorkClass("pod-live-" + strconv.FormatUint(cell.epoch, 10)), Kind: ResourceKindPods, Namespace: ns}
			err = m.scheduler.Run(listCtx, WorkPriorityCritical, key, func(runCtx context.Context) error {
				result, e := c.Clientset.CoreV1().Pods(ns).List(runCtx, metav1.ListOptions{Limit: podLiveMaxObjects + 1})
				p.capRegistry.LearnReadResult(p.name, "", "pods", ns, "list", CapabilityScopeNamespace, e)
				if e != nil {
					return e
				}
				if len(result.Items) > podLiveMaxObjects || result.Continue != "" {
					return ErrPodLiveCapacity
				}
				next := make(map[string]*corev1.Pod, len(result.Items))
				size := 0
				for i := range result.Items {
					pod := &result.Items[i]
					size += pod.Size()
					if size > podLiveMaxBytes {
						return ErrPodLiveCapacity
					}
					next[pod.Name] = pod
				}
				objects = next
				rv = result.ResourceVersion
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
				p.publishPodLive(ns, cell, PodLiveStarting, "", rv, objects)
			}
			timeout := int64(60)
			stream, err = c.Clientset.CoreV1().Pods(ns).Watch(watchCtx, metav1.ListOptions{ResourceVersion: rv, AllowWatchBookmarks: true, TimeoutSeconds: &timeout})
			p.capRegistry.LearnReadResult(p.name, "", "pods", ns, "watch", CapabilityScopeNamespace, err)
		}
		if err == nil {
			if listed {
				p.publishPodLive(ns, cell, PodLiveLive, "", rv, objects)
			} else {
				// Opening a transport is not a new observation of retained rows.
				p.publishPodLive(ns, cell, PodLiveLive, "", rv, nil)
			}
			started := time.Now()
			err = m.consumePodWatch(watchCtx, p, ns, cell, stream, objects, &rv)
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
			p.publishPodLive(ns, cell, PodLiveReconnecting, "resync", rv, nil)
			continue
		}
		if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) || errors.Is(err, ErrPodLiveCapacity) {
			reason := "access denied"
			if errors.Is(err, ErrPodLiveCapacity) {
				reason = "capacity exceeded"
			}
			p.publishPodLive(ns, cell, PodLiveBlocked, reason, rv, nil)
			return
		}
		if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
			rv = ""
		}
		p.publishPodLive(ns, cell, PodLiveReconnecting, "upstream disconnected", rv, nil)
		timer := time.NewTimer(min(30*time.Second, delay+time.Duration(rand.Int64N(int64(delay/4)))))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-cell.resync:
			timer.Stop()
			rv = ""
		case <-timer.C:
		}
		delay = min(delay*2, 30*time.Second)
	}
}

var errPodResync = errors.New("pod live resync")

func (m *manager) consumePodWatch(ctx context.Context, p *clusterPlane, ns string, cell *podLiveCell, w watch.Interface, objects map[string]*corev1.Pod, rv *string) error {
	tick := time.NewTicker(podLiveCoalesce)
	defer tick.Stop()
	dirty := false
	defer func() {
		// Preserve processed events/RV on every exit, including timeout or ERROR.
		if dirty && ctx.Err() != context.Canceled {
			p.publishPodLive(ns, cell, PodLiveReconnecting, "upstream disconnected", *rv, objects)
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
			return errPodResync
		case <-tick.C:
			if dirty {
				p.publishPodLive(ns, cell, PodLiveLive, "", *rv, objects)
				dirty = false
			}
		case event, ok := <-w.ResultChan():
			if !ok {
				return errors.New("watch closed")
			}
			if event.Type == watch.Error {
				err := apierrors.FromObject(event.Object)
				p.capRegistry.LearnReadResult(p.name, "", "pods", ns, "watch", CapabilityScopeNamespace, err)
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
			pod, ok := event.Object.(*corev1.Pod)
			if !ok || pod.Namespace != ns {
				return errors.New("invalid pod watch event")
			}
			old := objects[pod.Name]
			switch event.Type {
			case watch.Added, watch.Modified:
				if old != nil {
					size -= old.Size()
				}
				size += pod.Size()
				if size > podLiveMaxBytes || (old == nil && len(objects) >= podLiveMaxObjects) {
					return ErrPodLiveCapacity
				}
				objects[pod.Name] = pod.DeepCopy()
				dirty = true
			case watch.Deleted:
				if old != nil && old.UID == pod.UID {
					size -= old.Size()
					delete(objects, pod.Name)
					dirty = true
				}
			default:
				return errors.New("unknown pod watch event")
			}
			*rv = pod.ResourceVersion
		}
	}
}
