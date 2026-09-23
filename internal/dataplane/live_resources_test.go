package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/resource/cronjobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/daemonsets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	"github.com/korex-labs/kview/v5/internal/kube/resource/jobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/replicasets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/statefulsets"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	"k8s.io/apimachinery/pkg/watch"
)

type workloadCase struct {
	kind                        ResourceKind
	singular, version, resource string
	list                        func(context.Context, *cluster.Clients, string) (any, error)
}

var workloadCases = []workloadCase{
	{ResourceKindDeployments, "Deployment", "apps/v1", "deployments", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return deployments.ListDeployments(ctx, c, ns)
	}},
	{ResourceKindStatefulSets, "StatefulSet", "apps/v1", "statefulsets", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return statefulsets.ListStatefulSets(ctx, c, ns)
	}},
	{ResourceKindDaemonSets, "DaemonSet", "apps/v1", "daemonsets", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return daemonsets.ListDaemonSets(ctx, c, ns)
	}},
	{ResourceKindReplicaSets, "ReplicaSet", "apps/v1", "replicasets", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return replicasets.ListReplicaSets(ctx, c, ns)
	}},
	{ResourceKindJobs, "Job", "batch/v1", "jobs", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return jobs.ListJobs(ctx, c, ns)
	}},
	{ResourceKindCronJobs, "CronJob", "batch/v1", "cronjobs", func(ctx context.Context, c *cluster.Clients, ns string) (any, error) {
		return cronjobs.ListCronJobs(ctx, c, ns)
	}},
}

func TestResourceLiveCacheOnlyColdAndScope(t *testing.T) {
	m := &manager{planes: map[string]*clusterPlane{}}
	for _, tc := range workloadCases {
		if _, ok := m.CachedResourceSnapshot("exact", "apps", tc.kind); ok {
			t.Fatal("cold cache hit")
		}
		for _, ns := range []string{"", "*", "Apps", " apps"} {
			if _, err := m.SubscribeResourceLive(context.Background(), "exact", ns, tc.kind); err != ErrPodLiveScope {
				t.Fatal(ns, err)
			}
		}
	}
	if len(m.planes) != 0 {
		t.Fatal("cold read created plane")
	}
	if _, err := m.SubscribeResourceLive(context.Background(), "exact", "apps", ResourceKindSecrets); err != ErrPodLiveScope {
		t.Fatal(err)
	}
}
func TestResourceLiveManualResyncNoParallelList(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			mu, epochs, cells := p.resourceOwnership(tc.kind)
			cell := &podLiveCell{epoch: 1, resync: make(chan struct{}, 1)}
			mu.Lock()
			*epochs = map[string]uint64{"apps": 1}
			*cells = map[string]*podLiveCell{"apps": cell}
			mu.Unlock()
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			setNamespacedSnapshot(&store, "apps", Snapshot[int]{Items: []int{7}, Meta: p.snapshotMetaHot(time.Now())})
			desc := namespacedSnapshotDescriptor[int]{kind: tc.kind, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
				t.Error("parallel list admitted")
				return nil, nil
			}}
			for range 100 {
				s, err := executeNamespacedSnapshot(p, WithPodManualRefresh(context.Background()), nil, WorkPriorityCritical, nil, "apps", &store, desc)
				if err != nil || len(s.Items) != 1 || s.Items[0] != 7 {
					t.Fatal(s, err)
				}
			}
			if len(cell.resync) != 1 {
				t.Fatal("resync not coalesced")
			}
		})
	}
}
func TestResourceLiveFollowers(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			sched := newWorkScheduler(1)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			setNamespacedSnapshot(&store, "app", Snapshot[int]{Items: []int{1}, Meta: plane.snapshotMetaHot(time.Now())})
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			desc := namespacedSnapshotDescriptor[int]{kind: tc.kind, ttl: time.Hour, capResource: "pods", capScope: CapabilityScopeNamespace,
				fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
					calls.Add(1)
					close(started)
					<-release
					return []int{2}, nil
				},
			}
			results := make(chan snapshotExecResult, 2)
			run := func() {
				snap, err := executeNamespacedSnapshot(plane, WithPodManualRefresh(context.Background()), sched, WorkPriorityCritical, snapshotExecClientsProvider{}, "app", &store, desc)
				results <- snapshotExecResult{snap: snap, err: err}
			}
			go run()
			<-started
			go run()
			time.Sleep(25 * time.Millisecond)
			close(release)
			for range 2 {
				result := <-results
				if result.err != nil || len(result.snap.Items) != 1 || result.snap.Items[0] != 2 {
					t.Fatalf("joined result not published: %+v", result)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("not deduplicated: %d", calls.Load())
			}
		})
	}
}
func TestResourceLiveLatePlaneShutdown(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			m, gated := startupPlaneManager(t)
			// No Kubernetes client: reaching a worker would be a test failure, not a live call.
			m.clients = liveTestClients{c: &cluster.Clients{}}
			result := make(chan error, 1)
			go func() {
				sub, err := m.SubscribeResourceLive(context.Background(), "slow", "default", tc.kind)
				if sub != nil {
					sub.Close()
				}
				result <- err
			}()
			startupAwait(t, gated.started)
			var release sync.Once
			defer release.Do(func() { close(gated.release) })
			closed := make(chan struct{})
			go func() { m.ClosePodsLive(); close(closed) }()
			startupAwait(t, closed)
			release.Do(func() { close(gated.release) })
			if err := startupAwait(t, result); !errors.Is(err, ErrPodLiveUnavailable) {
				t.Fatalf("late subscription error = %v", err)
			}
			m.liveMu.Lock()
			cells, subscribers := m.liveCells, m.liveSubscribers
			m.liveMu.Unlock()
			if cells != 0 || subscribers != 0 {
				t.Fatal("Live worker admitted after shutdown")
			}
		})
	}
}

