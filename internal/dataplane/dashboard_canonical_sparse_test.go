package dataplane

import (
	"context"
	"os"
	"testing"
	"testing/synctest"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Exercise the actual worker, queue, captured plane and reopened history DB. The
// replacement manager has no runtime cache or revision counters from the first.
func TestCanonicalSparseRestart(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		const name = "synthetic"
		start := time.Now().UTC().Truncate(time.Hour)
		m := newExplanationTestManager(t)
		p := addExplanationTestPlane(m, name)
		inventory := func() {
			setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.NamespaceListItemDTO{{Name: "known"}, {Name: "new"}, {Name: "restored"}}})
			setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "node"}}})
		}
		publish := func(ns string, failing, restore bool) {
			pod := dto.PodListItemDTO{Name: "same", UID: "uid-" + ns, Namespace: ns, Node: "worker", Phase: "Running", Ready: "1/1", AgeSec: 864000}
			if failing {
				pod.ContainerWaitingReasons = []string{"ImagePullBackOff"}
			}
			snap := PodsSnapshot{Meta: p.snapshotMetaHot(time.Now()), Items: []dto.PodListItemDTO{pod}}
			if restore {
				snap.Meta.ObservedAt = start
				if !markPersistedSnapshot(&snap, 0) {
					t.Fatal("restore failed")
				}
				snap.restored = true
			}
			setNamespacedSnapshot(&p.podsStore, ns, snap)
		}
		dir := t.TempDir()
		if err := os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
		launch := func() *localhistory.Collector {
			c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: name, SignalEpoch: "epoch", Binding: "binding-1", RetentionDays: 30, Directory: dir}, m)
			if err != nil {
				t.Fatal(err)
			}
			return c
		}
		inventory()
		publish("known", false, false)
		c := launch()
		defer func() { c.Close() }()
		sample := func() localhistory.TrendResponse {
			t.Helper()
			after := time.Now()
			for range 1000 {
				time.Sleep(time.Millisecond)
				out, err := c.QueryTrends(localhistory.TrendQuery{Context: name, From: start, To: time.Now().Truncate(time.Hour).Add(time.Hour), AsOf: time.Now(), RulesMode: "topChanges10", NodesMode: "topChanges10", NamespacesMode: "topChanges10"})
				if err != nil {
					t.Fatal(err)
				}
				if !out.Diagnostics.LastSample.Before(after) {
					return out
				}
			}
			t.Fatal("missing publication", c.Status())
			return localhistory.TrendResponse{}
		}
		sample()
		c.Close()
		time.Sleep(8 * time.Hour)
		m = newExplanationTestManager(t)
		p = addExplanationTestPlane(m, name)
		inventory()
		publish("restored", true, true)
		c = launch()
		baseline := sample()
		if len(baseline.Namespaces) != 0 {
			t.Fatal("hydration fabricated events", baseline.Namespaces)
		}
		for _, ns := range []string{"known", "new", "restored"} {
			publish(ns, ns != "restored", false)
		}
		out := sample()
		check := func(groups []localhistory.TrendSeries, key string, changes, first int) {
			t.Helper()
			for _, g := range groups {
				if g.Key == key {
					pt := g.Points[len(g.Points)-1]
					if pt.Counts == nil || pt.Counts.Changes != changes || pt.Counts.FirstSeen != first || g.ChangesScore != changes+first {
						t.Fatalf("%s: counts=%+v score=%d want %d+%d", key, pt.Counts, g.ChangesScore, changes, first)
					}
					return
				}
			}
			t.Fatalf("missing %s", key)
		}
		check(out.Namespaces, "known", 1, 0)
		check(out.Namespaces, "new", 0, 1)
		check(out.Namespaces, "restored", 1, 0)
		check(out.Severity, "all", 2, 1)
		check(out.Rules, "pod_image_pull_failure", 2, 1)
		check(out.Nodes, localhistory.TrendNodeKey("worker", "node"), 2, 1)
		publish("known", false, false)
		publish("new", true, false)
		sample()
		inventory()
		out = sample()
		check(out.Namespaces, "known", 2, 0)
		check(out.Namespaces, "new", 0, 1)
		check(out.Severity, "all", 3, 1)
	})
}
