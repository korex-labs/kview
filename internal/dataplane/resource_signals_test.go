package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestResourceSignalKindFromRoute(t *testing.T) {
	tests := []struct {
		scope  string
		route  string
		want   string
		wantOK bool
	}{
		{ResourceSignalsScopeNamespace, "pods", "Pod", true},
		{ResourceSignalsScopeNamespace, "PODS", "Pod", true},
		{ResourceSignalsScopeNamespace, "horizontalpodautoscalers", "HorizontalPodAutoscaler", true},
		{ResourceSignalsScopeNamespace, "helmreleases", "HelmRelease", true},
		{ResourceSignalsScopeNamespace, "nodes", "", false}, // cluster-scoped, wrong bucket
		{ResourceSignalsScopeNamespace, "bogus", "", false},
		{ResourceSignalsScopeCluster, "nodes", "Node", true},
		{ResourceSignalsScopeCluster, "persistentvolumes", "PersistentVolume", true},
		{ResourceSignalsScopeCluster, "pods", "", false}, // namespace-scoped, wrong bucket
		{"unknown-scope", "pods", "", false},
	}
	for _, tt := range tests {
		got, ok := ResourceSignalKindFromRoute(tt.scope, tt.route)
		if ok != tt.wantOK || got != tt.want {
			t.Fatalf("scope=%q route=%q: got (%q,%v) want (%q,%v)", tt.scope, tt.route, got, ok, tt.want, tt.wantOK)
		}
	}
}

func TestResourceSignals_ValidatesInputs(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	ctx := t.Context()

	cases := []struct {
		name      string
		scope     string
		namespace string
		kind      string
		resource  string
	}{
		{"missing kind", ResourceSignalsScopeNamespace, "team-a", "", "api"},
		{"missing name", ResourceSignalsScopeNamespace, "team-a", "Pod", ""},
		{"invalid scope", "weird", "team-a", "Pod", "api"},
		{"namespace scope without ns", ResourceSignalsScopeNamespace, "", "Pod", "api"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			_, err := mm.ResourceSignals(ctx, "ctx-rs", tc.scope, tc.namespace, tc.kind, tc.resource)
			if err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}

func TestResourceSignals_NamespaceScope_ReturnsAttributedSignals(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx-rs-ns")
	plane := planeAny.(*clusterPlane)

	now := time.Now().UTC()
	meta := SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot}
	ns := "team-a"

	setNamespacedSnapshot(&plane.podsStore, ns, PodsSnapshot{
		Meta: meta,
		Items: []dto.PodListItemDTO{
			{Name: "api-0", Namespace: ns, Restarts: 12, Phase: "Running", Ready: "1/1"},
			{Name: "api-1", Namespace: ns, Restarts: 0, Phase: "Running", Ready: "1/1"},
			{Name: "api-2", Namespace: ns, Restarts: 0, Phase: "Running", Ready: "1/1", LastEvent: &dto.EventBriefDTO{Type: "Warning", Reason: "BackOff"}},
		},
	})
	setNamespacedSnapshot(&plane.secsStore, ns, SecretsSnapshot{
		Meta: meta,
		Items: []dto.SecretDTO{
			{Name: "creds", Namespace: ns, KeysCount: 0},
			{Name: "creds-full", Namespace: ns, KeysCount: 3},
		},
	})
	setNamespacedSnapshot(&plane.saStore, ns, ServiceAccountsSnapshot{
		Meta: meta,
		Items: []dto.ServiceAccountListItemDTO{
			{Name: "default", Namespace: ns, AutomountServiceAccountToken: boolPtr(true)},
			{Name: "locked", Namespace: ns, AutomountServiceAccountToken: boolPtr(false)},
		},
	})

	t.Run("pod with restarts surfaces pod_restarts signal", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Pod", "api-0")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) == 0 {
			t.Fatalf("expected at least one signal for api-0, got %+v", got)
		}
		var found bool
		for _, s := range got.Signals {
			if s.SignalType == "pod_restarts" && s.ResourceKind == "Pod" && s.ResourceName == "api-0" {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected pod_restarts attributed to api-0, got %+v", got.Signals)
		}
	})

	t.Run("clean pod returns empty signals slice (not nil, not error)", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Pod", "api-1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Signals == nil {
			t.Fatalf("expected non-nil empty slice for clean resource, got nil")
		}
		if len(got.Signals) != 0 {
			t.Fatalf("expected no signals for api-1, got %+v", got.Signals)
		}
	})

	t.Run("empty secret surfaces empty_secret signal", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Secret", "creds")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) != 1 || got.Signals[0].SignalType != "empty_secret" {
			t.Fatalf("expected single empty_secret signal, got %+v", got.Signals)
		}
		if got.Signals[0].LikelyCause == "" || got.Signals[0].SuggestedAction == "" {
			t.Fatalf("expected registry-provided advice, got %+v", got.Signals[0])
		}
	})

	t.Run("non-empty secret returns no signals", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Secret", "creds-full")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) != 0 {
			t.Fatalf("expected no signals for full secret, got %+v", got.Signals)
		}
	})

	t.Run("unknown name returns empty signals", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Pod", "missing")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) != 0 {
			t.Fatalf("expected empty result for unknown resource, got %+v", got.Signals)
		}
	})

	t.Run("pod warning-event list signal is mirrored in resource signals", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Pod", "api-2")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) == 0 {
			t.Fatalf("expected fallback signal for warning-event pod")
		}
		sig := got.Signals[0]
		if sig.SignalType != "resource_needs_attention_fallback" {
			t.Fatalf("expected fallback signal type, got %+v", sig)
		}
		if sig.Severity != "medium" {
			t.Fatalf("expected medium severity, got %+v", sig)
		}
		if sig.Reason == "" || sig.Reason == "Pod needs attention." {
			t.Fatalf("expected specific pod warning reason, got %+v", sig)
		}
	})

	t.Run("serviceaccount list signal is mirrored in resource signals", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "ServiceAccount", "default")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) == 0 {
			t.Fatalf("expected fallback signal for serviceaccount")
		}
		sig := got.Signals[0]
		if sig.SignalType != "resource_needs_attention_fallback" || sig.Severity != "low" {
			t.Fatalf("unexpected serviceaccount signal %+v", sig)
		}
		if sig.Reason == "" || sig.Reason == "ServiceAccount posture needs attention." {
			t.Fatalf("expected explicit serviceaccount reason, got %+v", sig)
		}
	})

	t.Run("serviceaccount without list signal returns empty", func(t *testing.T) {
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "ServiceAccount", "locked")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) != 0 {
			t.Fatalf("expected no signals for non-attention serviceaccount, got %+v", got.Signals)
		}
	})
}

