package events

import (
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestFilterAndPaginateEvents(t *testing.T) {
	items := []dto.EventDTO{
		{Type: "Normal", Reason: "Pulled", Message: "container image pulled", LastSeen: 30, FieldPath: "spec.containers{api-server}", InvolvedKind: "Pod", InvolvedName: "demo"},
		{Type: "Warning", Reason: "BackOff", Message: "back-off restarting failed container", LastSeen: 20, FieldPath: "spec.containers{worker-1}", InvolvedKind: "Pod", InvolvedName: "demo"},
		{Type: "Warning", Reason: "FailedScheduling", Message: "insufficient cpu", LastSeen: 10, InvolvedKind: "Pod", InvolvedName: "demo"},
	}

	got := FilterAndPaginate(items, ListOptions{Limit: 1, Offset: 0, Query: "warning"})
	if got.Total != 2 || len(got.Items) != 1 || !got.HasMore {
		t.Fatalf("first warning page = %+v", got)
	}
	if got.Items[0].Reason != "BackOff" {
		t.Fatalf("first warning item = %+v", got.Items[0])
	}

	got = FilterAndPaginate(items, ListOptions{Limit: 10, SubResource: "api-server"})
	if got.Total != 1 || len(got.Items) != 1 || got.Items[0].Reason != "Pulled" {
		t.Fatalf("container filtered page = %+v", got)
	}

	got = FilterAndPaginate(items, ListOptions{Limit: 10, Type: "Warning"})
	if got.Total != 2 || len(got.Items) != 2 {
		t.Fatalf("type filtered page = %+v", got)
	}
}
