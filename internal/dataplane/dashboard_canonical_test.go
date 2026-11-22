package dataplane

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

func canonicalFixture(t *testing.T, high, medium, low, namespaces int) (*manager, *clusterPlane, time.Time) {
	t.Helper()
	m := newExplanationTestManager(t)
	bundle := m.PolicyBundle()
	bundle.Global.NamespaceEnrichment.Enabled = false
	bundle.Global.NamespaceEnrichment.Sweep.Enabled = false
	bundle.Global.Observers.Enabled = false
	m.SetPolicyBundle(bundle)
	p := addExplanationTestPlane(m, "contextA")
	at := time.Now().UTC().Truncate(time.Minute).Add(-time.Minute)
	ns := []dto.NamespaceListItemDTO{}
	for i := 0; i < namespaces; i++ {
		name := fmt.Sprintf("space-%03d", i)
		ns = append(ns, dto.NamespaceListItemDTO{Name: name})
		pods := []dto.PodListItemDTO{}
		// Repeated names and UIDs deliberately retain raw multiplicity.
		for j := i; j < high; j += namespaces {
			pods = append(pods, dto.PodListItemDTO{Name: "duplicate-high", UID: "uid-high", Namespace: name, Phase: "Running", Ready: "1/1", ContainerWaitingReasons: []string{"ImagePullBackOff"}})
		}
		for j := i; j < medium; j += namespaces {
			pods = append(pods, dto.PodListItemDTO{Name: "duplicate-medium", Namespace: name, Phase: "Pending", HealthReason: "Unschedulable"})
		}
		if len(pods) == 0 {
			pods = append(pods, dto.PodListItemDTO{Name: "healthy", Namespace: name, Phase: "Running", Ready: "1/1"})
		}
		// Data age must not change membership compared to Dashboard.
		meta := p.snapshotMetaHot(at.Add(-2 * time.Hour))
		meta.Freshness = FreshnessClassStale
		setNamespacedSnapshot(&p.podsStore, name, PodsSnapshot{Meta: meta, Items: pods})
		cms := []dto.ConfigMapDTO{}
		for j := i; j < low; j += namespaces {
			cms = append(cms, dto.ConfigMapDTO{Name: "duplicate-low", Namespace: name})
		}
		setNamespacedSnapshot(&p.cmsStore, name, ConfigMapsSnapshot{Meta: meta, Items: cms})
	}
	// Dashboard's inventory prerequisites must be fresh at actual execution time;
	// keep workload snapshots stale to exercise stale population accounting.
	freshAt := time.Now().UTC()
	setClusterSnapshot(&p.nsStore, NamespaceSnapshot{Meta: p.snapshotMetaHot(freshAt), Items: ns})
	setClusterSnapshot(&p.nodesStore, NodesSnapshot{Meta: p.snapshotMetaHot(freshAt)})
	return m, p, at
}

func canonicalQuery(t *testing.T, store *localhistory.Store, at time.Time) localhistory.TrendPoint {
	t.Helper()
	out, err := store.QueryTrends(localhistory.TrendQuery{Context: "contextA", From: at.Truncate(time.Hour), To: at.Truncate(time.Hour).Add(time.Hour), AsOf: at.Add(10 * time.Second)})
	if err != nil {
		t.Fatal(err)
	}
	// Verify the actual serialized public response, not just reducer structs.
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	var wire localhistory.TrendResponse
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if len(wire.Severity) == 0 || len(wire.Severity[0].Points) == 0 {
		t.Fatalf("missing severity: %s", raw)
	}
	return wire.Severity[0].Points[0]
}

