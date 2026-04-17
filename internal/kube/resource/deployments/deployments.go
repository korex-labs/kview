package deployments

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
	kubeevents "github.com/alex-mamchenkov/kview/internal/kube/resource/events"
	pods "github.com/alex-mamchenkov/kview/internal/kube/resource/pods"
)

func ListDeployments(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.DeploymentListItemDTO, error) {
	deps, err := c.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	latestEvents, _ := kubeevents.LatestEventsByObject(ctx, c, namespace, "Deployment")

	now := time.Now()
	out := make([]dto.DeploymentListItemDTO, 0, len(deps.Items))
	for _, d := range deps.Items {
		var lastEvent *dto.EventBriefDTO
		if ev, ok := latestEvents[d.Name]; ok {
			evCopy := ev
			lastEvent = &evCopy
		}

		desired := int32(0)
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}

		age := int64(0)
		if !d.CreationTimestamp.IsZero() {
			age = int64(now.Sub(d.CreationTimestamp.Time).Seconds())
		}

		strategy := string(d.Spec.Strategy.Type)
		if strategy == "" {
			strategy = "RollingUpdate"
		}

		status := DeploymentStatus(d, desired)

		out = append(out, dto.DeploymentListItemDTO{
			Name:      d.Name,
			Namespace: d.Namespace,
			Ready:     pods.FmtReady(int(d.Status.AvailableReplicas), int(desired)),
			UpToDate:  d.Status.UpdatedReplicas,
			Available: d.Status.AvailableReplicas,
			Strategy:  strategy,
			AgeSec:    age,
			LastEvent: lastEvent,
			Status:    status,
		})
	}
	return out, nil
}

func DeploymentStatus(d appsv1.Deployment, desired int32) string {
	if d.Spec.Paused {
		return "Paused"
	}
	if desired == 0 {
		return "ScaledDown"
	}

	available := false
	progressing := false
	for _, c := range d.Status.Conditions {
		switch c.Type {
		case appsv1.DeploymentAvailable:
			if c.Status == corev1.ConditionTrue {
				available = true
			}
		case appsv1.DeploymentProgressing:
			if c.Status == corev1.ConditionTrue {
				progressing = true
			}
		}
	}

	if available && d.Status.AvailableReplicas >= desired && desired > 0 {
		return "Available"
	}
	if progressing {
		return "Progressing"
	}
	return "Unknown"
}
