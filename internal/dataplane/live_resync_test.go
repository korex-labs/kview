package dataplane

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
)

// Fake time and in-process adapters exercise the real worker without wall-clock
// sleeps, network, or changing the production cooldown.
func TestResourceLiveTrailingResync(t *testing.T) {
	kinds := []ResourceKind{ResourceKindPods, ResourceKindDeployments, ResourceKindStatefulSets, ResourceKindDaemonSets, ResourceKindReplicaSets, ResourceKindJobs, ResourceKindCronJobs}
	for _, kind := range kinds {
		for _, duringList := range []bool{false, true} {
			for _, cancelTrailing := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/during-list=%t/cancel=%t", kind, duringList, cancelTrailing), func(t *testing.T) {
					synctest.Test(t, func(t *testing.T) {
						p := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
						m := &manager{clients: liveTestClients{c: &cluster.Clients{Clientset: &kubernetes.Clientset{}}}, scheduler: newWorkScheduler(1)}
						ctx, cancel := context.WithCancel(context.Background())
						defer cancel()
						sub := &podLiveSubscription{updates: make(chan PodLiveUpdate, 1)}
						cell := &podLiveCell{epoch: 1, resync: make(chan struct{}, 1), subscribers: map[*podLiveSubscription]struct{}{sub: {}}}
						mu, epochs, cells := p.resourceOwnership(kind)
						*epochs = map[string]uint64{"apps": 1}
						*cells = map[string]*podLiveCell{"apps": cell}
						a := resourceAdapter(kind)
						var lists atomic.Int32
						release := make(chan struct{})
						a.list = func(ctx context.Context, _ *cluster.Clients, _ string, _ metav1.ListOptions) (liveList, error) {
							n := lists.Add(1)
							if n == 2 {
								select {
								case <-release:
								case <-ctx.Done():
									return liveList{}, ctx.Err()
								}
							}
							return liveList{rv: fmt.Sprint(n)}, nil
						}
						a.watch = func(context.Context, *cluster.Clients, string, metav1.ListOptions) (watch.Interface, error) {
							return watch.NewRaceFreeFake(), nil
						}
						done := make(chan struct{})
						go func() { defer close(done); m.runResourceLive(ctx, p, "apps", cell, a) }()
						synctest.Wait()
						if lists.Load() != 1 || cell.update.Stale || cell.update.State != PodLiveLive {
							t.Fatalf("initial: lists=%d update=%+v", lists.Load(), cell.update)
						}
						invalidate := func() {
							mu.Lock()
							p.invalidateResourceLiveLocked("apps", cell, kind)
							mu.Unlock()
						}
						invalidate()
						synctest.Wait() // first requested LIST is gated, so stale must be visible
						if u := <-sub.updates; !u.Stale {
							t.Fatalf("refresh preceded stale notification: %+v", u)
						}
						if duringList {
							invalidate() // LIST #2 predates this invalidation.
						}
						close(release)
						synctest.Wait()
						if lists.Load() != 2 || cell.update.Stale != duringList {
							t.Fatalf("in-flight LIST freshness: lists=%d duringList=%t update=%+v", lists.Load(), duringList, cell.update)
						}
						if snap, ok := a.cached(p, "apps"); !ok || (snap.Meta.Freshness == FreshnessClassStale) != duringList {
							t.Fatalf("in-flight LIST cache freshness: duringList=%t meta=%+v", duringList, snap.Meta)
						}
						if duringList {
							// Neither an old watch publication nor transport reconnect
							// is a LIST covering the pending invalidation.
							for _, objects := range []map[string]liveObject{{}, nil} {
								p.publishResourceLive("apps", cell, PodLiveLive, "", "2", objects, a)
								snap, ok := a.cached(p, "apps")
								if !ok || !cell.update.Stale || snap.Meta.Freshness != FreshnessClassStale {
									t.Fatalf("watch/reconnect cleared pending invalidation: update=%+v meta=%+v", cell.update, snap.Meta)
								}
							}
						}
						for range 100 {
							invalidate()
						}
						synctest.Wait()
						if lists.Load() != 2 {
							t.Fatalf("cooldown bypassed: %d", lists.Load())
						}
						if u := <-sub.updates; !u.Stale {
							t.Fatalf("cooldown invalidation not delivered: %+v", u)
						}
						// More requests while the worker is waiting coalesce into that same LIST.
						for range 100 {
							invalidate()
						}
						if cancelTrailing {
							cancel()
							synctest.Wait()
							select {
							case <-done:
							default:
								t.Fatal("cancel did not stop waiting worker")
							}
						}
						time.Sleep(podLiveResyncInterval - time.Nanosecond)
						synctest.Wait()
						if lists.Load() != 2 {
							t.Fatalf("refresh before cooldown elapsed: %d", lists.Load())
						}
						time.Sleep(time.Nanosecond)
						synctest.Wait()
						if cancelTrailing {
							if lists.Load() != 2 {
								t.Fatalf("trailing refresh survived cancel: %d", lists.Load())
							}
						} else {
							if lists.Load() != 3 || cell.update.Stale || cell.update.State != PodLiveLive || cell.update.ResourceVersion != "3" {
								t.Fatalf("trailing refresh missing: %d %+v", lists.Load(), cell.update)
							}
							snap, ok := a.cached(p, "apps")
							if !ok || snap.Meta.Freshness == FreshnessClassStale {
								t.Fatalf("final cache stale: %+v", snap.Meta)
							}
							time.Sleep(podLiveResyncInterval)
							synctest.Wait()
							if lists.Load() != 3 {
								t.Fatalf("coalesced burst caused extra refresh: %d", lists.Load())
							}
						}
						cancel()
						synctest.Wait()
					})
				})
			}
		}
	}
}
