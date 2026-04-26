package pods

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestFmtReady(t *testing.T) {
	cases := []struct {
		name  string
		ready int
		total int
		want  string
	}{
		{"zero total", 0, 0, "0/0"},
		{"none ready", 0, 3, "0/3"},
		{"partially ready", 1, 3, "1/3"},
		{"all ready", 3, 3, "3/3"},
		{"single ready", 1, 1, "1/1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := FmtReady(tc.ready, tc.total); got != tc.want {
				t.Fatalf("FmtReady(%d, %d) = %q, want %q", tc.ready, tc.total, got, tc.want)
			}
		})
	}
}

func TestPodHealthReason(t *testing.T) {
	cases := []struct {
		name       string
		conditions []corev1.PodCondition
		want       string
	}{
		{
			name:       "no conditions",
			conditions: nil,
			want:       "",
		},
		{
			name: "all conditions true",
			conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue, Reason: "Ready"},
				{Type: corev1.PodScheduled, Status: corev1.ConditionTrue, Reason: "PodScheduled"},
			},
			want: "",
		},
		{
			name: "one condition false with reason",
			conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionFalse, Reason: "ContainersNotReady"},
			},
			want: "ContainersNotReady",
		},
		{
			name: "false condition without reason skipped",
			conditions: []corev1.PodCondition{
				{Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Reason: ""},
				{Type: corev1.PodReady, Status: corev1.ConditionFalse, Reason: "Unschedulable"},
			},
			want: "Unschedulable",
		},
		{
			name: "returns first false reason",
			conditions: []corev1.PodCondition{
				{Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Reason: "Unschedulable"},
				{Type: corev1.PodReady, Status: corev1.ConditionFalse, Reason: "ContainersNotReady"},
			},
			want: "Unschedulable",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := podHealthReason(tc.conditions); got != tc.want {
				t.Fatalf("podHealthReason() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSumContainerResources(t *testing.T) {
	mustCPU := func(s string) resource.Quantity { return resource.MustParse(s) }
	mustMem := func(s string) resource.Quantity { return resource.MustParse(s) }

	cases := []struct {
		name       string
		containers []corev1.Container
		wantCPUReq int64
		wantCPULim int64
		wantMemReq int64
		wantMemLim int64
	}{
		{
			name:       "no containers",
			containers: nil,
		},
		{
			name: "single container cpu request only",
			containers: []corev1.Container{
				{Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: mustCPU("500m")},
				}},
			},
			wantCPUReq: 500,
		},
		{
			name: "single container all fields",
			containers: []corev1.Container{
				{Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    mustCPU("250m"),
						corev1.ResourceMemory: mustMem("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    mustCPU("1"),
						corev1.ResourceMemory: mustMem("256Mi"),
					},
				}},
			},
			wantCPUReq: 250,
			wantCPULim: 1000,
			wantMemReq: 128 * 1024 * 1024,
			wantMemLim: 256 * 1024 * 1024,
		},
		{
			name: "multiple containers summed",
			containers: []corev1.Container{
				{Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: mustCPU("100m")},
					Limits:   corev1.ResourceList{corev1.ResourceCPU: mustCPU("200m")},
				}},
				{Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: mustCPU("300m")},
					Limits:   corev1.ResourceList{corev1.ResourceCPU: mustCPU("400m")},
				}},
			},
			wantCPUReq: 400,
			wantCPULim: 600,
		},
		{
			name: "missing fields contribute zero",
			containers: []corev1.Container{
				{Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceMemory: mustMem("64Mi")},
				}},
			},
			wantMemReq: 64 * 1024 * 1024,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cpuReq, cpuLim, memReq, memLim := sumContainerResources(tc.containers)
			if cpuReq != tc.wantCPUReq || cpuLim != tc.wantCPULim || memReq != tc.wantMemReq || memLim != tc.wantMemLim {
				t.Fatalf("sumContainerResources() = (%d, %d, %d, %d), want (%d, %d, %d, %d)",
					cpuReq, cpuLim, memReq, memLim,
					tc.wantCPUReq, tc.wantCPULim, tc.wantMemReq, tc.wantMemLim)
			}
		})
	}
}

