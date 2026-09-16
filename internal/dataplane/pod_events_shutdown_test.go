package dataplane

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestPodEventsShutdownDuringPlaneInitialization(t *testing.T) {
	for _, history := range []bool{false, true} {
		name := "snapshots"
		if history {
			name = "history"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			source := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				writePodEventsTestEvent(w)
			})
			m, gated := startupPlaneManager(t)
			m.clients, m.scheduler = source.clients, source.scheduler
			gated.history = history
			pending := startupLookup(m, context.Background(), "slow")
			startupAwait(t, gated.started)
			var release sync.Once
			defer release.Do(func() { close(gated.release) })
			closed := make(chan struct{})
			go func() { m.ClosePodsLive(); close(closed) }()
			startupAwait(t, closed)
			release.Do(func() { close(gated.release) })
			initialized := startupAwait(t, pending)
			for _, contextName := range []string{"slow", "new-after-shutdown"} {
				plane, err := m.PlaneForCluster(context.Background(), contextName)
				if err != nil || plane == nil {
					t.Fatalf("local initialization changed: %v", err)
				}
				if contextName == "slow" && plane != initialized {
					t.Fatal("plane identity changed")
				}
				p := plane.(*clusterPlane)
				p.podPublishMu.Lock()
				setNamespacedSnapshot(&p.podsStore, "app", PodsSnapshot{Items: []dto.PodListItemDTO{{Namespace: "app", Name: "pod", UID: "uid-1"}}, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()}})
				before, _ := p.podsStore.getCached("app")
				p.refreshPodEventsLocked(context.Background(), m.scheduler, m.clients, "app")
				admitted := len(p.podEventsJobs)
				p.podPublishMu.Unlock()
				if admitted != 0 {
					t.Errorf("%s admitted %d Events jobs after shutdown", contextName, admitted)
				}
				waitPodEventsJobs(t, m, contextName)
				after, _ := m.PodsCachedSnapshot(contextName, "app")
				if calls.Load() != 0 {
					t.Errorf("%s admitted upstream Events after shutdown: %d", contextName, calls.Load())
				}
				if after.Meta.Revision != before.Meta.Revision || after.Items[0].EventsObservedAt != 0 {
					t.Error("shutdown Events changed cache")
				}
			}
		})
	}
}

func TestPodEventsContextInheritsSynchronousShutdown(t *testing.T) {
	type key struct{}
	request, endRequest := context.WithCancel(context.WithValue(context.Background(), key{}, "request-value"))
	parent, shutdown := context.WithCancel(context.Background())
	defer shutdown()
	job, cancel := context.WithTimeout(podEventsContext{Context: parent, values: context.WithoutCancel(request)}, podEventsTimeout)
	defer cancel()
	endRequest()
	if job.Err() != nil || job.Value(key{}) != "request-value" {
		t.Fatal("request completion cancelled work or lost attribution")
	}
	shutdown()
	// No polling: manager shutdown must synchronously cancel admitted children.
	if job.Err() != context.Canceled {
		t.Fatal("shutdown did not synchronously cancel job")
	}
}

func TestPodEventsShutdownCancelsRunningRequest(t *testing.T) {
	started, cancelled, returned := make(chan struct{}), make(chan struct{}), make(chan struct{})
	m := podEventsTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pods") {
			writePodEventsTestPod(w, "app", "uid-1", "Running")
			return
		}
		close(started)
		<-r.Context().Done()
		close(cancelled)
		// A late upstream success must not turn cancellation into evidence.
		writePodEventsTestEvent(w)
		close(returned)
	})
	before, err := m.PodsSnapshot(context.Background(), "ctx", "app")
	if err != nil {
		t.Fatal(err)
	}
	startupAwait(t, started)
	m.ClosePodsLive()
	startupAwait(t, cancelled)
	startupAwait(t, returned)
	waitPodEventsJobs(t, m, "ctx")
	after, _ := m.PodsCachedSnapshot("ctx", "app")
	if after.Meta.Revision != before.Meta.Revision || after.Items[0].LastEvent != nil || after.Items[0].EventsObservedAt != 0 {
		t.Fatal("late shutdown result published")
	}
}
