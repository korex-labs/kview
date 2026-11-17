package dataplane

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Virtual wall time exercises the production collector clock, not a rewritten
// batch. Refreshes keep proof fresh while the same identified signal appears and
// disappears in different hours. No Kubernetes client may be resolved.
func TestCanonicalPublicationSeparateHours(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		m := newExplanationTestManager(t)
		p := addExplanationTestPlane(m, "synthetic")
		start := time.Now().UTC()
		publish := func(high int) {
			at := time.Now().UTC()
			setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
			setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "node-uid"}}})
			pods := make([]dto.PodListItemDTO, 13)
			for i := range pods {
				pods[i] = dto.PodListItemDTO{Name: fmt.Sprintf("pod-%d", i), UID: fmt.Sprintf("uid-%d", i), Namespace: "apps", Node: "worker", Phase: "Running", Ready: "1/1", AgeSec: 864000}
				if i < high {
					pods[i].ContainerWaitingReasons = []string{"ImagePullBackOff"}
				}
			}
			setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: pods})
		}
		publish(12)
		dir := t.TempDir()
		if err := os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
		c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		wait := func() {
			t.Helper()
			at := time.Now()
			for i := 0; i < 1000; i++ {
				time.Sleep(time.Millisecond)
				out, e := c.QueryTrends(localhistory.TrendQuery{Context: "synthetic", From: start.Truncate(time.Hour), To: time.Now().Truncate(time.Hour).Add(time.Hour), AsOf: time.Now()})
				if e != nil {
					t.Fatal(e)
				}
				if !out.Diagnostics.LastSample.Before(at) {
					return
				}
			}
			t.Fatal("publication not persisted", c.Status())
		}
		wait()
		for step := 1; step <= 24; step++ {
			time.Sleep(5 * time.Minute)
			high := 12
			if step >= 12 && step < 24 {
				high = 13
			}
			publish(high)
			wait()
		}
		c.Close()
		s, err := localhistory.OpenReal(filepath.Join(dir, "history-real-v1.db"), 30)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		q := localhistory.TrendQuery{Context: "synthetic", From: start.Truncate(time.Hour), To: start.Truncate(time.Hour).Add(3 * time.Hour), AsOf: time.Now(), NodesMode: "custom", Nodes: []string{localhistory.TrendNodeKey("worker", "node-uid")}, RulesMode: "custom", Rules: []string{"pod_image_pull_failure"}, NamespacesMode: "custom", Namespaces: []string{"apps"}}
		out, err := s.QueryTrends(q)
		if err != nil {
			t.Fatal(err)
		}
		for name, series := range map[string][]localhistory.TrendSeries{"severity": out.Severity, "nodes": out.Nodes, "rules": out.Rules, "namespaces": out.Namespaces} {
			if len(series) != 1 {
				t.Fatalf("%s missing: %+v", name, series)
			}
			for i, want := range []int{12, 13, 12} {
				point := series[0].Points[i]
				changes := 0
				if i > 0 {
					changes = 1
				}
				if point.Counts == nil || point.Counts.High != want || point.ConfirmedChanges != changes {
					t.Fatalf("%s hour %d: want high=%d changes=%d got %+v", name, i, want, changes, point)
				}
			}
			if series[0].ChangesScore != 2 {
				t.Fatalf("%s net-cancelled transitions: %+v", name, series[0])
			}
		}
	})
}
