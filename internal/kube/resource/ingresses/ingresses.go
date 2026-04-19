package ingresses

import (
	"context"
	"sort"
	"strings"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func ListIngresses(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.IngressListItemDTO, error) {
	ings, err := c.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	defaultClass := defaultIngressClassName(ctx, c)

	now := time.Now()
	out := make([]dto.IngressListItemDTO, 0, len(ings.Items))
	for _, ing := range ings.Items {
		age := int64(0)
		if !ing.CreationTimestamp.IsZero() {
			age = int64(now.Sub(ing.CreationTimestamp.Time).Seconds())
		}

		className := ingressClassName(ing.Spec.IngressClassName, ing.Annotations)
		if className == "" {
			className = defaultClass
		}

		hosts := collectIngressHosts(&ing)
		addresses := mapIngressLoadBalancerIngress(ing.Status.LoadBalancer.Ingress)

		out = append(out, dto.IngressListItemDTO{
			Name:             ing.Name,
			Namespace:        ing.Namespace,
			IngressClassName: className,
			Hosts:            hosts,
			TLSCount:         int32(len(ing.Spec.TLS)),
			Addresses:        addresses,
			AgeSec:           age,
		})
	}

	return out, nil
}

func collectIngressHosts(ing *networkingv1.Ingress) []string {
	if ing == nil {
		return nil
	}
	seen := map[string]struct{}{}
	for _, r := range ing.Spec.Rules {
		if r.Host != "" {
			seen[r.Host] = struct{}{}
		}
	}
	for _, t := range ing.Spec.TLS {
		for _, h := range t.Hosts {
			if h != "" {
				seen[h] = struct{}{}
			}
		}
	}

	if len(seen) == 0 {
		return nil
	}

	out := make([]string, 0, len(seen))
	for h := range seen {
		out = append(out, h)
	}
	sort.Strings(out)
	return out
}

func ingressClassName(specName *string, annotations map[string]string) string {
	if specName != nil && *specName != "" {
		return *specName
	}
	if annotations == nil {
		return ""
	}
	if val := annotations["kubernetes.io/ingress.class"]; val != "" {
		return val
	}
	if val := annotations["ingress.kubernetes.io/class"]; val != "" {
		return val
	}
	if val := annotations["nginx.ingress.kubernetes.io/ingress.class"]; val != "" {
		return val
	}
	for k, v := range annotations {
		key := strings.ToLower(k)
		if strings.Contains(key, "ingress.class") || strings.Contains(key, "ingressclass") {
			if strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	return ""
}

func defaultIngressClassName(ctx context.Context, c *cluster.Clients) string {
	items, err := c.Clientset.NetworkingV1().IngressClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return "default"
	}
	if len(items.Items) == 0 {
		return "default"
	}

	defaults := make([]string, 0)
	all := make([]string, 0, len(items.Items))
	for _, ic := range items.Items {
		if ic.Name != "" {
			all = append(all, ic.Name)
		}
		if ic.Annotations == nil {
			continue
		}
		if strings.EqualFold(ic.Annotations["ingressclass.kubernetes.io/is-default-class"], "true") {
			if ic.Name != "" {
				defaults = append(defaults, ic.Name)
			}
		}
	}

	if len(defaults) > 0 {
		sort.Strings(defaults)
		return defaults[0]
	}
	if len(all) > 0 {
		sort.Strings(all)
		return all[0]
	}
	return "default"
}
