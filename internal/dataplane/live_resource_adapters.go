package dataplane

import (
	"context"
	"sync"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/cronjobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/daemonsets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	"github.com/korex-labs/kview/v5/internal/kube/resource/jobs"
	"github.com/korex-labs/kview/v5/internal/kube/resource/pods"
	"github.com/korex-labs/kview/v5/internal/kube/resource/replicasets"
	"github.com/korex-labs/kview/v5/internal/kube/resource/statefulsets"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
)

// ResourceLiveSnapshot keeps the existing concrete DTO slice in Items. It is an
// exact cache read, not a fetch or an observer admission surface.
type ResourceLiveSnapshot struct {
	Items                any
	Meta                 SnapshotMetadata
	Err                  *NormalizedError
	Relationships        []dto.ResourceRelationshipRecord
	RelationshipMetadata *dto.ResourceRelationshipSnapshotMetadata
}
type ResourceLiveUpdate = PodLiveUpdate
type ResourceLiveSubscription = PodLiveSubscription

type liveObject interface {
	metav1.Object
	runtime.Object
	Size() int
}
type liveList struct {
	items            []liveObject
	rv, continuation string
}
type resourceLiveAdapter struct {
	kind            ResourceKind
	group, resource string
	list            func(context.Context, *cluster.Clients, string, metav1.ListOptions) (liveList, error)
	watch           func(context.Context, *cluster.Clients, string, metav1.ListOptions) (watch.Interface, error)
	valid           func(runtime.Object) bool
	publish         func(*clusterPlane, string, []liveObject)
	cached          func(*clusterPlane, string) (ResourceLiveSnapshot, bool)
	stale           func(*clusterPlane, string)
}
type resourceLiveOwnership struct {
	mu     sync.Mutex
	epochs map[string]uint64
	cells  map[string]*podLiveCell
}

