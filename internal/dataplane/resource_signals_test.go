package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func TestResourceSignalKindFromRoute(t *testing.T) {
	tests := []struct {
		scope   string
		route   string
		want    string
		wantOK  bool
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
		},
	})
	setNamespacedSnapshot(&plane.secsStore, ns, SecretsSnapshot{
		Meta: meta,
		Items: []dto.SecretDTO{
			{Name: "creds", Namespace: ns, KeysCount: 0},
			{Name: "creds-full", Namespace: ns, KeysCount: 3},
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
		got, err := mm.ResourceSignals(t.Context(), "ctx-rs-ns", ResourceSignalsScopeNamespace, ns, "Pod", "missing"); if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got.Signals) != 0 {
			t.Fatalf("expected empty result for unknown resource, got %+v", got.Signals)
		}
	})
}

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
