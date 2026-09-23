package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func hardeningManager(t *testing.T, handler http.HandlerFunc) *manager {
	t.Helper()
	source := httptest.NewServer(handler)
	t.Cleanup(source.Close)
	client, err := kubernetes.NewForConfig(&rest.Config{Host: source.URL, QPS: 1000, Burst: 1000})
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled, policy.Observers.Enabled = false, false
	m := NewManager(ManagerConfig{Policy: policy}).(*manager)
	m.clients = liveTestClients{&cluster.Clients{Clientset: client}}
	t.Cleanup(m.ClosePodsLive)
	return m
}

func TestPodLiveSubscriptionCapacity(t *testing.T) {
	for _, mode := range []string{"cells", "per-cell", "global"} {
		t.Run(mode, func(t *testing.T) {
			m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
			count := podLiveMaxCells
			if mode == "per-cell" {
				count = podLiveMaxCellSubscribers
			}
			if mode == "global" {
				count = podLiveMaxSubscribers
			}
			for i := 0; i < count; i++ {
				ns := fmt.Sprintf("ns-%d", i)
				if mode == "per-cell" {
					ns = "apps"
				}
				if mode == "global" {
					ns = fmt.Sprintf("ns-%d", i/podLiveMaxCellSubscribers)
				}
				if _, err := m.SubscribePods(context.Background(), "ctx", ns); err != nil {
					t.Fatal(err)
				}
			}
			ns := "extra"
			if mode == "per-cell" {
				ns = "apps"
			}
			if _, err := m.SubscribePods(context.Background(), "ctx", ns); !errors.Is(err, ErrPodLiveCapacity) {
				t.Fatalf("expected capacity: %v", err)
			}
			m.ClosePodsLive()
			m.liveMu.Lock()
			defer m.liveMu.Unlock()
			if m.liveCells != 0 || m.liveSubscribers != 0 {
				t.Fatal("capacity leaked at shutdown")
			}
		})
	}
}

func TestPodLiveListCapacity(t *testing.T) {
	for _, mode := range []string{"objects", "bytes", "pagination"} {
		t.Run(mode, func(t *testing.T) {
			list := corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, ListMeta: metav1.ListMeta{ResourceVersion: "rv"}}
			switch mode {
			case "objects":
				list.Items = make([]corev1.Pod, podLiveMaxObjects+1)
			case "bytes":
				list.Items = []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "large", Annotations: map[string]string{"large": strings.Repeat("x", podLiveMaxBytes)}}}}
			case "pagination":
				list.Continue = "next"
			}
			// Exercise the actual client decoder with Kubernetes protobuf. Encoding
			// a 32 MiB annotation as JSON under -race dominates the state deadline
			// rather than testing the retained-object capacity guard.
			raw, err := list.Marshal()
			if err != nil {
				t.Fatal(err)
			}
			envelope := &runtime.Unknown{TypeMeta: runtime.TypeMeta{APIVersion: "v1", Kind: "PodList"}, Raw: raw}
			wire, err := envelope.Marshal()
			if err != nil {
				t.Fatal(err)
			}
			wire = append([]byte{'k', '8', 's', 0}, wire...)
			m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("watch") == "true" {
					t.Error("watch started after rejected list")
					return
				}
				w.Header().Set("Content-Type", "application/vnd.kubernetes.protobuf")
				_, _ = w.Write(wire)
			})
			sub, err := m.SubscribePods(context.Background(), "ctx", "apps")
			if err != nil {
				t.Fatal(err)
			}
			u := awaitPodUpdate(t, sub, func(u PodLiveUpdate) bool { return u.State == PodLiveBlocked })
			if u.Reason != "capacity exceeded" || !u.Stale {
				t.Fatalf("bad capacity state: %+v", u)
			}
			if _, ok := m.PodsCachedSnapshot("ctx", "apps"); ok {
				t.Fatal("published truncated list")
			}
		})
	}
}

func TestPodLiveWatchCapacity(t *testing.T) {
	for _, mode := range []string{"objects", "bytes"} {
		t.Run(mode, func(t *testing.T) {
			objects := map[string]*corev1.Pod{}
			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "extra", Namespace: "apps"}}
			if mode == "objects" {
				for i := 0; i < podLiveMaxObjects; i++ {
					name := fmt.Sprintf("pod-%d", i)
					objects[name] = &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: name}}
				}
			} else {
				pod.Annotations = map[string]string{"large": strings.Repeat("x", podLiveMaxBytes)}
			}
			w := watch.NewRaceFreeFake()
			defer w.Stop()
			w.Add(pod)
			rv := "initial"
			err := (&manager{}).consumePodWatch(context.Background(), nil, "apps", &podLiveCell{}, w, objects, &rv)
			if !errors.Is(err, ErrPodLiveCapacity) || rv != "initial" || objects["extra"] != nil {
				t.Fatalf("capacity mutation accepted: err=%v rv=%s", err, rv)
			}
		})
	}
}

