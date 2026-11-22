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
	for _, tc := range []canonicalHoursCase{
		{"plain", [3]int{12, 13, 12}, [3]int{0, 1, 1}},
		{"unrelated-snooze", [3]int{12, 13, 12}, [3]int{0, 1, 1}},
		{"applicable-snooze-and-expiry", [3]int{12, 11, 12}, [3]int{}},
		{"missing-uid", [3]int{12, 13, 12}, [3]int{}},
		{"stale", [3]int{12, 13, 12}, [3]int{}},
		{"restored", [3]int{12, 13, 12}, [3]int{}},
		{"absent-plane", [3]int{12, 13, 12}, [3]int{0, 1, 1}},
		{"rebind", [3]int{12, 13, 12}, [3]int{0, 0, 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runCanonicalHours(t, tc)
		})
	}
}

type canonicalHoursCase struct {
	name          string
	high, changes [3]int
}

func runCanonicalHours(t *testing.T, tc canonicalHoursCase) {
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
			snapshot := PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: pods}
			if tc.name == "missing-uid" {
				pods[12].UID = ""
			}
			if high == 13 {
				switch tc.name {
				case "stale":
					snapshot.Meta.ObservedAt = at.Add(-time.Hour)
				case "restored":
					snapshot.restored = true
				}
			}
			setNamespacedSnapshot(&p.podsStore, "apps", snapshot)
		}
		publish(12)
		dir := t.TempDir()
		if err := os.Chmod(dir, 0700); err != nil {
			t.Fatal(err)
		}
		startCollector := func() *localhistory.Collector {
			c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
			if err != nil {
				t.Fatal(err)
			}
			return c
		}
		c := startCollector()
		defer func() { c.Close() }()
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
			if step >= 12 && step < 24 && tc.name != "applicable-snooze-and-expiry" {
				high = 13
			}
			// Snoozing an unrelated rule coincides with a real Pod transition in
			// the same publication window. It must not rebase image-pull history.
			if step == 12 && (tc.name == "unrelated-snooze" || tc.name == "applicable-snooze-and-expiry") {
				rule := "pod_restarts"
				duration := int64(SignalSuppressionDurationOneDaySeconds)
				if tc.name == "applicable-snooze-and-expiry" {
					rule = "pod_image_pull_failure"
					duration = SignalSuppressionDurationOneHourSeconds
				}
				_, err := m.SuppressSignal("synthetic", SignalSuppressionRequest{HistoryKey: rule + "|namespace|apps|Pod|pod-0", Mode: SignalSuppressionModeSnooze, DurationSeconds: duration})
				if err != nil {
					t.Fatal(err)
				}
			}
			if step == 12 && tc.name == "rebind" {
				c.Close()
			}
			if step == 12 && tc.name == "absent-plane" {
				m.mu.Lock()
				delete(m.planes, "synthetic")
				m.mu.Unlock()
				absentAt := time.Now()
				publish(high)
				time.Sleep(time.Second)
				synctest.Wait()
				out, err := c.QueryTrends(localhistory.TrendQuery{Context: "synthetic", From: start.Truncate(time.Hour), To: time.Now().Truncate(time.Hour).Add(time.Hour), AsOf: time.Now()})
				if err != nil {
					t.Fatal(err)
				}
				if !out.Diagnostics.LastSample.Before(absentAt) || c.Status().LastError == "" {
					t.Fatal("unavailable plane was not rejected", out.Diagnostics.LastSample, c.Status().LastError)
				}
				m.mu.Lock()
				m.planes["synthetic"] = p
				m.mu.Unlock()
			}
			publish(high)
			if step == 12 && tc.name == "rebind" {
				c = startCollector()
			}
			wait()
		}
		c.Close()
		s, err := localhistory.OpenReal(filepath.Join(dir, "history-real-v1.db"), 30)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := s.Close(); err != nil {
				t.Error(err)
			}
		})
		q := localhistory.TrendQuery{Context: "synthetic", From: start.Truncate(time.Hour), To: start.Truncate(time.Hour).Add(3 * time.Hour), AsOf: time.Now(), NodesMode: "custom", Nodes: []string{localhistory.TrendNodeKey("worker", "node-uid")}, RulesMode: "custom", Rules: []string{"pod_image_pull_failure"}, NamespacesMode: "custom", Namespaces: []string{"apps"}}
		out, err := s.QueryTrends(q)
		if err != nil {
			t.Fatal(err)
		}
		for name, series := range map[string][]localhistory.TrendSeries{"severity": out.Severity, "nodes": out.Nodes, "rules": out.Rules, "namespaces": out.Namespaces} {
			if len(series) != 1 {
				t.Fatalf("%s missing: %+v", name, series)
			}
			for i, want := range tc.high {
				point := series[0].Points[i]
				changes := tc.changes[i]
				if point.Counts == nil || point.Counts.High != want || point.ConfirmedChanges != changes {
					t.Fatalf("%s hour %d: want high=%d changes=%d got %+v", name, i, want, changes, point)
				}
			}
			firstSeen := 12
			if series[0].Points[0].Counts.FirstSeen != firstSeen || series[0].ChangesScore != firstSeen+tc.changes[1]+tc.changes[2] {
				t.Fatalf("%s net-cancelled transitions: %+v", name, series[0])
			}
		}
	})
}