func boolPtr(v bool) *bool { return &v }

func TestResourceSignals_NamespaceScope_NoCacheIsEmpty(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	got, err := mm.ResourceSignals(t.Context(), "ctx-rs-empty", ResourceSignalsScopeNamespace, "team-a", "Pod", "api-0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.Signals) != 0 {
		t.Fatalf("expected no signals when caches are cold, got %+v", got.Signals)
	}
}

func TestResourceSignals_ClusterScope_FallbackNeedsAttentionSignals(t *testing.T) {
	dm := NewManager(ManagerConfig{})
	mm := dm.(*manager)
	planeAny, _ := mm.PlaneForCluster(t.Context(), "ctx-rs-cluster")
	plane := planeAny.(*clusterPlane)

	setClusterSnapshot(&plane.persistentVolumesStore, PersistentVolumesSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassWarm},
		Items: []dto.PersistentVolumeDTO{
			{Name: "pv-critical", Phase: "Failed"},
			{Name: "pv-healthy", Phase: "Bound"},
		},
	})
	setClusterSnapshot(&plane.nodesStore, NodesSnapshot{
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassWarm},
		Items: []dto.NodeListItemDTO{
			{Name: "node-warn", Status: "Unknown"},
			{Name: "node-ok", Status: "Ready"},
		},
	})

	got, err := mm.ResourceSignals(t.Context(), "ctx-rs-cluster", ResourceSignalsScopeCluster, "", "PersistentVolume", "pv-critical")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.Signals) == 0 {
		t.Fatalf("expected fallback signal for pv-critical")
	}
	if got.Signals[0].SignalType == "" {
		t.Fatalf("expected signal type to be set, got %+v", got.Signals[0])
	}

	clean, err := mm.ResourceSignals(t.Context(), "ctx-rs-cluster", ResourceSignalsScopeCluster, "", "PersistentVolume", "pv-healthy")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(clean.Signals) != 0 {
		t.Fatalf("expected no signals for healthy pv, got %+v", clean.Signals)
	}

	nodeSignals, err := mm.ResourceSignals(t.Context(), "ctx-rs-cluster", ResourceSignalsScopeCluster, "", "Node", "node-warn")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(nodeSignals.Signals) == 0 || nodeSignals.Signals[0].Reason == "" {
		t.Fatalf("expected fallback signal for node-warn, got %+v", nodeSignals.Signals)
	}

	nodeClean, err := mm.ResourceSignals(t.Context(), "ctx-rs-cluster", ResourceSignalsScopeCluster, "", "Node", "node-ok")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(nodeClean.Signals) != 0 {
		t.Fatalf("expected no signals for healthy node, got %+v", nodeClean.Signals)
	}
}