func TestPodLiveResyncQueueBound(t *testing.T) {
	c := &podLiveCell{resync: make(chan struct{}, 1)}
	for range 1000 {
		c.requestResync()
	}
	if len(c.resync) != 1 {
		t.Fatal("requests not coalesced")
	}
	<-c.resync
	for _, state := range []PodLiveState{PodLiveBlocked, PodLiveStopped} {
		c.update.State = state
		c.requestResync()
		if len(c.resync) != 0 {
			t.Fatal("inactive worker accepted resync")
		}
	}
}

func TestPodLiveReconnectPreservesObservation(t *testing.T) {
	watches := make(chan struct{}, 2)
	disconnect := make(chan struct{})
	m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("watch") != "true" {
			_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, ListMeta: metav1.ListMeta{ResourceVersion: "rv"}})
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		watches <- struct{}{}
		select {
		case <-disconnect:
		case <-r.Context().Done():
		}
	})
	sub, err := m.SubscribePods(context.Background(), "ctx", "apps")
	if err != nil {
		t.Fatal(err)
	}
	initial := awaitPodUpdate(t, sub, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	<-watches
	disconnect <- struct{}{}
	stale := awaitPodUpdate(t, sub, func(u PodLiveUpdate) bool { return u.State == PodLiveReconnecting })
	resumed := awaitPodUpdate(t, sub, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	if !resumed.ObservedAt.Equal(initial.ObservedAt) || resumed.Revision != stale.Revision || !resumed.Stale {
		t.Fatalf("reconnect freshened retained rows: initial=%+v resumed=%+v", initial, resumed)
	}
	sub.Close()
	u := <-sub.Updates()
	if u.State != PodLiveStopped {
		t.Fatalf("missing final stopped: %+v", u)
	}
}

func TestPodLiveWatchCreationExpired(t *testing.T) {
	var lists, watches atomic.Int32
	m := hardeningManager(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("watch") != "true" {
			n := lists.Add(1)
			_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, ListMeta: metav1.ListMeta{ResourceVersion: fmt.Sprint(n)}})
			return
		}
		if watches.Add(1) == 1 {
			w.WriteHeader(410)
			_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Expired","code":410}`))
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	sub, err := m.SubscribePods(context.Background(), "ctx", "apps")
	if err != nil {
		t.Fatal(err)
	}
	u := awaitPodUpdate(t, sub, func(u PodLiveUpdate) bool { return u.State == PodLiveLive })
	if lists.Load() != 2 || u.ResourceVersion != "2" {
		t.Fatalf("creation 410 did not relist: lists=%d update=%+v", lists.Load(), u)
	}
}

func TestPodLiveOldFailedListCannotOverwriteReleasedCell(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	setNamespacedSnapshot(&store, "apps", Snapshot[int]{Items: []int{0}, Meta: p.snapshotMetaHot(time.Now().Add(-time.Hour))})
	started, release := make(chan struct{}), make(chan struct{})
	desc := namespacedSnapshotDescriptor[int]{kind: ResourceKindPods, capResource: "pods", capScope: CapabilityScopeNamespace, fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
		close(started)
		<-release
		return nil, errors.New("failed old list")
	}}
	done := make(chan Snapshot[int], 1)
	go func() {
		snap, _ := executeNamespacedSnapshot(p, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
		done <- snap
	}()
	<-started
	p.podPublishMu.Lock()
	// Claim and release occurred while the old LIST was in flight.
	p.podEpoch = map[string]uint64{"apps": 2}
	setNamespacedSnapshot(&store, "apps", Snapshot[int]{Items: []int{2}, Meta: p.snapshotMetaHot(time.Now())})
	p.podPublishMu.Unlock()
	close(release)
	got := <-done
	cached, _ := store.getCached("apps")
	if len(got.Items) != 1 || got.Items[0] != 2 || cached.Items[0] != 2 || got.Meta.Revision != cached.Meta.Revision {
		t.Fatalf("failed old LIST overwrote released cell: %+v", got)
	}
}

func TestPodLiveDirtyErrorExitAndObsoleteWorker(t *testing.T) {
	p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	cell := &podLiveCell{epoch: 1, resync: make(chan struct{}, 1)}
	p.podLive = map[string]*podLiveCell{"apps": cell}
	p.podEpoch = map[string]uint64{"apps": 1}
	w := watch.NewRaceFreeFake()
	defer w.Stop()
	w.Add(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "apps", ResourceVersion: "new"}})
	w.Error(&metav1.Status{Status: "Failure", Reason: metav1.StatusReasonForbidden, Code: 403})
	rv := "old"
	err := (&manager{}).consumePodWatch(context.Background(), p, "apps", cell, w, map[string]*corev1.Pod{}, &rv)
	if err == nil {
		t.Fatal("missing watch error")
	}
	snap, ok := p.podsStore.getCached("apps")
	if !ok || len(snap.Items) != 1 || snap.Meta.Freshness != FreshnessClassStale {
		t.Fatalf("dirty event lost before error: %+v", snap)
	}
	p.podEpoch["apps"]++
	p.publishPodLive("apps", cell, PodLiveLive, "", "obsolete", map[string]*corev1.Pod{})
	after, _ := p.podsStore.getCached("apps")
	if after.Meta.Revision != snap.Meta.Revision {
		t.Fatal("obsolete worker published")
	}
}
