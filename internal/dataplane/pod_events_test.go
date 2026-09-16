package dataplane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func podEventsTestManager(t *testing.T, handler http.HandlerFunc) *manager {
	t.Helper()
	source := httptest.NewServer(handler)
	t.Cleanup(source.Close)
	client, err := kubernetes.NewForConfig(&rest.Config{Host: source.URL})
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = false
	policy.Observers.Enabled = false
	policy.Metrics.Enabled = false
	m := NewManager(ManagerConfig{Policy: policy}).(*manager)
	m.clients = liveTestClients{&cluster.Clients{Clientset: client}}
	m.scheduler = newWorkScheduler(8)
	m.scheduler.retries = 1
	t.Cleanup(m.ClosePodsLive)
	return m
}

func writePodEventsTestPod(w http.ResponseWriter, ns, uid, phase string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, ListMeta: metav1.ListMeta{ResourceVersion: "1"}, Items: []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "pod", UID: types.UID(uid)}, Status: corev1.PodStatus{Phase: corev1.PodPhase(phase)}}}})
}

func writePodEventsTestEvent(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = fmt.Fprint(w, `{"apiVersion":"v1","kind":"EventList","items":[{"metadata":{"name":"event","namespace":"app"},"involvedObject":{"kind":"Pod","namespace":"app","name":"pod","uid":"uid-1"},"type":"Warning","reason":"BackOff","lastTimestamp":"2026-09-16T10:00:00Z"}]}`)
}

func waitPodEventsJobs(t *testing.T, m *manager, name string) {
	t.Helper()
	plane, _ := m.PlaneForCluster(context.Background(), name)
	p := plane.(*clusterPlane)
	deadline := time.Now().Add(3 * time.Second)
	for {
		p.podPublishMu.Lock()
		n := len(p.podEventsJobs)
		p.podPublishMu.Unlock()
		if n == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("Events jobs leaked: %d", n)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestPodEventsOptionalFailureAndKnownEmpty(t *testing.T) {
	for _, code := range []int{http.StatusForbidden, http.StatusInternalServerError, http.StatusOK} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			var events, pods atomic.Int32
			m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/pods") {
					pods.Add(1)
					writePodEventsTestPod(w, "app", "uid-1", "Running")
					return
				}
				if !strings.HasSuffix(r.URL.Path, "/events") {
					http.NotFound(w, r)
					return
				}
				events.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(code)
				if code == http.StatusOK {
					_, _ = fmt.Fprint(w, `{"apiVersion":"v1","kind":"EventList","items":[]}`)
				} else {
					_, _ = fmt.Fprintf(w, `{"apiVersion":"v1","kind":"Status","status":"Failure","reason":"Forbidden","code":%d}`, code)
				}
			})
			original, err := m.PodsSnapshot(context.Background(), "ctx", "app")
			if err != nil || original.Err != nil || len(original.Items) != 1 {
				t.Fatalf("Pods lost to optional failure: %+v %v", original, err)
			}
			waitPodEventsJobs(t, m, "ctx")
			snap, _ := m.PodsCachedSnapshot("ctx", "app")
			if snap.Err != nil || snap.Meta.Freshness != FreshnessClassHot || !snap.Meta.ObservedAt.Equal(original.Meta.ObservedAt) || len(snap.Items) != 1 || snap.Items[0].LastEvent != nil {
				t.Fatalf("optional result changed authoritative Pods: %+v", snap)
			}
			if code == http.StatusOK {
				if snap.Items[0].EventsObservedAt == 0 || snap.Meta.Revision <= original.Meta.Revision {
					t.Fatal("successful empty Events must be distinguishable from unknown")
				}
			} else if snap.Items[0].EventsObservedAt != 0 || snap.Meta.Revision != original.Meta.Revision {
				t.Fatal("failed Events invented availability/revision")
			}
			for range 5 {
				_, _ = m.PodsSnapshot(context.Background(), "ctx", "app")
			}
			waitPodEventsJobs(t, m, "ctx")
			if events.Load() != 1 || pods.Load() != 1 {
				t.Fatalf("cache hit retried sources: pods=%d events=%d", pods.Load(), events.Load())
			}
		})
	}
}

func TestPodEventsNotAdmittedAfterSourceFailureOrCancellation(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelled), func(t *testing.T) {
			var events atomic.Int32
			m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/events") {
					events.Add(1)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = fmt.Fprint(w, `{"apiVersion":"v1","kind":"Status","status":"Failure","reason":"Forbidden","code":403}`)
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if cancelled {
				cancel()
			}
			snap, err := m.PodsSnapshot(ctx, "ctx", "app")
			if err == nil || len(snap.Items) != 0 {
				t.Fatalf("source failure became success: %+v %v", snap, err)
			}
			waitPodEventsJobs(t, m, "ctx")
			if events.Load() != 0 {
				t.Fatal("Pods failure initiated Events")
			}
		})
	}
}

