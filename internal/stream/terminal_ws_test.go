package stream

import (
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestNewTerminalSizeQueue_InitialSize(t *testing.T) {
	q := newTerminalSizeQueue()
	defer q.Close()
	size := q.Next()
	if size == nil {
		t.Fatal("expected initial size to be present")
	}
	if size.Width != 80 || size.Height != 24 {
		t.Errorf("expected 80x24, got %dx%d", size.Width, size.Height)
	}
}

func TestTerminalSizeQueue_PushIgnoresZeroCols(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next() // drain initial
	q.Push(0, 24)
	select {
	case <-q.ch:
		t.Fatal("zero cols should not enqueue a size")
	default:
	}
}

func TestTerminalSizeQueue_PushIgnoresZeroRows(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next() // drain initial
	q.Push(80, 0)
	select {
	case <-q.ch:
		t.Fatal("zero rows should not enqueue a size")
	default:
	}
}

func TestTerminalSizeQueue_PushAndReceive(t *testing.T) {
	q := newTerminalSizeQueue()
	defer q.Close()
	q.Next() // drain initial
	q.Push(120, 40)
	size := q.Next()
	if size == nil {
		t.Fatal("expected a size")
	}
	if size.Width != 120 || size.Height != 40 {
		t.Errorf("expected 120x40, got %dx%d", size.Width, size.Height)
	}
}

func TestTerminalSizeQueue_PushDropsOlderWhenFull(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next() // drain initial – channel now empty

	q.Push(100, 30) // fills the channel (capacity 1)
	q.Push(200, 50) // should replace the pending entry

	size := q.Next()
	if size == nil {
		t.Fatal("expected a size")
	}
	if size.Width != 200 || size.Height != 50 {
		t.Errorf("expected latest size 200x50, got %dx%d", size.Width, size.Height)
	}
}

func TestTerminalSizeQueue_CloseUnblocksNext(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next() // drain initial

	done := make(chan struct{})
	go func() {
		defer close(done)
		q.Next() // should unblock when channel is closed
	}()

	q.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Next did not return after Close")
	}
}

func TestTerminalSizeQueue_CloseIdempotent(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next()
	q.Close()
	q.Close() // must not panic
}

func TestTerminalSizeQueue_PushAfterCloseNoPanic(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next()
	q.Close()
	q.Push(80, 24) // must not panic
}

func TestTerminalSizeQueue_NextReturnsNilAfterClose(t *testing.T) {
	q := newTerminalSizeQueue()
	q.Next() // drain initial
	q.Close()
	size := q.Next()
	if size != nil {
		t.Errorf("expected nil after Close, got %+v", size)
	}
}

func TestWaitForEphemeralContainerRunning(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
		Spec: corev1.PodSpec{EphemeralContainers: []corev1.EphemeralContainer{{
			EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "kview-debug-123"},
		}}},
		Status: corev1.PodStatus{EphemeralContainerStatuses: []corev1.ContainerStatus{{
			Name:  "kview-debug-123",
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
		}}},
	}
	client := fake.NewSimpleClientset(pod)
	var statuses []string
	err := waitForEphemeralContainer(context.Background(), client.CoreV1().Pods("default"), pod.Name, "kview-debug-123", func(status string) {
		statuses = append(statuses, status)
	})
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if len(statuses) != 1 || !strings.Contains(statuses[0], "running") {
		t.Fatalf("statuses: %#v", statuses)
	}
}

func TestWaitForEphemeralContainerTerminated(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default"},
		Spec: corev1.PodSpec{EphemeralContainers: []corev1.EphemeralContainer{{
			EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "kview-debug-123"},
		}}},
		Status: corev1.PodStatus{EphemeralContainerStatuses: []corev1.ContainerStatus{{
			Name:  "kview-debug-123",
			State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "Error", ExitCode: 1, Message: "shell failed"}},
		}}},
	}
	client := fake.NewSimpleClientset(pod)
	err := waitForEphemeralContainer(context.Background(), client.CoreV1().Pods("default"), pod.Name, "kview-debug-123", func(string) {})
	if err == nil || !strings.Contains(err.Error(), "shell failed") {
		t.Fatalf("error: %v", err)
	}
}
