package dataplane

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// Exercise the real publication subscription, detector, reducer, durable hourly
// merge and query. An unrelated cold namespace must not veto known Pod changes.
func TestCanonicalPublicationChangesWithPartialPopulation(t *testing.T) {
	m := newExplanationTestManager(t) // client resolution panics
	p := addExplanationTestPlane(m, "synthetic")
	now := time.Now().UTC()
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NamespaceListItemDTO{{Name: "apps"}, {Name: "cold"}}})
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(now), Items: []dto.NodeListItemDTO{{Name: "worker", UID: "worker-uid"}}})
	publish := func(restarts int32) time.Time {
		at := time.Now().UTC()
		setNamespacedSnapshot(&p.podsStore, "apps", PodsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.PodListItemDTO{{Name: "known", UID: "pod-uid", Namespace: "apps", Node: "worker", Phase: "Running", Ready: "1/1", Restarts: restarts, AgeSec: 864000}}})
		return at
	}
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
	q := localhistory.TrendQuery{TransitionDetails: true, Context: "synthetic", From: now.Truncate(time.Hour), To: now.Truncate(time.Hour).Add(time.Hour), RulesMode: "topChanges10", NodesMode: "topChanges10", NamespacesMode: "topChanges10"}
	wait := func(after time.Time) localhistory.TrendResponse {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			out, e := c.QueryTrends(q)
			if e != nil {
				t.Fatal(e)
			}
			if len(out.Severity) > 0 && len(out.Severity[0].Points) > 0 && out.Severity[0].Points[0].SampleAt.After(after) {
				return out
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("publication not accepted: %+v", c.Status())
		return localhistory.TrendResponse{}
	}
	first := wait(now)
	if first.Severity[0].Points[0].ConfirmedChanges != 0 {
		t.Fatal("baseline manufactured events")
	}
	if first.Diagnostics.Reasons["dashboard-population-partial"] != 1 {
		t.Fatal("fixture must include cold population")
	}
	var final localhistory.TrendResponse
	for i, n := range []int32{5, 20, 0} {
		at := publish(n)
		final = wait(at)
		for name, series := range map[string][]localhistory.TrendSeries{"rules": final.Rules, "nodes": final.Nodes, "namespaces": final.Namespaces} {
			found := false
			for _, s := range series {
				if s.ChangesScore == i+1 {
					found = true
				}
			}
			if !found {
				t.Fatalf("%s TopChanges: want %d confirmed appearance/severity/disappearance; got %+v; diagnostics=%+v", name, i+1, series, final.Diagnostics)
			}
		}
		if final.TransitionDiagnostics == nil {
			t.Fatal("missing transition diagnostics")
		}
		for _, record := range final.TransitionDiagnostics.Recent {
			if record.Rule == "pod_restarts" && record.Reason != "no-previous-baseline" {
				t.Fatal("known publication rejected", record)
			}
		}
		point := final.Severity[0].Points[0]
		if point.ConfirmedChanges != i+1 || point.ChangesCoverage != "partial" {
			t.Fatalf("confirmed subtotal lost or claimed complete: %+v", point)
		}
	}
	raw, err := json.Marshal(final)
	if err != nil {
		t.Fatal(err)
	}
	var wire localhistory.TrendResponse
	if err = json.Unmarshal(raw, &wire); err != nil || wire.Nodes[0].ChangesScore != 3 {
		t.Fatal("wire contract", err)
	}
}
