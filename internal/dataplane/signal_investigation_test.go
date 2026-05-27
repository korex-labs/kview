package dataplane

import (
	"strings"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestBuildSignalInvestigationIncludesRelatedSignalsAndMarkdown(t *testing.T) {
	primary := dto.NamespaceInsightSignalDTO{
		Kind:          "Pod",
		Namespace:     "default",
		Name:          "api-0",
		Severity:      "high",
		Score:         90,
		Reason:        "Pod is restarting frequently.",
		SignalType:    "pod_restarts",
		ResourceKind:  "Pod",
		ResourceName:  "api-0",
		Scope:         ResourceSignalsScopeNamespace,
		ScopeLocation: "default",
		HistoryKey:    "pod_restarts|namespace|default|Pod|api-0",
	}
	sameResource := dto.NamespaceInsightSignalDTO{
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "api-0",
		Severity:     "medium",
		Score:        70,
		Reason:       "Pod reports warning events.",
		SignalType:   "pod_warning_events",
		ResourceKind: "Pod",
		ResourceName: "api-0",
		HistoryKey:   "pod_warning_events|namespace|default|Pod|api-0",
	}
	sameNamespace := dto.NamespaceInsightSignalDTO{
		Kind:         "Service",
		Namespace:    "default",
		Name:         "api",
		Severity:     "medium",
		Score:        60,
		Reason:       "Service has no ready endpoints.",
		SignalType:   "service_no_ready_endpoints",
		ResourceKind: "Service",
		ResourceName: "api",
		HistoryKey:   "service_no_ready_endpoints|namespace|default|Service|api",
	}
	otherNamespace := dto.NamespaceInsightSignalDTO{
		Kind:         "Pod",
		Namespace:    "other",
		Name:         "api-1",
		Severity:     "high",
		Score:        80,
		Reason:       "Another pod is restarting frequently.",
		SignalType:   "pod_restarts",
		ResourceKind: "Pod",
		ResourceName: "api-1",
		HistoryKey:   "pod_restarts|namespace|other|Pod|api-1",
	}

	result := BuildSignalInvestigation(
		primary,
		[]dto.NamespaceInsightSignalDTO{primary, sameResource},
		[]dto.NamespaceInsightSignalDTO{sameNamespace, otherNamespace},
		SnapshotMetadata{},
	)

	if result.PrimaryResource.Kind != "Pod" || result.PrimaryResource.Name != "api-0" || result.PrimaryResource.Namespace != "default" {
		t.Fatalf("unexpected primary resource: %+v", result.PrimaryResource)
	}
	if len(result.RelatedSignals) != 1 {
		t.Fatalf("related signals len = %d, want 1: %+v", len(result.RelatedSignals), result.RelatedSignals)
	}
	if len(result.ContextSignals) != 2 {
		t.Fatalf("context signals len = %d, want 2: %+v", len(result.ContextSignals), result.ContextSignals)
	}
	if len(result.RelatedResources) != 0 {
		t.Fatalf("related resources len = %d, want 0 until strong relation edges are available: %+v", len(result.RelatedResources), result.RelatedResources)
	}
	if result.Diagnosis.Summary == "" || result.Diagnosis.Confidence == "" {
		t.Fatalf("diagnosis missing summary/confidence: %+v", result.Diagnosis)
	}
	if !strings.Contains(result.ExportMarkdown, "Pod is restarting frequently.") {
		t.Fatalf("export markdown missing primary reason:\n%s", result.ExportMarkdown)
	}
	if !strings.Contains(result.ExportMarkdown, "Service has no ready endpoints.") {
		t.Fatalf("export markdown missing related signal:\n%s", result.ExportMarkdown)
	}
}
