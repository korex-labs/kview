package pods

import (
	"context"
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
	svcs "github.com/alex-mamchenkov/kview/internal/kube/resource/services"
)

func ListServicesSelectingPod(ctx context.Context, c *cluster.Clients, namespace, podName string) ([]dto.ServiceLinkDTO, error) {
	pod, err := c.Clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	if len(pod.Labels) == 0 {
		return []dto.ServiceLinkDTO{}, nil
	}

	services, err := c.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	endpointsByName := map[string]*corev1.Endpoints{}
	if endpoints, err := c.Clientset.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{}); err == nil {
		endpointsByName = make(map[string]*corev1.Endpoints, len(endpoints.Items))
		for i := range endpoints.Items {
			ep := endpoints.Items[i]
			endpointsByName[ep.Name] = &ep
		}
	}

	out := make([]dto.ServiceLinkDTO, 0)
	for _, svc := range services.Items {
		if len(svc.Spec.Selector) == 0 {
			continue
		}
		if !selectorMatchesLabels(svc.Spec.Selector, pod.Labels) {
			continue
		}

		ready, notReady := svcs.EndpointsCounts(endpointsByName[svc.Name])
		selector := map[string]string{}
		for k, v := range svc.Spec.Selector {
			selector[k] = v
		}
		if len(selector) == 0 {
			selector = nil
		}

		out = append(out, dto.ServiceLinkDTO{
			Name:              svc.Name,
			Namespace:         svc.Namespace,
			Type:              svcs.ServiceType(svc.Spec.Type),
			Selector:          selector,
			PortsSummary:      svcs.FormatServicePortsSummary(svc.Spec.Ports),
			EndpointsReady:    int32(ready),
			EndpointsNotReady: int32(notReady),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace == out[j].Namespace {
			return out[i].Name < out[j].Name
		}
		return out[i].Namespace < out[j].Namespace
	})

	return out, nil
}

func selectorMatchesLabels(selector, labels map[string]string) bool {
	if len(selector) == 0 || len(labels) == 0 {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}
