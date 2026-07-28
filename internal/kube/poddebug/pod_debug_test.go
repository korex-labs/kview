package poddebug

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func runningPod() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "default", UID: types.UID("pod-uid"), ResourceVersion: "42"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "app:v1"}}},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name: "app", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
			}},
		},
	}
}

func validRequest() StartRequest {
	return StartRequest{
		Pod:             "api-0",
		ExpectedUID:     types.UID("pod-uid"),
		TargetContainer: "app",
		Image:           "registry.example/debug-tools:v1",
		Shell:           "/bin/sh",
		Profile:         ProfileBaseline,
		RequestID:       "request-123",
	}
}

func TestStartPatchesEphemeralContainerSubresource(t *testing.T) {
	client := fake.NewSimpleClientset(runningPod())
	client.PrependReactor("patch", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(ktesting.PatchAction)
		if got := patchAction.GetSubresource(); got != "ephemeralcontainers" {
			t.Fatalf("subresource: got %q", got)
		}
		if got := patchAction.GetPatchType(); got != types.StrategicMergePatchType {
			t.Fatalf("patch type: got %q", got)
		}
		var body struct {
			Metadata struct {
				UID             string `json:"uid"`
				ResourceVersion string `json:"resourceVersion"`
			} `json:"metadata"`
			Spec struct {
				EphemeralContainers []corev1.EphemeralContainer `json:"ephemeralContainers"`
			} `json:"spec"`
		}
		if err := json.Unmarshal(patchAction.GetPatch(), &body); err != nil {
			t.Fatalf("decode patch: %v", err)
		}
		if len(body.Spec.EphemeralContainers) != 1 {
			t.Fatalf("ephemeral containers: got %d", len(body.Spec.EphemeralContainers))
		}
		if body.Metadata.UID != "pod-uid" || body.Metadata.ResourceVersion != "42" {
			t.Fatalf("missing Pod identity precondition: %#v", body.Metadata)
		}
		container := body.Spec.EphemeralContainers[0]
		if container.Name != debugContainerName("request-123") || container.TargetContainerName != "app" {
			t.Fatalf("unexpected container: %#v", container)
		}
		if !container.Stdin || container.StdinOnce || !container.TTY || len(container.Command) != 1 || container.Command[0] != "/bin/sh" {
			t.Fatalf("unexpected terminal settings: %#v", container.EphemeralContainerCommon)
		}
		return true, runningPod(), nil
	})

	result, err := Start(context.Background(), client.CoreV1().Pods("default"), validRequest())
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if result.DebugContainer != debugContainerName("request-123") || result.Reused {
		t.Fatalf("result: %#v", result)
	}
}

func TestStartIsIdempotentForMatchingContainer(t *testing.T) {
	pod := runningPod()
	req := validRequest()
	pod.Spec.EphemeralContainers = []corev1.EphemeralContainer{{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name: debugContainerName(req.RequestID), Image: req.Image, ImagePullPolicy: corev1.PullIfNotPresent, Command: []string{req.Shell}, Stdin: true, TTY: true, TerminationMessagePolicy: corev1.TerminationMessageReadFile,
		},
		TargetContainerName: req.TargetContainer,
	}}
	client := fake.NewSimpleClientset(pod)

	result, err := Start(context.Background(), client.CoreV1().Pods("default"), req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !result.Reused {
		t.Fatalf("expected reused result: %#v", result)
	}
	for _, action := range client.Actions() {
		if action.GetVerb() == "patch" {
			t.Fatal("idempotent request unexpectedly patched the Pod")
		}
	}
}

func TestStartRejectsUnsafeOrStaleTargets(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*corev1.Pod)
		req    func(StartRequest) StartRequest
		want   error
	}{
		{name: "uid changed", mutate: func(*corev1.Pod) {}, req: func(req StartRequest) StartRequest { req.ExpectedUID = "other"; return req }, want: ErrPodChanged},
		{name: "not running", mutate: func(p *corev1.Pod) { p.Status.Phase = corev1.PodSucceeded }, req: func(req StartRequest) StartRequest { return req }, want: ErrPodNotRunning},
		{name: "static pod", mutate: func(p *corev1.Pod) { p.Annotations = map[string]string{corev1.MirrorPodAnnotationKey: "hash"} }, req: func(req StartRequest) StartRequest { return req }, want: ErrStaticPod},
		{name: "windows pod", mutate: func(p *corev1.Pod) { p.Spec.OS = &corev1.PodOS{Name: corev1.Windows} }, req: func(req StartRequest) StartRequest { return req }, want: ErrWindowsPod},
		{name: "missing target", mutate: func(*corev1.Pod) {}, req: func(req StartRequest) StartRequest { req.TargetContainer = "missing"; return req }, want: ErrInvalidRequest},
		{name: "target not running", mutate: func(p *corev1.Pod) {
			p.Status.ContainerStatuses[0].State = corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}
		}, req: func(req StartRequest) StartRequest { return req }, want: ErrTargetNotRunning},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pod := runningPod()
			tc.mutate(pod)
			client := fake.NewSimpleClientset(pod)
			_, err := Start(context.Background(), client.CoreV1().Pods("default"), tc.req(validRequest()))
			if !errors.Is(err, tc.want) {
				t.Fatalf("error: got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestStartRejectsConflictingIdempotencyName(t *testing.T) {
	pod := runningPod()
	req := validRequest()
	pod.Spec.EphemeralContainers = []corev1.EphemeralContainer{{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: debugContainerName(req.RequestID), Image: "other:v1"},
	}}
	client := fake.NewSimpleClientset(pod)
	_, err := Start(context.Background(), client.CoreV1().Pods("default"), req)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error: got %v, want conflict", err)
	}
}

func TestStartRecoversAppliedPatchAfterTimeout(t *testing.T) {
	req := validRequest()
	client := fake.NewSimpleClientset()
	getCalls := 0
	client.PrependReactor("get", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		getCalls++
		pod := runningPod()
		if getCalls > 1 {
			pod.Spec.EphemeralContainers = []corev1.EphemeralContainer{{
				EphemeralContainerCommon: corev1.EphemeralContainerCommon{
					Name: debugContainerName(req.RequestID), Image: req.Image, ImagePullPolicy: corev1.PullIfNotPresent, Command: []string{req.Shell}, Stdin: true, TTY: true, TerminationMessagePolicy: corev1.TerminationMessageReadFile,
				},
				TargetContainerName: req.TargetContainer,
			}}
		}
		return true, pod, nil
	})
	client.PrependReactor("patch", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewTimeoutError("patch result unknown", 1)
	})

	result, err := Start(context.Background(), client.CoreV1().Pods("default"), req)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !result.Reused || result.DebugContainer != debugContainerName(req.RequestID) {
		t.Fatalf("expected recovered idempotent result, got %#v", result)
	}
}