func TestResourceLiveInvalidation(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("invalidation made API request") })
			plane, err := m.PlaneForCluster(context.Background(), "ctx")
			if err != nil {
				t.Fatal(err)
			}
			p := plane.(*clusterPlane)
			var invalidate func(context.Context, string, string) error
			switch tc.kind {
			case ResourceKindDeployments:
				invalidate = m.InvalidateDeploymentsSnapshot
			case ResourceKindStatefulSets:
				invalidate = m.InvalidateStatefulSetsSnapshot
			case ResourceKindDaemonSets:
				invalidate = m.InvalidateDaemonSetsSnapshot
			case ResourceKindReplicaSets:
				invalidate = m.InvalidateReplicaSetsSnapshot
			case ResourceKindJobs:
				invalidate = m.InvalidateJobsSnapshot
			case ResourceKindCronJobs:
				invalidate = m.InvalidateCronJobsSnapshot
			}
			a := resourceAdapter(tc.kind)
			a.publish(p, "apps", nil)
			mu, epochs, cells := p.resourceOwnership(tc.kind)
			if err := invalidate(context.Background(), "ctx", "apps"); err != nil {
				t.Fatal(err)
			}
			if _, ok := a.cached(p, "apps"); ok {
				t.Fatal("cache not cleared")
			}
			mu.Lock()
			if (*epochs)["apps"] != 1 {
				t.Fatal("missing epoch invalidation")
			}
			sub := &podLiveSubscription{updates: make(chan PodLiveUpdate, 1)}
			cell := &podLiveCell{epoch: 1, cancel: func() {}, resync: make(chan struct{}, 1), subscribers: map[*podLiveSubscription]struct{}{sub: {}}, update: PodLiveUpdate{State: PodLiveLive}}
			*cells = map[string]*podLiveCell{"apps": cell}
			mu.Unlock()
			a.publish(p, "apps", nil)
			if err := invalidate(context.Background(), "ctx", "apps"); err != nil {
				t.Fatal(err)
			}
			s, ok := a.cached(p, "apps")
			if !ok || s.Meta.Freshness != FreshnessClassStale || len(cell.resync) != 1 {
				t.Fatal("live invalidation cleared cache or lost resync", s)
			}
			select {
			case u := <-sub.updates:
				if !u.Stale || !cell.update.Stale || u.State != PodLiveLive || u.Revision != s.Meta.Revision || !u.ObservedAt.Equal(s.Meta.ObservedAt) {
					t.Fatalf("invalid stale notification: %+v", u)
				}
			default:
				t.Fatal("live invalidation did not notify subscriber")
			}
			// Remove synthetic cell; it deliberately has no manager admission token.
			mu.Lock()
			delete(*cells, "apps")
			mu.Unlock()
		})
	}
}