func TestPodEventsGatedMergePreservesNewRowsAndUID(t *testing.T) {
	for _, replace := range []bool{false, true} {
		t.Run(fmt.Sprint(replace), func(t *testing.T) {
			started, release := make(chan struct{}, 1), make(chan struct{})
			var once sync.Once
			var updated atomic.Bool
			var eventReads atomic.Int32
			m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/pods") {
					uid, phase := "uid-1", "Running"
					if updated.Load() {
						phase = "Failed"
						if replace {
							uid = "uid-2"
						}
					}
					writePodEventsTestPod(w, "app", uid, phase)
					return
				}
				eventReads.Add(1)
				started <- struct{}{}
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
				writePodEventsTestEvent(w)
			})
			defer once.Do(func() { close(release) })
			ctx, cancel := context.WithCancel(context.Background())
			original, err := m.PodsSnapshot(ctx, "ctx", "app")
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("Events not started")
			}
			cancel() // A completed request does not cancel admitted cache enrichment.
			updated.Store(true)
			newer, err := m.PodsSnapshot(WithPodManualRefresh(context.Background()), "ctx", "app")
			if err != nil || newer.Items[0].Phase != "Failed" {
				t.Fatalf("manual Pods blocked/lost: %+v %v", newer, err)
			}
			once.Do(func() { close(release) })
			waitPodEventsJobs(t, m, "ctx")
			final, _ := m.PodsCachedSnapshot("ctx", "app")
			if len(final.Items) != 1 || final.Items[0].Phase != "Failed" || !final.Meta.ObservedAt.Equal(newer.Meta.ObservedAt) {
				t.Fatalf("Events overwrote newer Pod observation: %+v", final)
			}
			if original.Items[0].LastEvent != nil || newer.Items[0].LastEvent != nil || original.Items[0].EventsObservedAt != 0 {
				t.Fatal("published slices were mutated")
			}
			if replace {
				if final.Items[0].UID != "uid-2" || final.Items[0].LastEvent != nil || final.Items[0].EventsObservedAt != 0 || final.Meta.Revision != newer.Meta.Revision {
					t.Fatal("old Events crossed replacement UID")
				}
			} else if final.Items[0].LastEvent == nil || final.Items[0].EventsObservedAt == 0 || final.Meta.Revision <= newer.Meta.Revision {
				t.Fatal("surviving UID not enriched")
			}
			if eventReads.Load() != 1 {
				t.Fatal("in-flight Events not deduplicated")
			}
		})
	}
}

func TestPodEventsBoundedAndShutdownCancelled(t *testing.T) {
	var started atomic.Int32
	m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pods") {
			parts := strings.Split(r.URL.Path, "/")
			writePodEventsTestPod(w, parts[4], "uid-1", "Running")
			return
		}
		started.Add(1)
		<-r.Context().Done()
	})
	for i := 0; i < podEventsMaxJobs+4; i++ {
		if _, err := m.PodsSnapshot(context.Background(), "ctx", fmt.Sprintf("app-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	plane, _ := m.PlaneForCluster(context.Background(), "ctx")
	p := plane.(*clusterPlane)
	p.podPublishMu.Lock()
	n := len(p.podEventsJobs)
	p.podPublishMu.Unlock()
	if n != podEventsMaxJobs {
		t.Fatalf("bounded admissions=%d", n)
	}
	m.ClosePodsLive()
	waitPodEventsJobs(t, m, "ctx")
	if started.Load() > podEventsMaxJobs {
		t.Fatal("too many requests")
	}
	for i := 0; i < podEventsMaxJobs+4; i++ {
		snap, _ := m.PodsCachedSnapshot("ctx", fmt.Sprintf("app-%d", i))
		if snap.Items[0].EventsObservedAt != 0 || snap.Items[0].LastEvent != nil {
			t.Fatal("cancelled Events published evidence")
		}
	}
}

func TestPodEventsLiveTakeoverCancelsEnrichment(t *testing.T) {
	started, cancelled := make(chan struct{}, 1), make(chan struct{}, 1)
	m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/events") {
			started <- struct{}{}
			<-r.Context().Done()
			cancelled <- struct{}{}
			return
		}
		if r.URL.Query().Get("watch") == "true" {
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		writePodEventsTestPod(w, "app", "uid-1", "Running")
	})
	if _, err := m.PodsSnapshot(context.Background(), "ctx", "app"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("Events not started")
	}
	sub, err := m.SubscribePods(context.Background(), "ctx", "app")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("Live takeover did not cancel optional Events")
	}
	waitPodEventsJobs(t, m, "ctx")
	snap, _ := m.PodsCachedSnapshot("ctx", "app")
	if snap.Items[0].LastEvent != nil || snap.Items[0].EventsObservedAt != 0 {
		t.Fatal("superseded Events published")
	}
}
