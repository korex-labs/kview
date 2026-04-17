package pods

import (
	"context"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
)

func ListPodsBySelector(ctx context.Context, c *cluster.Clients, namespace, selector string) ([]corev1.Pod, error) {
	listOpts := metav1.ListOptions{}
	if selector != "" {
		listOpts.LabelSelector = selector
	}
	pods, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, err
	}
	return pods.Items, nil
}