func TestMapContainerState(t *testing.T) {
	ts := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name          string
		state         corev1.ContainerState
		wantState     string
		wantReason    string
		wantMessage   string
		wantStartedAt int64
		wantFinished  int64
	}{
		{
			name:      "empty state is unknown",
			state:     corev1.ContainerState{},
			wantState: "Unknown",
		},
		{
			name: "running with start time",
			state: corev1.ContainerState{
				Running: &corev1.ContainerStateRunning{StartedAt: metav1.NewTime(ts)},
			},
			wantState:     "Running",
			wantStartedAt: ts.Unix(),
		},
		{
			name: "running with zero start time",
			state: corev1.ContainerState{
				Running: &corev1.ContainerStateRunning{},
			},
			wantState:     "Running",
			wantStartedAt: 0,
		},
		{
			name: "waiting with reason and message",
			state: corev1.ContainerState{
				Waiting: &corev1.ContainerStateWaiting{
					Reason:  "CrashLoopBackOff",
					Message: "back-off restarting failed container",
				},
			},
			wantState:   "Waiting",
			wantReason:  "CrashLoopBackOff",
			wantMessage: "back-off restarting failed container",
		},
		{
			name: "terminated with all fields",
			state: corev1.ContainerState{
				Terminated: &corev1.ContainerStateTerminated{
					Reason:     "OOMKilled",
					Message:    "container killed",
					StartedAt:  metav1.NewTime(ts),
					FinishedAt: metav1.NewTime(ts.Add(10 * time.Second)),
				},
			},
			wantState:     "Terminated",
			wantReason:    "OOMKilled",
			wantMessage:   "container killed",
			wantStartedAt: ts.Unix(),
			wantFinished:  ts.Add(10 * time.Second).Unix(),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state, reason, message, startedAt, finished := mapContainerState(tc.state)
			if state != tc.wantState {
				t.Errorf("state = %q, want %q", state, tc.wantState)
			}
			if reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", reason, tc.wantReason)
			}
			if message != tc.wantMessage {
				t.Errorf("message = %q, want %q", message, tc.wantMessage)
			}
			if startedAt != tc.wantStartedAt {
				t.Errorf("startedAt = %d, want %d", startedAt, tc.wantStartedAt)
			}
			if finished != tc.wantFinished {
				t.Errorf("finishedAt = %d, want %d", finished, tc.wantFinished)
			}
		})
	}
}

func TestSummarizeAffinity(t *testing.T) {
	cases := []struct {
		name     string
		affinity *corev1.Affinity
		want     string
	}{
		{
			name:     "nil affinity",
			affinity: nil,
			want:     "",
		},
		{
			name:     "node affinity only",
			affinity: &corev1.Affinity{NodeAffinity: &corev1.NodeAffinity{}},
			want:     "nodeAffinity",
		},
		{
			name:     "pod affinity only",
			affinity: &corev1.Affinity{PodAffinity: &corev1.PodAffinity{}},
			want:     "podAffinity",
		},
		{
			name:     "pod anti-affinity only",
			affinity: &corev1.Affinity{PodAntiAffinity: &corev1.PodAntiAffinity{}},
			want:     "podAntiAffinity",
		},
		{
			name: "all three",
			affinity: &corev1.Affinity{
				NodeAffinity:    &corev1.NodeAffinity{},
				PodAffinity:     &corev1.PodAffinity{},
				PodAntiAffinity: &corev1.PodAntiAffinity{},
			},
			want: "nodeAffinity, podAffinity, podAntiAffinity",
		},
		{
			name:     "empty affinity struct",
			affinity: &corev1.Affinity{},
			want:     "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := SummarizeAffinity(tc.affinity); got != tc.want {
				t.Fatalf("SummarizeAffinity() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMapContainerResources(t *testing.T) {
	cases := []struct {
		name       string
		resources  corev1.ResourceRequirements
		wantCPUReq string
		wantCPULim string
		wantMemReq string
		wantMemLim string
	}{
		{
			name:      "empty resources",
			resources: corev1.ResourceRequirements{},
		},
		{
			name: "cpu request only",
			resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m")},
			},
			wantCPUReq: "500m",
		},
		{
			name: "all fields set",
			resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("250m"),
					corev1.ResourceMemory: resource.MustParse("128Mi"),
				},
				Limits: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("1"),
					corev1.ResourceMemory: resource.MustParse("256Mi"),
				},
			},
			wantCPUReq: "250m",
			wantMemReq: "128Mi",
			wantCPULim: "1",
			wantMemLim: "256Mi",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := MapContainerResources(tc.resources)
			if got.CPURequest != tc.wantCPUReq {
				t.Errorf("CPURequest = %q, want %q", got.CPURequest, tc.wantCPUReq)
			}
			if got.CPULimit != tc.wantCPULim {
				t.Errorf("CPULimit = %q, want %q", got.CPULimit, tc.wantCPULim)
			}
			if got.MemoryRequest != tc.wantMemReq {
				t.Errorf("MemoryRequest = %q, want %q", got.MemoryRequest, tc.wantMemReq)
			}
			if got.MemoryLimit != tc.wantMemLim {
				t.Errorf("MemoryLimit = %q, want %q", got.MemoryLimit, tc.wantMemLim)
			}
		})
	}
}
