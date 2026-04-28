package deployments

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	pods "github.com/korex-labs/kview/v5/internal/kube/resource/pods"
)

func ListDeployments(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.DeploymentListItemDTO, error) {
	deps, err := c.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	now := time.Now()
	out := make([]dto.DeploymentListItemDTO, 0, len(deps.Items))
	for _, d := range deps.Items {
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
			Name:                d.Name,
			Namespace:           d.Namespace,
			Ready:               pods.FmtReady(int(d.Status.AvailableReplicas), int(desired)),
			UpToDate:            d.Status.UpdatedReplicas,
			Available:           d.Status.AvailableReplicas,
			Strategy:            strategy,
			AgeSec:              age,
			LastRolloutComplete: deploymentLastRolloutComplete(d),
			Status:              status,
		})
	}
	return out, nil
}

func deploymentLastRolloutComplete(d appsv1.Deployment) int64 {
	var progressingCond *appsv1.DeploymentCondition
	var availableCond *appsv1.DeploymentCondition
	for i := range d.Status.Conditions {
		cond := &d.Status.Conditions[i]
		switch cond.Type {
		case appsv1.DeploymentProgressing:
			progressingCond = cond
		case appsv1.DeploymentAvailable:
			availableCond = cond
		}
	}
	if availableCond != nil && availableCond.Status == corev1.ConditionTrue {
		return conditionUpdateTime(availableCond)
	}
	if progressingCond != nil && progressingCond.Reason == "NewReplicaSetAvailable" {
		return conditionUpdateTime(progressingCond)
	}
	return 0
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
