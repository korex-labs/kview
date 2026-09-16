package dataplane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type liveTestClients struct{ c *cluster.Clients }

func (p liveTestClients) GetClientsForContext(_ context.Context, name string) (*cluster.Clients, string, error) {
	return p.c, name, nil
}
func awaitPodUpdate(t *testing.T, s PodLiveSubscription, match func(PodLiveUpdate) bool) PodLiveUpdate {
	t.Helper()
	// Large payload capacity checks take longer under the race detector.
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case u, ok := <-s.Updates():
			if !ok {
				t.Fatal("subscription closed")
			}
			t.Logf("pod live update: state=%s reason=%q stale=%v revision=%d", u.State, u.Reason, u.Stale, u.Revision)
			if match(u) {
				return u
			}
		case <-timer.C:
			t.Fatal("timed out waiting for pod state")
		}
	}
}
func TestPodLiveSharedUIDExpiredDeniedAndCleanup(t *testing.T) {
	var lists, watches, other atomic.Int32
	var denied atomic.Bool
	events := make(chan map[string]any, 10)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/apps/pods" {
			other.Add(1)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("watch") != "true" {
			lists.Add(1)
			_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, ListMeta: metav1.ListMeta{ResourceVersion: "initial"}, Items: []corev1.Pod{}})
			return
		}
		watches.Add(1)
		if denied.Load() {
			w.WriteHeader(403)
			_, _ = fmt.Fprint(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`)
			return
		}
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
	}))
	defer source.Close()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: source.URL})
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	policy.Observers.Enabled = false
	m := NewManager(ManagerConfig{Policy: policy}).(*manager)
	m.clients = liveTestClients{&cluster.Clients{Clientset: client}}
	defer m.ClosePodsLive()
	a, err := m.SubscribePods(context.Background(), "ctx", "apps")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := m.SubscribePods(context.Background(), "ctx", "apps")
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	initial := awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	if initial.Revision == 0 || initial.Stale {
		t.Fatalf("invalid initial state: %+v", initial)
	}
	awaitPodUpdate(t, b, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	if lists.Load() != 1 || watches.Load() != 1 {
		t.Fatalf("not shared: lists=%d watches=%d", lists.Load(), watches.Load())
	}
	event := func(kind, uid, rv string) map[string]any {
		return map[string]any{"type": kind, "object": map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]string{"name": "api", "namespace": "apps", "uid": uid, "resourceVersion": rv}}}
	}
	events <- event("ADDED", "old", "opaque-a")
	events <- event("ADDED", "new", "opaque-b")
	events <- event("DELETED", "old", "opaque-c")
	updated := awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.ResourceVersion == "opaque-c" })
	snap, ok := m.PodsCachedSnapshot("ctx", "apps")
	if !ok || len(snap.Items) != 1 || snap.Items[0].UID != "new" || snap.Meta.Revision != updated.Revision {
		t.Fatalf("replacement lost or revision not committed: %+v", snap)
	}
	// Slow subscriber never blocks mutations; only the newest notification remains.
	if len(b.(*podLiveSubscription).updates) > 1 {
		t.Fatal("unbounded subscriber")
	}
	events <- map[string]any{"type": "ERROR", "object": map[string]any{"apiVersion": "v1", "kind": "Status", "status": "Failure", "reason": "Expired", "code": 410}}
	awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.State == PodLiveReconnecting })
	awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	if lists.Load() != 2 {
		t.Fatalf("410 did not relist: %d", lists.Load())
	}
	denied.Store(true)
	if _, err = m.PodsSnapshot(WithPodManualRefresh(context.Background()), "ctx", "apps"); err != nil {
		t.Fatal(err)
	}
	awaitPodUpdate(t, a, func(u PodLiveUpdate) bool { return u.State == PodLiveBlocked })
	count := watches.Load()
	time.Sleep(100 * time.Millisecond)
	if watches.Load() != count {
		t.Fatal("denied watch retried")
	}
	if other.Load() != 0 {
		t.Fatal("watch fetched events/other resources")
	}
	a.Close()
	b.Close()
	m.liveMu.Lock()
	cells, subs := m.liveCells, m.liveSubscribers
	m.liveMu.Unlock()
	if cells != 0 || subs != 0 {
		t.Fatalf("leaked leases: cells=%d subscribers=%d", cells, subs)
	}
	snap, _ = m.PodsCachedSnapshot("ctx", "apps")
	if snap.Meta.Freshness != FreshnessClassStale {
		t.Fatal("release did not expire cache")
	}
}

func TestPodLiveOldListCannotOverwriteOwnedCell(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	sched := newWorkScheduler(1)
	started, release := make(chan struct{}), make(chan struct{})
	desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, capResource: "pods", capScope: CapabilityScopeNamespace, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
		close(started)
		<-release
		return []int{1}, nil
	}}
	result := make(chan Snapshot[int], 1)
	go func() {
		snap, _ := executeNamespacedSnapshot(p, context.Background(), sched, WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
		result <- snap
	}()
	<-started
	p.podPublishMu.Lock()
	p.podEpoch = map[string]uint64{"apps": 1}
	p.podLive = map[string]*podLiveCell{"apps": {epoch: 1}}
	setNamespacedSnapshot(&store, "apps", Snapshot[int]{Items: []int{2}, Meta: p.snapshotMetaHot(time.Now())})
	p.podPublishMu.Unlock()
	close(release)
	got := <-result
	cached, _ := store.getCached("apps")
	if len(got.Items) != 1 || got.Items[0] != 2 || cached.Items[0] != 2 || got.Meta.Revision != cached.Meta.Revision {
		t.Fatalf("old LIST won: returned=%+v cached=%+v", got, cached)
	}
}

func TestPodLiveLatestNotificationBound(t *testing.T) {
	ch := make(chan PodLiveUpdate, 1)
	for i := uint64(1); i <= 1000; i++ {
		latestPodUpdate(ch, PodLiveUpdate{Revision: i})
	}
	if len(ch) != 1 || (<-ch).Revision != 1000 {
		t.Fatal("did not coalesce to latest")
	}
}
