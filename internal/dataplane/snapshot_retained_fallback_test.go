package dataplane

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

func TestSnapshotRetainedFallbackAfterSuccessfulList(t *testing.T) {
	for _, scope := range []string{"cluster", "services"} {
		t.Run(scope, func(t *testing.T) {
			for _, scenario := range []string{"retained", "retention_expired", "persistence_disabled", "persistence_unavailable"} {
				t.Run(scenario, func(t *testing.T) {
					sp, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = sp.Close() })
					policy := DefaultDataplanePolicy()
					policy.Persistence.Enabled = true
					policy.Persistence.MaxAgeHours = 1
					plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
					plane.policy = func() DataplanePolicy { return policy }
					plane.persistence = func() snapshotPersistence { return sp }
					scheduler := newWorkScheduler(1)
					scheduler.retries = 1 // The scheduler counts total attempts, not extra retries.
					listErr := errors.New("LIST failed")
					fetches := 0
					fetch := func() ([]int, error) {
						fetches++
						if fetches == 1 {
							return []int{42}, nil
						}
						return nil, listErr
					}
					// A short real TTL exercises success -> expiry -> failed LIST,
					// without seeding a restored snapshot or changing the happy-path cell.
					const ttl = time.Millisecond
					var run func() (Snapshot[int], error)
					var peek func() (Snapshot[int], bool)
					var set func(Snapshot[int])
					kind, namespace := ResourceKindNamespaces, ""
					if scope == "cluster" {
						store := &snapshotStore[Snapshot[int]]{}
						desc := clusterSnapshotDescriptor[int]{
							kind: kind, ttl: ttl, capResource: "namespaces", capScope: CapabilityScopeCluster,
							fetch: func(context.Context, *cluster.Clients) ([]int, error) { return fetch() },
						}
						run = func() (Snapshot[int], error) {
							return executeClusterSnapshot(plane, context.Background(), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, store, desc)
						}
						peek = func() (Snapshot[int], bool) { return peekClusterSnapshot(store) }
						set = func(snap Snapshot[int]) { setClusterSnapshot(store, snap) }
					} else {
						kind, namespace = ResourceKindServices, "app"
						if liveEnabled(kind) {
							t.Fatal("this regression must exercise a non-live namespaced kind")
						}
						store := newNamespacedSnapshotStore[Snapshot[int]]()
						desc := namespacedSnapshotDescriptor[int]{
							kind: kind, ttl: ttl, capResource: "services", capScope: CapabilityScopeNamespace,
							fetch: func(_ context.Context, _ *cluster.Clients, ns string) ([]int, error) {
								if ns != namespace {
									t.Fatalf("LIST namespace = %q, want %q", ns, namespace)
								}
								return fetch()
							},
						}
						run = func() (Snapshot[int], error) {
							return executeNamespacedSnapshot(plane, context.Background(), scheduler, WorkPriorityCritical, snapshotExecClientsProvider{}, namespace, &store, desc)
						}
						peek = func() (Snapshot[int], bool) { return peekNamespacedSnapshot(&store, namespace) }
						set = func(snap Snapshot[int]) { setNamespacedSnapshot(&store, namespace, snap) }
					}

					good, err := run()
					if err != nil || good.Err != nil || !reflect.DeepEqual(good.Items, []int{42}) || good.restored || good.Meta.Freshness != FreshnessClassHot {
						t.Fatalf("successful LIST = %+v, err=%v", good, err)
					}
					var saved Snapshot[int]
					if ok, err := sp.Load(plane.name, kind, namespace, &saved); err != nil || !ok || !reflect.DeepEqual(saved.Items, good.Items) || !saved.Meta.ObservedAt.Equal(good.Meta.ObservedAt) {
						t.Fatalf("successful LIST was not persisted: %+v, ok=%v, err=%v", saved, ok, err)
					}
					switch scenario {
					case "retention_expired":
						// Advance the observation's age, not just its freshness label.
						good.Meta.ObservedAt = time.Now().UTC().Add(-2 * time.Hour)
						set(good)
						if err := sp.Save(plane.name, kind, namespace, good); err != nil {
							t.Fatal(err)
						}
					case "persistence_disabled":
						policy.Persistence.Enabled = false
					case "persistence_unavailable":
						plane.persistence = nil
					}
					time.Sleep(2 * ttl)
					got, err := run()
					if !errors.Is(err, listErr) || got.Err == nil || *got.Err != NormalizeError(listErr) || fetches != 2 {
						t.Fatalf("failed LIST = %+v, err=%v, fetches=%d", got, err, fetches)
					}
					cached, ok := peek()
					if !ok || !reflect.DeepEqual(cached.Items, got.Items) || !cached.Meta.ObservedAt.Equal(got.Meta.ObservedAt) || cached.Meta.Freshness != got.Meta.Freshness || !reflect.DeepEqual(cached.Err, got.Err) {
						t.Fatalf("published fallback differs: cached=%+v, returned=%+v", cached, got)
					}
					if scenario != "retained" {
						if len(got.Items) != 0 || got.Meta.Freshness != FreshnessClassCold {
							t.Fatalf("ineligible last-good snapshot served: %+v", got)
						}
						return
					}
					if !reflect.DeepEqual(got.Items, good.Items) || !got.Meta.ObservedAt.Equal(good.Meta.ObservedAt) || got.Meta.Freshness != FreshnessClassStale || got.Meta.Degradation != DegradationClassMinor || got.Meta.Coverage != good.Meta.Coverage || got.Meta.Completeness != good.Meta.Completeness {
						t.Fatalf("last-good fallback lost rows or metadata: got=%+v, good=%+v", got, good)
					}
					// A second failed refresh must keep the original observation too.
					time.Sleep(2 * ttl)
					again, err := run()
					if !errors.Is(err, listErr) || fetches != 3 || !reflect.DeepEqual(again.Items, good.Items) || !again.Meta.ObservedAt.Equal(good.Meta.ObservedAt) || again.Meta.Freshness != FreshnessClassStale {
						t.Fatalf("repeated failure lost retained snapshot: %+v, err=%v, fetches=%d", again, err, fetches)
					}
				})
			}
		})
	}
}