func TestDashboardCanonicalHistoryPopulation(t *testing.T) {
	for _, tc := range []struct {
		name              string
		high, medium, low int
	}{{"reported-scale", 3339, 1425, 696}, {"identity-cap", 21001, 1425, 696}} {
		t.Run(tc.name, func(t *testing.T) {
			m, p, at := canonicalFixture(t, tc.high, tc.medium, tc.low, 595)
			store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := store.Close(); err != nil {
					t.Error(err)
				}
			})
			batch := m.HistoryPublicationBatch(context.Background(), localhistory.Publication{Context: "contextA", Epoch: "epoch"}, at)
			if len(m.signalHistory["contextA"]) != 0 {
				t.Fatal("canonical reader mutated recurrence")
			}
			if err := store.AppendTrends(batch); err != nil {
				t.Fatal(err)
			}
			summary := m.DashboardSignalsSummary(context.Background(), "contextA", ClusterDashboardListOptions{SignalsLimit: 1, SignalsOffset: 200})
			point := canonicalQuery(t, store, at)
			if point.Counts == nil || point.Counts.High != tc.high || point.Counts.Medium != tc.medium || point.Counts.Low != tc.low {
				t.Fatalf("wrong canonical counts: %+v", point)
			}
			if point.Counts.High != summary.Signals.High || point.Counts.Medium != summary.Signals.Medium || point.Counts.Low != summary.Signals.Low {
				t.Fatalf("Dashboard/history mismatch: %+v / %+v", summary.Signals, point)
			}
			if point.ConfirmedChanges != 0 || point.Counts.Changes != 0 {
				t.Fatal("baseline fabricated transitions", point)
			}
			if point.Freshness != "stale" {
				t.Fatal("lost data freshness", point)
			}
			if batch.Diagnostics.EvaluatedScopes != 595 {
				t.Fatal("namespace prefix truncation", batch.Diagnostics)
			}
			if tc.high > localhistory.TrendMaxSignals && batch.Diagnostics.Reasons["canonical-identity-cap"] != 1 {
				t.Fatal("missing identity-cap evidence")
			}
			// One namespace update must not remove the other 594 namespace contributions.
			setNamespacedSnapshot(&p.cmsStore, "space-000", ConfigMapsSnapshot{Meta: p.snapshotMetaHot(at), Items: []dto.ConfigMapDTO{{Name: "one", Namespace: "space-000"}}})
			batch = m.HistoryPublicationBatch(context.Background(), localhistory.Publication{Context: "contextA", Epoch: "epoch", Namespace: "space-000", Kind: "configmaps"}, at.Add(time.Second))
			if err := store.AppendTrends(batch); err != nil {
				t.Fatal(err)
			}
			summary = m.DashboardSignalsSummary(context.Background(), "contextA", ClusterDashboardListOptions{SignalsLimit: 2})
			point = canonicalQuery(t, store, at)
			if point.Counts == nil || point.Counts.High != summary.Signals.High || point.Counts.Medium != summary.Signals.Medium || point.Counts.Low != summary.Signals.Low {
				t.Fatal("partial namespace update replaced context", point)
			}
			absent := m.HistoryPublicationBatch(context.Background(), localhistory.Publication{Context: "contextB", Epoch: "epoch"}, at)
			if absent.Validate() == nil || len(m.planes) != 1 {
				t.Fatal("missing context fabricated observation/plane")
			}
		})
	}
}

func TestDashboardCanonicalSuppressionDomains(t *testing.T) {
	for _, tc := range []struct{ key, ns, rule string }{
		{"pod_restarts|namespace|apps|Pod|api", "apps", "pod_restarts"},
		{"node_resource_pressure|cluster|Node|worker", "", "node_resource_pressure"},
		{"resource_quota_pressure|cluster|quota|limits.cpu", "cluster", "resource_quota_pressure"},
		{"ingress_missing_service|namespace|apps|Ingress|web|backend|80", "apps", "ingress_missing_service"},
	} {
		if got, ok := suppressionDomainKey(tc.key); !ok || got != canonicalKey(tc.ns, tc.rule) {
			t.Errorf("%q: wrong domain %q", tc.key, got)
		}
	}
	if _, ok := suppressionDomainKey("custom-history-key"); ok {
		t.Fatal("unknown identity should rebase common policy")
	}
}

func TestDashboardCanonicalSuppressionPolicyRebase(t *testing.T) {
	m, _, at := canonicalFixture(t, 3, 2, 1, 1)
	store, err := localhistory.OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	first := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at)
	if err := store.AppendTrends(first); err != nil {
		t.Fatal(err)
	}
	summary := m.DashboardSignalsSummary(context.Background(), "contextA", ClusterDashboardListOptions{})
	var signal ClusterDashboardSignal
	for _, s := range summary.Signals.Top {
		if s.Severity == "high" {
			signal = s
			break
		}
	}
	if signal.HistoryKey == "" {
		t.Fatal("missing high signal")
	}
	if _, err := m.suppressSignalAt("contextA", SignalSuppressionRequest{HistoryKey: signal.HistoryKey, Mode: SignalSuppressionModeSnooze, DurationSeconds: 3600}, at); err != nil {
		t.Fatal(err)
	}
	next := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at.Add(time.Second))
	if next.Policy != first.Policy {
		t.Fatal("suppression rebased common policy")
	}
	if err := store.AppendTrends(next); err != nil {
		t.Fatal(err)
	}
	summary = m.DashboardSignalsSummary(context.Background(), "contextA", ClusterDashboardListOptions{})
	point := canonicalQuery(t, store, at)
	if point.Counts == nil || point.Counts.High != summary.Signals.High || point.Counts.High != 0 || point.ConfirmedChanges != 0 {
		t.Fatal("suppression counts/transitions", point)
	}
	bundle := m.PolicyBundle()
	disabled := false
	if bundle.Global.Signals.Overrides == nil {
		bundle.Global.Signals.Overrides = map[string]SignalOverride{}
	}
	bundle.Global.Signals.Overrides["empty_configmap"] = SignalOverride{Enabled: &disabled}
	m.SetPolicyBundle(bundle)
	policy := m.canonicalHistoryBatch(context.Background(), "contextA", "epoch", at.Add(2*time.Second))
	if policy.Policy == next.Policy {
		t.Fatal("static policy did not rebase")
	}
	if err := store.AppendTrends(policy); err != nil {
		t.Fatal(err)
	}
	point = canonicalQuery(t, store, at)
	if point.Counts == nil || point.Counts.Low != 0 || point.ConfirmedChanges != 0 {
		t.Fatal("policy fabricated health transitions", point)
	}
}
