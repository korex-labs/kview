package dataplane

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// A namespace catalog row is not an observation of its Pods. Only the
// observed case has a healthy Pod inventory before the first failure.
func TestCanonicalFirstImagePullFailure(t *testing.T) {
	for _, observed := range []bool{true, false} {
		name := "bootstrap"
		if observed {
			name = "observed-empty"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				const rule = "pod_image_pull_failure"
				m := newExplanationTestManager(t)
				p := addExplanationTestPlane(m, "synthetic")
				start := time.Now().UTC().Truncate(time.Hour)
				setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
				node := func() {
					setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "worker-uid"}}})
				}
				node()
				publish := func(failing bool) {
					pod := dto.PodListItemDTO{Name: "stable", UID: "pod-uid", Namespace: "apps", Node: "worker", Phase: "Running", Ready: "1/1", AgeSec: 864000}
					if failing {
						pod.ContainerWaitingReasons = []string{"ImagePullBackOff"}
					}
					setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.PodListItemDTO{pod}})
				}
				if observed {
					publish(false)
				}
				dir := t.TempDir()
				if err := os.Chmod(dir, 0700); err != nil {
					t.Fatal(err)
				}
				c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
				if err != nil {
					t.Fatal(err)
				}
				defer c.Close()
				wait := func(at time.Time) {
					t.Helper()
					for i := 0; i < 1000; i++ {
						time.Sleep(time.Millisecond)
						out, err := c.QueryTrends(localhistory.TrendQuery{Context: "synthetic", From: start, To: time.Now().Truncate(time.Hour).Add(time.Hour), AsOf: time.Now()})
						if err != nil {
							t.Fatal(err)
						}
						if !out.Diagnostics.LastSample.Before(at) {
							return
						}
					}
					t.Fatal("no accepted publication", c.Status())
				}
				wait(time.Now())
				baseline := m.canonicalHistoryBatch(context.Background(), "synthetic", "epoch", time.Now())
				found := false
				for _, d := range baseline.Domains {
					if d.Namespace == "apps" && d.Rule == rule {
						found = true
						if len(d.Signals) != 0 || d.TransitionsUnknown || d.SourceStatus != "available" || d.EvidenceAt.IsZero() {
							t.Fatalf("not an authoritative empty domain: %+v", d)
						}
					}
				}
				if found != observed {
					t.Fatalf("initial domain present=%t, observed Pods=%t", found, observed)
				}
				for step := 1; step <= 24; step++ {
					time.Sleep(5 * time.Minute)
					// Independent Node publications trigger whole-plane recaptures.
					// The namespace catalog ages, while the target Pods stay fresh.
					node()
					if observed || step >= 12 {
						publish(step >= 12 && step < 24)
					}
					wait(time.Now())
				}
				c.Close()
				s, err := localhistory.OpenReal(filepath.Join(dir, "history-real-v1.db"), 30)
				if err != nil {
					t.Fatal(err)
				}
				defer func() {
					if err := s.Close(); err != nil {
						t.Errorf("close history store: %v", err)
					}
				}()
				out, err := s.QueryTrends(localhistory.TrendQuery{Context: "synthetic", From: start, To: start.Add(3 * time.Hour), AsOf: time.Now(), RulesMode: "custom", Rules: []string{rule}, NodesMode: "custom", Nodes: []string{localhistory.TrendNodeKey("worker", "worker-uid")}, NamespacesMode: "custom", Namespaces: []string{"apps"}})
				if err != nil {
					t.Fatal(err)
				}
				appearance := 0
				if observed {
					appearance = 1
				}
				for kind, series := range map[string][]localhistory.TrendSeries{"rule": out.Rules, "node": out.Nodes, "namespace": out.Namespaces} {
					if len(series) != 1 || len(series[0].Points) != 3 {
						t.Fatalf("%s: missing retained hours: %+v", kind, series)
					}
					for i, changes := range []int{0, appearance, 1} {
						point := series[0].Points[i]
						if point.ConfirmedChanges != changes || (i == 1 && (point.Counts == nil || point.Counts.High != 1)) || (i != 1 && point.Counts != nil && point.Counts.High != 0) {
							t.Errorf("%s hour %d: expected %d changes, got %+v", kind, i, changes, point)
						}
					}
				}
			})
		})
	}
}
