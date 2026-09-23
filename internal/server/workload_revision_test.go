package server

import (
	"context"
	"net/http"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Only the cache API is permitted through revision delivery. Overrides catch
// accidental plane admission (and hence disk hydration), metrics or observers.
type revisionOnlyDataplane struct {
	*stubDataplane
	t        *testing.T
	resource dataplane.ResourceKind
	calls    int
	found    bool
}

func (d *revisionOnlyDataplane) PlaneForCluster(context.Context, string) (dataplane.ClusterPlane, error) {
	d.t.Fatal("revision created/hydrated a plane")
	return nil, nil
}
func (d *revisionOnlyDataplane) EnsureObservers(context.Context, string) {
	d.t.Fatal("revision admitted observers")
}
func (d *revisionOnlyDataplane) PodMetricsCachedSnapshot(string, string) (dataplane.PodMetricsSnapshot, bool) {
	d.t.Fatal("workload revision read metrics")
	return dataplane.PodMetricsSnapshot{}, false
}
func (d *revisionOnlyDataplane) PodMetricsSnapshot(context.Context, string, string) (dataplane.PodMetricsSnapshot, error) {
	d.t.Fatal("workload revision hydrated metrics")
	return dataplane.PodMetricsSnapshot{}, nil
}
func (d *revisionOnlyDataplane) CachedResourceSnapshot(name, ns string, kind dataplane.ResourceKind) (dataplane.ResourceLiveSnapshot, bool) {
	d.calls++
	if name != "test-context" || ns != "apps" || kind != d.resource {
		d.t.Fatalf("wrong cache identity %s/%s/%s", name, ns, kind)
	}
	var items any
	switch kind {
	case dataplane.ResourceKindDeployments:
		items = []dto.DeploymentListItemDTO{}
	case dataplane.ResourceKindStatefulSets:
		items = []dto.StatefulSetDTO{}
	case dataplane.ResourceKindDaemonSets:
		items = []dto.DaemonSetDTO{}
	case dataplane.ResourceKindReplicaSets:
		items = []dto.ReplicaSetDTO{}
	case dataplane.ResourceKindJobs:
		items = []dto.JobDTO{}
	case dataplane.ResourceKindCronJobs:
		items = []dto.CronJobDTO{}
	}
	return dataplane.ResourceLiveSnapshot{Items: items}, d.found
}

func TestWorkloadLiveRevisionOnlyCacheAPI(t *testing.T) {
	for _, tc := range workloadLiveCases {
		t.Run(tc.resource, func(t *testing.T) {
			for _, found := range []bool{false, true} {
				s, _ := newTestServer(t)
				d := &revisionOnlyDataplane{stubDataplane: newStubDataplane(), t: t, resource: dataplane.ResourceKind(tc.resource), found: found}
				s.dp = d
				router := s.Router()
				rec := doReqWithHeader(t, router, "GET", "/api/namespaces/apps/"+tc.resource+"?refresh=revision", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
				want := http.StatusServiceUnavailable
				if found {
					want = http.StatusOK
				}
				if rec.Code != want || d.calls != 1 {
					t.Fatalf("revision found=%v status=%d cache calls=%d", found, rec.Code, d.calls)
				}
			}
		})
	}
}

type capacityResourceLiveDataplane struct{ *stubDataplane }

func (*capacityResourceLiveDataplane) SubscribeResourceLive(context.Context, string, string, dataplane.ResourceKind) (dataplane.ResourceLiveSubscription, error) {
	return nil, dataplane.ErrPodLiveCapacity
}
func TestWorkloadLiveHTTPCapacity(t *testing.T) {
	for _, tc := range workloadLiveCases {
		t.Run(tc.resource, func(t *testing.T) {
			s, router := newTestServer(t)
			s.dp = &capacityResourceLiveDataplane{newStubDataplane()}
			rec := doReqWithHeader(t, router, "GET", "/api/namespaces/apps/"+tc.resource+"/live", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("capacity status=%d", rec.Code)
			}
		})
	}
}
