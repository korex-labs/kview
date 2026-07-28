package poddebug

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

const (
	TerminalKindPodDebug = "pod-debug"
	StreamModeAttach     = "attach"
	DefaultShell         = "/bin/sh"
	ProfileBaseline      = "baseline"
)

var (
	ErrInvalidRequest   = errors.New("invalid pod debug request")
	ErrPodChanged       = errors.New("pod identity changed")
	ErrPodNotRunning    = errors.New("pod is not running")
	ErrStaticPod        = errors.New("static pods do not support ephemeral containers")
	ErrWindowsPod       = errors.New("pod debug currently supports Linux pods only")
	ErrTargetNotRunning = errors.New("target container is not running")
	ErrConflict         = errors.New("debug container name conflicts with an existing container")
)

type StartRequest struct {
	Pod             string
	ExpectedUID     types.UID
	TargetContainer string
	Image           string
	Shell           string
	Profile         string
	RequestID       string
}

type StartResult struct {
	DebugContainer  string `json:"debugContainer"`
	Image           string `json:"image"`
	TargetContainer string `json:"targetContainer"`
	Reused          bool   `json:"reused"`
}

func Start(ctx context.Context, pods corev1client.PodInterface, req StartRequest) (StartResult, error) {
	req.Pod = strings.TrimSpace(req.Pod)
	req.TargetContainer = strings.TrimSpace(req.TargetContainer)
	req.Image = strings.TrimSpace(req.Image)
	req.Shell = strings.TrimSpace(req.Shell)
	req.Profile = strings.TrimSpace(req.Profile)
	req.RequestID = strings.TrimSpace(req.RequestID)
	if req.Shell == "" {
		req.Shell = DefaultShell
	}
	if req.Profile == "" {
		req.Profile = ProfileBaseline
	}
	if req.Pod == "" || req.ExpectedUID == "" || req.TargetContainer == "" || req.Image == "" || req.RequestID == "" {
		return StartResult{}, fmt.Errorf("%w: pod, expectedUID, targetContainer, image, and requestId are required", ErrInvalidRequest)
	}
	if len(req.Image) > 1024 || len(req.Shell) > 256 || len(req.RequestID) > 256 {
		return StartResult{}, fmt.Errorf("%w: image, shell, or requestId is too long", ErrInvalidRequest)
	}
	if !strings.HasPrefix(req.Shell, "/") {
		return StartResult{}, fmt.Errorf("%w: shell must be an absolute path", ErrInvalidRequest)
	}
	if req.Profile != ProfileBaseline {
		return StartResult{}, fmt.Errorf("%w: unsupported profile %q", ErrInvalidRequest, req.Profile)
	}

	pod, err := pods.Get(ctx, req.Pod, metav1.GetOptions{})
	if err != nil {
		return StartResult{}, err
	}
	if pod.UID != req.ExpectedUID {
		return StartResult{}, fmt.Errorf("%w: expected UID %q, got %q", ErrPodChanged, req.ExpectedUID, pod.UID)
	}
	if pod.DeletionTimestamp != nil || pod.Status.Phase != corev1.PodRunning {
		return StartResult{}, fmt.Errorf("%w: phase=%s", ErrPodNotRunning, pod.Status.Phase)
	}
	if pod.Annotations[corev1.MirrorPodAnnotationKey] != "" {
		return StartResult{}, ErrStaticPod
	}
	if pod.Spec.OS != nil && pod.Spec.OS.Name == corev1.Windows {
		return StartResult{}, ErrWindowsPod
	}

	targetFound := false
	for _, container := range pod.Spec.Containers {
		if container.Name == req.TargetContainer {
			targetFound = true
			break
		}
	}
	if !targetFound {
		return StartResult{}, fmt.Errorf("%w: target container %q does not exist", ErrInvalidRequest, req.TargetContainer)
	}
	targetRunning := false
	for _, status := range pod.Status.ContainerStatuses {
		if status.Name == req.TargetContainer && status.State.Running != nil {
			targetRunning = true
			break
		}
	}
	if !targetRunning {
		return StartResult{}, fmt.Errorf("%w: %s", ErrTargetNotRunning, req.TargetContainer)
	}

	debugName := debugContainerName(req.RequestID)
	for _, container := range pod.Spec.Containers {
		if container.Name == debugName {
			return StartResult{}, fmt.Errorf("%w: %s", ErrConflict, debugName)
		}
	}
	for _, container := range pod.Spec.InitContainers {
		if container.Name == debugName {
			return StartResult{}, fmt.Errorf("%w: %s", ErrConflict, debugName)
		}
	}
	for _, container := range pod.Spec.EphemeralContainers {
		if container.Name != debugName {
			continue
		}
		if sameDebugContainer(container, req) {
			return StartResult{DebugContainer: debugName, Image: req.Image, TargetContainer: req.TargetContainer, Reused: true}, nil
		}
		return StartResult{}, fmt.Errorf("%w: %s", ErrConflict, debugName)
	}

	container := corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:                     debugName,
			Image:                    req.Image,
			ImagePullPolicy:          corev1.PullIfNotPresent,
			Command:                  []string{req.Shell},
			Stdin:                    true,
			StdinOnce:                false,
			TTY:                      true,
			TerminationMessagePolicy: corev1.TerminationMessageReadFile,
		},
		TargetContainerName: req.TargetContainer,
	}
	patch, err := json.Marshal(map[string]any{
		"metadata": map[string]any{
			"uid":             string(req.ExpectedUID),
			"resourceVersion": pod.ResourceVersion,
		},
		"spec": map[string]any{
			"ephemeralContainers": []corev1.EphemeralContainer{container},
		},
	})
	if err != nil {
		return StartResult{}, fmt.Errorf("encode ephemeral container patch: %w", err)
	}
	if _, err := pods.Patch(ctx, req.Pod, types.StrategicMergePatchType, patch, metav1.PatchOptions{}, "ephemeralcontainers"); err != nil {
		if apierrors.IsConflict(err) {
			return StartResult{}, fmt.Errorf("%w: %v", ErrConflict, err)
		}
		if apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) || errors.Is(err, context.DeadlineExceeded) {
			verifyCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			defer cancel()
			current, getErr := pods.Get(verifyCtx, req.Pod, metav1.GetOptions{})
			if getErr == nil {
				for _, existing := range current.Spec.EphemeralContainers {
					if existing.Name != debugName {
						continue
					}
					if sameDebugContainer(existing, req) {
						return StartResult{DebugContainer: debugName, Image: req.Image, TargetContainer: req.TargetContainer, Reused: true}, nil
					}
					return StartResult{}, fmt.Errorf("%w: %s", ErrConflict, debugName)
				}
			}
		}
		return StartResult{}, err
	}
	return StartResult{DebugContainer: debugName, Image: req.Image, TargetContainer: req.TargetContainer}, nil
}

func debugContainerName(requestID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(requestID)))
	return "kview-debug-" + hex.EncodeToString(sum[:6])
}

func sameDebugContainer(container corev1.EphemeralContainer, req StartRequest) bool {
	return container.Image == req.Image &&
		container.ImagePullPolicy == corev1.PullIfNotPresent &&
		container.TargetContainerName == req.TargetContainer &&
		len(container.Command) == 1 && container.Command[0] == req.Shell &&
		len(container.Args) == 0 && len(container.Env) == 0 && len(container.EnvFrom) == 0 &&
		len(container.Ports) == 0 && len(container.VolumeMounts) == 0 && len(container.VolumeDevices) == 0 &&
		container.SecurityContext == nil && container.WorkingDir == "" &&
		container.TerminationMessagePolicy == corev1.TerminationMessageReadFile &&
		container.Stdin && !container.StdinOnce && container.TTY
}