func TestResourceLiveWatchRejectsWrongScopeAndKind(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			var obj liveObject
			switch tc.kind {
			case ResourceKindDeployments:
				obj = &appsv1.Deployment{}
			case ResourceKindStatefulSets:
				obj = &appsv1.StatefulSet{}
			case ResourceKindDaemonSets:
				obj = &appsv1.DaemonSet{}
			case ResourceKindReplicaSets:
				obj = &appsv1.ReplicaSet{}
			case ResourceKindJobs:
				obj = &batchv1.Job{}
			case ResourceKindCronJobs:
				obj = &batchv1.CronJob{}
			}
			obj.SetName("api")
			obj.SetNamespace("wrong")
			for _, wrongKind := range []bool{false, true} {
				incoming := obj
				if wrongKind {
					incoming = &appsv1.Deployment{}
					if tc.kind == ResourceKindDeployments {
						incoming = &batchv1.Job{}
					}
					incoming.SetName("api")
					incoming.SetNamespace("apps")
				}
				w := watch.NewRaceFreeFake()
				w.Add(incoming)
				rv := "initial"
				objects := map[string]liveObject{}
				err := (&manager{}).consumeResourceWatch(context.Background(), nil, "apps", &podLiveCell{}, w, objects, &rv, resourceAdapter(tc.kind))
				w.Stop()
				if err == nil || len(objects) != 0 || rv != "initial" {
					t.Fatal("invalid event accepted", err)
				}
			}
		})
	}
}

