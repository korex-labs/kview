package jobdebug

import (
	"context"
	"sync"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestManager_StartNilClients(t *testing.T) {
	m := NewManager()
	_, err := m.Start(context.Background(), nil, StartRequest{
		Context:   "ctx",
		Namespace: "default",
		Name:      "my-job",
		Kind:      SourceJob,
	})
	if err == nil {
		t.Fatal("expected error for nil clients")
	}
}

func TestManager_StartMissingFields(t *testing.T) {
	m := NewManager()
	cases := []StartRequest{
		{Namespace: "ns", Name: "n"},      // missing Context
		{Context: "ctx", Name: "n"},       // missing Namespace
		{Context: "ctx", Namespace: "ns"}, // missing Name
	}
	for _, req := range cases {
		_, err := m.Start(context.Background(), nil, req)
		if err == nil {
			t.Errorf("expected error for req %+v", req)
		}
	}
}

func TestManager_GetNonExistent(t *testing.T) {
	m := NewManager()
	_, ok := m.Get("does-not-exist")
	if ok {
		t.Fatal("expected Get to return false for unknown ID")
	}
}

func TestManager_CloseNonExistent(t *testing.T) {
	m := NewManager()
	// should not panic
	m.Close("does-not-exist")
}

func TestManager_ConcurrentGetClose(t *testing.T) {
	m := NewManager()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			m.Get("unknown")
		}()
		go func() {
			defer wg.Done()
			m.Close("unknown")
		}()
	}
	wg.Wait()
}

func TestMapContainerStatuses(t *testing.T) {
	items := []corev1.ContainerStatus{
		{Name: "app", RestartCount: 1},
		{Name: "sidecar", RestartCount: 0},
	}
	m := mapContainerStatuses(items)
	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m["app"].RestartCount != 1 {
		t.Fatalf("app restart count: got %d, want 1", m["app"].RestartCount)
	}
	if m["sidecar"].RestartCount != 0 {
		t.Fatalf("sidecar restart count: got %d, want 0", m["sidecar"].RestartCount)
	}
}

func TestContainerLogKey(t *testing.T) {
	if containerLogKey("pod", "c", false) != "pod/c/current" {
		t.Fatal("expected pod/c/current")
	}
	if containerLogKey("pod", "c", true) != "pod/c/previous" {
		t.Fatal("expected pod/c/previous")
	}
}

func TestFirstNonEmpty(t *testing.T) {
	if firstNonEmpty("", "b", "c") != "b" {
		t.Fatal("expected b")
	}
	if firstNonEmpty("", "  ", "c") != "c" {
		t.Fatal("expected c")
	}
	if firstNonEmpty("", "") != "" {
		t.Fatal("expected empty")
	}
}

func TestShouldCapturePreviousLogs(t *testing.T) {
	status := corev1.ContainerStatus{
		Name:         "worker",
		RestartCount: 1,
		LastTerminationState: corev1.ContainerState{
			Terminated: &corev1.ContainerStateTerminated{ExitCode: 127},
		},
	}

	if !shouldCapturePreviousLogs(status, 0) {
		t.Fatal("expected terminated restart to capture previous logs")
	}
	if shouldCapturePreviousLogs(status, 1) {
		t.Fatal("did not expect to recapture the same restart count")
	}

	status.RestartCount = 0
	if shouldCapturePreviousLogs(status, 0) {
		t.Fatal("did not expect previous logs before a restart")
	}

	status.RestartCount = 2
	status.LastTerminationState.Terminated = nil
	if shouldCapturePreviousLogs(status, 1) {
		t.Fatal("did not expect previous logs without a terminated state")
	}
}
