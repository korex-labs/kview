package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestNamespaceFallbackSignalsForProblematic(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	now := time.Unix(100, 0)
	setNamespacedSnapshot(&plane.podsStore, "app", PodsSnapshot{
		Meta: SnapshotMetadata{ObservedAt: now},
		Items: []dto.PodListItemDTO{
			{Name: "bad", Namespace: "app", Phase: "Failed", Ready: "0/1"},
		},
	})

	got := namespaceFallbackSignalsForProblematic(now, "app", []dto.ProblematicResource{
		{Kind: "Pod", Name: "bad", Reason: "Pod failed"},
	}, plane, DefaultDataplanePolicy(), "ctx")
	if len(got) != 1 {
		t.Fatalf("expected one fallback signal, got %+v", got)
	}
	if got[0].Kind != "Pod" || got[0].Namespace != "app" || got[0].Name != "bad" {
		t.Fatalf("unexpected signal identity: %+v", got[0])
	}
	if got[0].SignalType != "resource_needs_attention_fallback" || got[0].HistoryKey == "" {
		t.Fatalf("unexpected fallback signal metadata: %+v", got[0])
	}
}

func TestNamespaceInsightResourceSignalsFromSignalsIncludesFallback(t *testing.T) {
	items := []dto.NamespaceInsightSignalDTO{
		{
			Kind:          "Pod",
			Namespace:     "app",
			Name:          "bad",
			ResourceKind:  "Pod",
			ResourceName:  "bad",
			Scope:         ResourceSignalsScopeNamespace,
			ScopeLocation: "app",
			Reason:        "Pod failed.",
		},
	}

	got := namespaceInsightResourceSignalsFromSignals(items)
	if len(got) != 1 {
		t.Fatalf("expected one resource signal group, got %+v", got)
	}
	if got[0].ResourceKind != "Pod" || got[0].ResourceName != "bad" || got[0].ScopeLocation != "app" || len(got[0].Signals) != 1 {
		t.Fatalf("unexpected resource signal group: %+v", got[0])
	}
}
