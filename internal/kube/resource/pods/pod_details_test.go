package pods

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestMapEphemeralContainers(t *testing.T) {
	started := metav1.NewTime(time.Unix(100, 0))
	finished := metav1.NewTime(time.Unix(120, 0))
	containers := []corev1.EphemeralContainer{
		{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "waiting-debug", Image: "debug:v1"}, TargetContainerName: "app"},
		{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "finished-debug", Image: "debug:v2"}, TargetContainerName: "worker"},
	}
	statuses := []corev1.ContainerStatus{
		{
			Name:    "finished-debug",
			ImageID: "sha256:abc",
			State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
				ExitCode:   7,
				Reason:     "Error",
				Message:    "command failed",
				StartedAt:  started,
				FinishedAt: finished,
			}},
		},
	}

	got := MapEphemeralContainers(containers, statuses)
	if len(got) != 2 {
		t.Fatalf("expected 2 ephemeral containers, got %d", len(got))
	}
	if got[0].State != "Pending" || got[0].TargetContainer != "app" {
		t.Fatalf("unexpected pending container: %#v", got[0])
	}
	if got[1].State != "Terminated" || got[1].ExitCode != 7 || got[1].ImageID != "sha256:abc" {
		t.Fatalf("unexpected terminated container: %#v", got[1])
	}
	if got[1].StartedAt != 100 || got[1].FinishedAt != 120 || got[1].Reason != "Error" {
		t.Fatalf("unexpected termination details: %#v", got[1])
	}
	successful := got[1]
	successful.ExitCode = 0
	payload, err := json.Marshal(successful)
	if err != nil {
		t.Fatalf("marshal successful termination: %v", err)
	}
	if !strings.Contains(string(payload), `"exitCode":0`) {
		t.Fatalf("successful exit code omitted from JSON: %s", payload)
	}
}