func resourceRows(t *testing.T, items any) []map[string]any {
	t.Helper()
	b, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if err = json.Unmarshal(b, &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}
func TestResourceLiveSixKindsProjectionAndIsolation(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			var lists, watches, other atomic.Int32
			events := make(chan map[string]any, 4)
			object := func(uid, rv string) map[string]any {
				return map[string]any{"apiVersion": tc.version, "kind": tc.singular, "metadata": map[string]string{"name": "api", "namespace": "apps", "uid": uid, "resourceVersion": rv}}
			}
			m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path != "/apis/"+tc.version+"/namespaces/apps/"+tc.resource {
					other.Add(1)
					http.NotFound(w, r)
					return
				}
				if r.URL.Query().Get("watch") != "true" {
					lists.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": tc.version, "kind": tc.singular + "List", "metadata": map[string]string{"resourceVersion": "initial"}, "items": []any{object("first", "initial")}})
					return
				}
				watches.Add(1)
				w.WriteHeader(200)
				w.(http.Flusher).Flush()
				for {
					select {
					case <-r.Context().Done():
						return
					case e := <-events:
						if json.NewEncoder(w).Encode(e) != nil {
							return
						}
						w.(http.Flusher).Flush()
					}
				}
			})
			a, err := m.SubscribeResourceLive(context.Background(), "ctx", "apps", tc.kind)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			b, err := m.SubscribeResourceLive(context.Background(), "ctx", "apps", tc.kind)
			if err != nil {
				t.Fatal(err)
			}
			defer b.Close()
			initial := awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
			awaitPodUpdate(t, b, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
			if initial.Resource != tc.kind || lists.Load() != 1 || watches.Load() != 1 || other.Load() != 0 {
				t.Fatalf("bad sharing/side reads: %+v %d %d %d", initial, lists.Load(), watches.Load(), other.Load())
			}
			snap, ok := m.CachedResourceSnapshot("ctx", "apps", tc.kind)
			if !ok {
				t.Fatal("missing cache")
			}
			rows := resourceRows(t, snap.Items)
			if len(rows) != 1 || rows[0]["uid"] != "first" {
				t.Fatalf("UID missing: %v", rows)
			}
			for _, scope := range [][2]string{{"other", "apps"}, {"ctx", "other"}} {
				if _, ok := m.CachedResourceSnapshot(scope[0], scope[1], tc.kind); ok {
					t.Fatal("cross-scope cache")
				}
			}
			if _, ok := m.CachedResourceSnapshot("ctx", "apps", ResourceKindPods); ok {
				t.Fatal("cross-kind cache")
			}
			// Compare ordinary LIST and live's pure projection. CronJob optional Events
			// may be attempted by the ordinary API, never by Live.
			clients, _, _ := m.clients.GetClientsForContext(context.Background(), "ctx")
			ordinary, err := tc.list(context.Background(), clients, "apps")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(resourceRows(t, ordinary), rows) {
				t.Fatalf("projection parity: %v != %v", ordinary, snap.Items)
			}
			events <- map[string]any{"type": "ADDED", "object": object("new", "a")}
			events <- map[string]any{"type": "DELETED", "object": object("first", "b")}
			awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.ResourceVersion == "b" })
			snap, _ = m.CachedResourceSnapshot("ctx", "apps", tc.kind)
			rows = resourceRows(t, snap.Items)
			if len(rows) != 1 || rows[0]["uid"] != "new" {
				t.Fatal("late UID delete removed replacement", rows)
			}
			a.Close()
			b.Close()
			snap, _ = m.CachedResourceSnapshot("ctx", "apps", tc.kind)
			if snap.Meta.Freshness != FreshnessClassStale {
				t.Fatal("released cache fresh")
			}
		})
	}
}
func TestResourceLiveSharedCapacityAndShutdown(t *testing.T) {
	m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	for i := 0; i < podLiveMaxCells; i++ {
		kind := ResourceKindPods
		if i%2 == 1 {
			kind = ResourceKindDeployments
		}
		s, err := m.SubscribeResourceLive(context.Background(), "ctx", fmt.Sprintf("ns-%d", i), kind)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
	}
	if _, err := m.SubscribeResourceLive(context.Background(), "ctx", "overflow", ResourceKindJobs); err != ErrPodLiveCapacity {
		t.Fatal(err)
	}
	m.ClosePodsLive()
	if m.liveCells != 0 || m.liveSubscribers != 0 {
		t.Fatal("leaked admission")
	}
	if _, err := m.SubscribeResourceLive(context.Background(), "late", "apps", ResourceKindCronJobs); err != ErrPodLiveUnavailable {
		t.Fatal(err)
	}
	m.mu.RLock()
	_, exists := m.planes["late"]
	m.mu.RUnlock()
	if exists {
		t.Fatal("shutdown created late plane")
	}
}
func TestResourceLiveEpochRejectsOldList(t *testing.T) {
	for _, tc := range workloadCases {
		t.Run(tc.resource, func(t *testing.T) {
			p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
			store := newNamespacedSnapshotStore[Snapshot[int]]()
			started, release := make(chan struct{}), make(chan struct{})
			done := make(chan Snapshot[int], 1)
			desc := namespacedSnapshotDescriptor[int]{kind: tc.kind, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
				close(started)
				<-release
				return []int{1}, nil
			}}
			go func() {
				s, _ := executeNamespacedSnapshot(p, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
				done <- s
			}()
			<-started
			mu, epochs, _ := p.resourceOwnership(tc.kind)
			if mu == &p.podPublishMu {
				t.Fatal("workload shares pod lock")
			}
			mu.Lock()
			*epochs = map[string]uint64{"apps": 2}
			setNamespacedSnapshot(&store, "apps", Snapshot[int]{Items: []int{2}, Meta: p.snapshotMetaHot(time.Now())})
			mu.Unlock()
			close(release)
			s := <-done
			if len(s.Items) != 1 || s.Items[0] != 2 {
				t.Fatal("obsolete list published", s)
			}
		})
	}
}
