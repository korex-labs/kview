package jobdebug

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

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
