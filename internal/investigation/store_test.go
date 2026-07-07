package investigation

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestFileStoreCreateListGetDeleteSnapshots(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "snapshots.json"))

	saved, err := store.Save(Snapshot{
		Context:     "kind-dev",
		Title:       "CrashLoopBackOff on api pod",
		TriageState: TriageInvestigating,
		Signal:      SignalRef{Type: "pod_crash_loop_waiting", Severity: "high"},
		PrimaryResource: ResourceRef{
			Kind:      "pods",
			Namespace: "app-prod",
			Name:      "api-7f",
		},
		RelatedResources:   []ResourceRef{{Kind: "deployments", Namespace: "app-prod", Name: "api"}},
		RelatedSignalTypes: []string{"pod_restart_elevated", "pod_crash_loop_waiting", "pod_crash_loop_waiting"},
		Markdown:           "# Debug bundle\n\nEvidence here.",
		OperatorNote:       "Check rollout image.",
		RunbookURLs:        []string{"https://runbooks.example.invalid/pods", "https://runbooks.example.invalid/pods"},
		Source:             "investigate-signal",
	})
	if err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	if saved.ID == "" || saved.CreatedAt == 0 || saved.UpdatedAt == 0 {
		t.Fatalf("snapshot metadata not populated: %#v", saved)
	}
	if got := len(saved.RelatedSignalTypes); got != 2 {
		t.Fatalf("dedupe related signal types: got %d", got)
	}
	if got := len(saved.RunbookURLs); got != 1 {
		t.Fatalf("dedupe runbook urls: got %d", got)
	}

	byID, ok, err := store.Get(saved.ID)
	if err != nil || !ok {
		t.Fatalf("get snapshot ok=%v err=%v", ok, err)
	}
	if byID.PrimaryResource.Name != "api-7f" {
		t.Fatalf("primary resource name: got %q", byID.PrimaryResource.Name)
	}

	all, err := store.List(ListFilter{Context: "kind-dev"})
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(all) != 1 || all[0].ID != saved.ID {
		t.Fatalf("list context snapshots: %#v", all)
	}

	resource, err := store.List(ListFilter{Context: "kind-dev", Kind: "Pods", Namespace: "app-prod", Name: "api-7f"})
	if err != nil {
		t.Fatalf("list resource snapshots: %v", err)
	}
	if len(resource) != 1 || resource[0].ID != saved.ID {
		t.Fatalf("list resource snapshots: %#v", resource)
	}

	otherContext, err := store.List(ListFilter{Context: "other"})
	if err != nil {
		t.Fatalf("list other context: %v", err)
	}
	if len(otherContext) != 0 {
		t.Fatalf("expected context isolation, got %#v", otherContext)
	}

	if err := store.Delete(saved.ID); err != nil {
		t.Fatalf("delete snapshot: %v", err)
	}
	_, ok, err = store.Get(saved.ID)
	if err != nil || ok {
		t.Fatalf("get after delete ok=%v err=%v", ok, err)
	}
	if err := store.Delete(saved.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing: got %v", err)
	}
}

func TestFileStoreRejectsInvalidSnapshot(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "snapshots.json"))
	_, err := store.Save(Snapshot{
		Context: "kind-dev",
		Title:   "Missing signal/resource/markdown",
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}
