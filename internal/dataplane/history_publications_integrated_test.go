package dataplane

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Exercises the real manager -> publication -> managed collector -> durable store.
// Uses the production provider path without an overlay or collection-setting changes.
func TestHistoryPublicationsIntegratedManagedPersistence(t *testing.T) {
	m := newExplanationTestManager(t) // any client resolution panics
	p := addExplanationTestPlane(m, "synthetic")
	now := time.Now().UTC()
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NamespaceListItemDTO{{Name: "apps"}}})
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(now)})
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	c, err := localhistory.StartManaged(context.Background(), localhistory.Config{Enabled: true, SignalHistory: true, QueryContext: "synthetic", SignalEpoch: "epoch", RetentionDays: 30, Directory: dir}, m)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if c.Status().Publications == nil {
		t.Fatal("managed collector did not subscribe to the publication provider")
	}
	query := localhistory.TrendQuery{Context: "synthetic", From: now.Truncate(time.Hour), To: now.Truncate(time.Hour).Add(time.Hour), RulesMode: "custom", Rules: []string{"empty_configmap"}}
	wait := func(want int) localhistory.TrendPoint {
		t.Helper()
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(time.Millisecond)
		defer tick.Stop()
		for {
			out, e := c.QueryTrends(query)
			if e != nil {
				t.Fatal(e)
			}
			if len(out.Rules) == 1 && len(out.Rules[0].Points) == 1 {
				point := out.Rules[0].Points[0]
				if point.Counts != nil && point.Counts.High+point.Counts.Medium+point.Counts.Low == want {
					return point
				}
			}
			select {
			case <-deadline.C:
				t.Fatalf("publication did not persist before poll: %+v / %+v", out, c.Status())
			case <-tick.C:
			}
		}
	}
	wait(0)
	observed := time.Now().UTC()
	setNamespacedSnapshot(&p.cmsStore, "apps", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(observed), Items: []dto.ConfigMapDTO{{Name: "empty", Namespace: "apps"}}})
	point := wait(1)
	if !point.SourceAt.Equal(observed) {
		t.Fatal("source clock replaced", point)
	}
	if c.Status().LastError != "" {
		t.Fatal(c.Status())
	}
	c.Close()
	if p.historyPublications.Load() != nil || len(m.planes) != 1 || len(m.planeInit) != 0 {
		t.Fatal("lifecycle created state or retained subscription")
	}
	store, e := localhistory.OpenReal(filepath.Join(dir, "history-real-v1.db"), 30)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	out, e := store.QueryTrends(query)
	if e != nil || len(out.Rules) != 1 || out.Rules[0].Points[0].Counts == nil || !out.Rules[0].Points[0].SourceAt.Equal(observed) {
		t.Fatal("durable evidence missing", out, e)
	}
}
