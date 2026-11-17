package dataplane

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Verify the actual manager -> publication collector -> durable hourly query
// path, not the independent resource-history evaluator. Node creation precedes
// Pod creation; its still-fresh LIST observation precedes later Pod observations.
func TestCanonicalNodePublicationTransitions(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		waiting string
		own     bool
		values  []int32
		high    []int
	}{
		{"image", "ImagePullBackOff", false, []int32{0, 1, 0}, []int{0, 1, 0}},
		{"crash", "CrashLoopBackOff", false, []int32{0, 1, 0}, []int{0, 1, 0}},
		{"restart-severity", "", false, []int32{0, 5, 20, 0}, []int{0, 0, 1, 0}},
		{"restart-with-unknown-identity", "", false, []int32{0, 5, 20, 0}, []int{0, 0, 1, 0}},
		{"node-own-severity", "", true, []int32{0, 940, 980, 0}, []int{0, 0, 1, 0}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			m := newExplanationTestManager(t) // Resolving any client panics.
			p := addExplanationTestPlane(m, "synthetic")
			now := time.Now().UTC()
			setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NamespaceListItemDTO{{Name: "apps"}, {Name: "cold"}}})
			setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "node-uid", CreatedAt: now.Add(-48 * time.Hour).Unix(), CPUAllocatable: "1", MemoryAllocatable: "1Gi"}}})
			publish := func(value int32) time.Time {
				at := time.Now().UTC()
				if scenario.own {
					setClusterSnapshot(&p.nodeMetricsStore, NodeMetricsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.NodeMetricsDTO{{Name: "worker", CPUMilli: int64(value), CapturedAt: at.Unix(), WindowSec: 30}}})
				} else {
					pod := dto.PodListItemDTO{Name: "known", UID: "pod-uid", Namespace: "apps", Node: "worker", CreatedAt: now.Add(-24 * time.Hour).Unix(), AgeSec: 86400, Phase: "Running", Ready: "1/1"}
					if scenario.waiting != "" {
						if value != 0 {
							pod.ContainerWaitingReasons = []string{scenario.waiting}
						}
					} else {
						pod.Restarts = value
					}
					pods := []dto.PodListItemDTO{pod}
					if scenario.name == "restart-with-unknown-identity" {
						// A different resource without UID cannot veto known transitions.
						pods = append(pods, dto.PodListItemDTO{Name: "unknown", Namespace: "apps", Phase: "Running", Ready: "1/1", Restarts: 5, AgeSec: 864000})
					}
					setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: pods})
				}
				return at
			}
			// Ensure a cached namespace population for the Node-own detector too.
			setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.PodListItemDTO{{Name: "healthy", UID: "healthy-uid", Namespace: "apps", Phase: "Running", Ready: "1/1"}}})
			publish(0)
			dir := t.TempDir()
			if err := os.Chmod(dir, 0700); err != nil {
				t.Fatal(err)
			}
			c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			q := localhistory.TrendQuery{Context: "synthetic", From: now.Truncate(time.Hour), To: now.Truncate(time.Hour).Add(time.Hour), RulesMode: "topChanges10", NodesMode: "custom", Nodes: []string{localhistory.TrendNodeKey("worker", "node-uid")}, NamespacesMode: "topChanges10"}
			wait := func(after time.Time) localhistory.TrendResponse {
				t.Helper()
				deadline := time.Now().Add(3 * time.Second)
				for time.Now().Before(deadline) {
					out, err := c.QueryTrends(q)
					if err != nil {
						t.Fatal(err)
					}
					if len(out.Severity) > 0 && len(out.Severity[0].Points) > 0 && out.Severity[0].Points[0].SampleAt.After(after) {
						return out
					}
					time.Sleep(time.Millisecond)
				}
				t.Fatalf("publication not accepted: %+v", c.Status())
				return localhistory.TrendResponse{}
			}
			baseline := wait(now)
			if baseline.Severity[0].Points[0].ConfirmedChanges != 0 {
				t.Fatal("baseline fabricated transitions")
			}
			for i, value := range scenario.values[1:] {
				out := wait(publish(value))
				if len(out.Nodes) != 1 || out.Nodes[0].ChangesScore != i+1 {
					t.Fatalf("exact node changes want %d: %+v", i+1, out.Nodes)
				}
				point := out.Nodes[0].Points[0]
				if point.Counts == nil || point.Counts.High != scenario.high[i+1] || point.ConfirmedChanges != i+1 {
					t.Fatalf("node high/changes: %+v", point)
				}
				if point.ChangesCoverage != "partial" {
					t.Fatalf("cold unrelated population must remain partial: %+v", point)
				}
				if out.Severity[0].Points[0].ConfirmedChanges != i+1 {
					t.Fatal("cluster/node transition mismatch")
				}
				if scenario.own && len(out.Namespaces) != 0 {
					t.Fatal("Node-own event attributed to a namespace")
				}
				if !scenario.own && (len(out.Namespaces) != 1 || out.Namespaces[0].ChangesScore != i+1) {
					t.Fatal("hosted event lost namespace attribution")
				}
				t.Logf("stage=%d high=%d confirmedNodes=%d coverage=%s", i+1, point.Counts.High, point.ConfirmedChanges, point.ChangesCoverage)
			}
			q.NodesMode, q.Nodes = "topChanges10", nil
			out, err := c.QueryTrends(q)
			if err != nil || len(out.Nodes) != 1 || out.Nodes[0].ChangesScore != len(scenario.values)-1 {
				t.Fatalf("TopChanges omitted proven node transitions: %+v %v", out.Nodes, err)
			}
		})
	}
}
