package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type podInstanceMetricsDataplane struct {
	*stubDataplane
	pods    dataplane.PodsSnapshot
	metrics dataplane.PodMetricsSnapshot
}

func (d *podInstanceMetricsDataplane) PodsCachedSnapshot(ctx, ns string) (dataplane.PodsSnapshot, bool) {
	if ctx != "test-context" || ns != "apps" {
		panic("wrong pod scope")
	}
	return d.pods, true
}
func (d *podInstanceMetricsDataplane) PodMetricsCachedSnapshot(ctx, ns string) (dataplane.PodMetricsSnapshot, bool) {
	if ctx != "test-context" || ns != "apps" {
		panic("wrong metrics scope")
	}
	return d.metrics, true
}

func TestPodRevisionDoesNotAttachReplacedInstanceMetrics(t *testing.T) {
	for _, uidPresent := range []bool{true, false} {
		name := "metrics-server-without-UID"
		if uidPresent {
			name = "explicit-UID"
		}
		t.Run(name, func(t *testing.T) {
			s, _ := newTestServer(t)
			now := time.Now().Unix()
			pod := dto.PodListItemDTO{UID: "A", Name: "api", Namespace: "apps", CreatedAt: now - 600, Phase: "Running", Ready: "1/1", CPULimitMilli: 100, MemoryLimitBytes: 100}
			sample := dto.PodMetricsDTO{Name: "api", Namespace: "apps", CapturedAt: now - 120, WindowSec: 30, Containers: []dto.ContainerMetricsDTO{{Name: "app", CPUMilli: 110, MemoryBytes: 110}}}
			if uidPresent {
				sample.UID = "A"
			}
			d := &podInstanceMetricsDataplane{stubDataplane: &stubDataplane{policy: dataplane.DefaultDataplanePolicy()}, pods: dataplane.PodsSnapshot{Items: []dto.PodListItemDTO{pod}}, metrics: dataplane.PodMetricsSnapshot{Items: []dto.PodMetricsDTO{sample}}}
			s.dp = d
			router := s.Router()
			read := func() dto.PodListItemDTO {
				t.Helper()
				r := doReqWithHeader(t, router, http.MethodGet, "/api/namespaces/apps/pods?refresh=revision", map[string]string{"Authorization": "Bearer " + testToken, "X-Kview-Context": "test-context"}, nil)
				if r.Code != http.StatusOK {
					t.Fatalf("status=%d: %s", r.Code, r.Body.String())
				}
				var body struct {
					Items []dto.PodListItemDTO `json:"items"`
				}
				if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if len(body.Items) != 1 {
					t.Fatalf("items=%+v", body.Items)
				}
				return body.Items[0]
			}
			a := read()
			if !a.UsageAvailable || a.CPUMilli != 110 || a.MemoryBytes != 110 || a.ListSignalCount == 0 {
				t.Fatalf("A should retain usage and near-limit signal: %+v", a)
			}
			// Live publication replaces the pod only. Metrics remains the exact A sample.
			d.pods.Items[0].UID = "B"
			d.pods.Items[0].CreatedAt = now - 60
			b := read()
			if b.UID != "B" || b.UsageAvailable || b.CPUMilli != 0 || b.MemoryBytes != 0 || b.CPUPctLimit != 0 || b.MemoryPctLimit != 0 || b.ListSignalCount != 0 || b.ListSignalSeverity != "ok" {
				t.Fatalf("B inherited A metrics/signals: %+v", b)
			}
			if d.metrics.Items[0].CapturedAt != sample.CapturedAt || d.pods.Items[0].UsageAvailable {
				t.Fatal("enrichment mutated source cache")
			}
			// Only an independently advanced sample proven to belong to B restores usage.
			d.metrics.Items[0].CapturedAt = now - 10
			d.metrics.Items[0].WindowSec = 15
			if uidPresent {
				d.metrics.Items[0].UID = "B"
			}
			b = read()
			if !b.UsageAvailable || b.CPUMilli != 110 || b.MemoryBytes != 110 || b.ListSignalCount == 0 {
				t.Fatalf("B lost proven new metrics: %+v", b)
			}
		})
	}
}
