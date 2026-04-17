package ingresses

import (
	"context"
	"sort"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func ListIngressesForService(ctx context.Context, c *cluster.Clients, namespace, serviceName string) ([]dto.IngressListItemDTO, error) {
	ings, err := c.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	defaultClass := defaultIngressClassName(ctx, c)
	now := time.Now()

	out := make([]dto.IngressListItemDTO, 0)
	for _, ing := range ings.Items {
		if !ingressReferencesService(&ing, serviceName) {
			continue
		}

		age := int64(0)
		if !ing.CreationTimestamp.IsZero() {
			age = int64(now.Sub(ing.CreationTimestamp.Time).Seconds())
		}

		className := ingressClassName(ing.Spec.IngressClassName, ing.Annotations)
		if className == "" {
			className = defaultClass
		}

		out = append(out, dto.IngressListItemDTO{
			Name:             ing.Name,
			Namespace:        ing.Namespace,
			IngressClassName: className,
			Hosts:            collectIngressHosts(&ing),
			TLSCount:         int32(len(ing.Spec.TLS)),
			Addresses:        mapIngressLoadBalancerIngress(ing.Status.LoadBalancer.Ingress),
			AgeSec:           age,
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

func ingressReferencesService(ing *networkingv1.Ingress, serviceName string) bool {
	if ing == nil || serviceName == "" {
		return false
	}
	if ing.Spec.DefaultBackend != nil {
		if name, _ := ingressBackendService(*ing.Spec.DefaultBackend); name == serviceName {
			return true
		}
	}
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, p := range rule.HTTP.Paths {
			if name, _ := ingressBackendService(p.Backend); name == serviceName {
				return true
			}
		}
	}
	return false
}