// Stable per-kind locks; the map lock is never held during publication or I/O.
func (p *clusterPlane) resourceOwnership(kind ResourceKind) (*sync.Mutex, *map[string]uint64, *map[string]*podLiveCell) {
	if !liveEnabled(kind) {
		return nil, nil, nil
	}
	if kind == ResourceKindPods {
		return &p.podPublishMu, &p.podEpoch, &p.podLive
	}
	p.resourceLiveMu.Lock()
	defer p.resourceLiveMu.Unlock()
	if p.resourceLive == nil {
		p.resourceLive = make(map[ResourceKind]*resourceLiveOwnership)
	}
	state := p.resourceLive[kind]
	if state == nil {
		state = &resourceLiveOwnership{}
		p.resourceLive[kind] = state
	}
	return &state.mu, &state.epochs, &state.cells
}
func liveEnabled(kind ResourceKind) bool {
	switch kind {
	case ResourceKindPods, ResourceKindDeployments, ResourceKindStatefulSets, ResourceKindDaemonSets, ResourceKindReplicaSets, ResourceKindJobs, ResourceKindCronJobs:
		return true
	}
	return false
}
func liveCache[I any](store *namespacedSnapshotStore[Snapshot[I]], ns string) (ResourceLiveSnapshot, bool) {
	s, ok := store.getCached(ns)
	return ResourceLiveSnapshot{Items: s.Items, Meta: s.Meta, Err: s.Err, Relationships: s.Relationships, RelationshipMetadata: s.RelationshipMetadata}, ok
}
func liveStale[I any](store *namespacedSnapshotStore[Snapshot[I]], ns string) {
	if s, ok := store.getCached(ns); ok && s.Meta.Freshness != FreshnessClassStale {
		s.Meta.Freshness = FreshnessClassStale
		setNamespacedSnapshot(store, ns, s)
	}
}
func livePublish[I any](p *clusterPlane, store *namespacedSnapshotStore[Snapshot[I]], ns string, items []I, labels bool) {
	s := Snapshot[I]{Items: items, Meta: p.snapshotMetaHot(time.Now().UTC())}
	families := []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference}
	if labels {
		families = append(families, dto.ResourceRelationshipFamilyLabels)
	}
	s.Relationships, s.RelationshipMetadata = normalizeSnapshotRelationships(items, dto.ExtractResourceRelationships[I], families)
	setNamespacedSnapshot(store, ns, s)
}
func resourceAdapter(kind ResourceKind) resourceLiveAdapter {
	switch kind {
	case ResourceKindPods:
		return resourceLiveAdapter{kind: kind, group: "", resource: "pods",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.CoreV1().Pods(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.CoreV1().Pods(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*corev1.Pod); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]corev1.Pod, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*corev1.Pod))
				}
				livePublish(p, &p.podsStore, ns, pods.MapPodListItems(items, nil, time.Now()), true)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.podsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.podsStore, ns) },
		}
	case ResourceKindDeployments:
		return resourceLiveAdapter{kind: kind, group: "apps", resource: "deployments",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.AppsV1().Deployments(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.AppsV1().Deployments(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*appsv1.Deployment); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]appsv1.Deployment, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*appsv1.Deployment))
				}
				livePublish(p, &p.depsStore, ns, deployments.MapDeployments(items, time.Now()), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.depsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.depsStore, ns) },
		}
	case ResourceKindStatefulSets:
		return resourceLiveAdapter{kind: kind, group: "apps", resource: "statefulsets",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.AppsV1().StatefulSets(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.AppsV1().StatefulSets(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*appsv1.StatefulSet); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]appsv1.StatefulSet, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*appsv1.StatefulSet))
				}
				livePublish(p, &p.stsStore, ns, statefulsets.MapStatefulSets(items, time.Now()), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.stsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.stsStore, ns) },
		}
	case ResourceKindDaemonSets:
		return resourceLiveAdapter{kind: kind, group: "apps", resource: "daemonsets",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.AppsV1().DaemonSets(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.AppsV1().DaemonSets(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*appsv1.DaemonSet); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]appsv1.DaemonSet, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*appsv1.DaemonSet))
				}
				livePublish(p, &p.dsStore, ns, daemonsets.MapDaemonSets(items, time.Now()), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.dsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.dsStore, ns) },
		}
	case ResourceKindReplicaSets:
		return resourceLiveAdapter{kind: kind, group: "apps", resource: "replicasets",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.AppsV1().ReplicaSets(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.AppsV1().ReplicaSets(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*appsv1.ReplicaSet); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]appsv1.ReplicaSet, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*appsv1.ReplicaSet))
				}
				livePublish(p, &p.rsStore, ns, replicasets.MapReplicaSets(items, time.Now()), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.rsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.rsStore, ns) },
		}
	case ResourceKindJobs:
		return resourceLiveAdapter{kind: kind, group: "batch", resource: "jobs",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.BatchV1().Jobs(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.BatchV1().Jobs(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*batchv1.Job); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]batchv1.Job, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*batchv1.Job))
				}
				livePublish(p, &p.jobsStore, ns, jobs.MapJobs(items, time.Now()), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.jobsStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.jobsStore, ns) },
		}
	case ResourceKindCronJobs:
		return resourceLiveAdapter{kind: kind, group: "batch", resource: "cronjobs",
			list: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (liveList, error) {
				result, err := c.Clientset.BatchV1().CronJobs(ns).List(ctx, opts)
				if err != nil {
					return liveList{}, err
				}
				out := liveList{rv: result.ResourceVersion, continuation: result.Continue, items: make([]liveObject, 0, len(result.Items))}
				for i := range result.Items {
					out.items = append(out.items, &result.Items[i])
				}
				return out, nil
			},
			watch: func(ctx context.Context, c *cluster.Clients, ns string, opts metav1.ListOptions) (watch.Interface, error) {
				return c.Clientset.BatchV1().CronJobs(ns).Watch(ctx, opts)
			},
			valid: func(obj runtime.Object) bool { _, ok := obj.(*batchv1.CronJob); return ok },
			publish: func(p *clusterPlane, ns string, objects []liveObject) {
				items := make([]batchv1.CronJob, 0, len(objects))
				for _, obj := range objects {
					items = append(items, *obj.(*batchv1.CronJob))
				}
				livePublish(p, &p.cjStore, ns, cronjobs.MapCronJobs(items, time.Now(), nil), false)
			},
			cached: func(p *clusterPlane, ns string) (ResourceLiveSnapshot, bool) { return liveCache(&p.cjStore, ns) },
			stale:  func(p *clusterPlane, ns string) { liveStale(&p.cjStore, ns) },
		}
	}
	return resourceLiveAdapter{}
}
