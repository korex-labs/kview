package ingresses

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	svcs "github.com/korex-labs/kview/v5/internal/kube/resource/services"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetIngressDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.IngressDetailsDTO, error) {
	ing, err := c.Clientset.NetworkingV1().Ingresses(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	ingCopy := ing.DeepCopy()
	ingCopy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(ingCopy, "networking.k8s.io/v1", "Ingress")
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	if !ing.CreationTimestamp.IsZero() {
		age = int64(now.Sub(ing.CreationTimestamp.Time).Seconds())
	}

	className := ingressClassName(ing.Spec.IngressClassName, ing.Annotations)
	if className == "" {
		className = defaultIngressClassName(ctx, c)
	}

	hosts := collectIngressHosts(ing)
	addresses := mapIngressLoadBalancerIngress(ing.Status.LoadBalancer.Ingress)

	rules := mapIngressRules(ing.Spec.Rules)
	tlsEntries := mapIngressTLS(ing.Spec.TLS)
	defaultBackend := mapIngressBackend(ing.Spec.DefaultBackend)

	warnings := buildIngressWarnings(ctx, c, namespace, rules, defaultBackend)

	summary := dto.IngressSummaryDTO{
		Name:             ing.Name,
		Namespace:        ing.Namespace,
		IngressClassName: className,
		Addresses:        addresses,
		Hosts:            hosts,
		TLSCount:         int32(len(ing.Spec.TLS)),
		AgeSec:           age,
		Labels:           ing.Labels,
		Annotations:      ing.Annotations,
	}

	return &dto.IngressDetailsDTO{
		Summary:        summary,
		Rules:          rules,
		TLS:            tlsEntries,
		DefaultBackend: defaultBackend,
		Warnings:       warnings,
		YAML:           string(y),
	}, nil
}

func mapIngressRules(rules []networkingv1.IngressRule) []dto.IngressRuleDTO {
	if len(rules) == 0 {
		return nil
	}
	out := make([]dto.IngressRuleDTO, 0, len(rules))
	for _, r := range rules {
		paths := make([]dto.IngressPathDTO, 0)
		if r.HTTP != nil {
			for _, p := range r.HTTP.Paths {
				pathType := ""
				if p.PathType != nil {
					pathType = string(*p.PathType)
				}
				svcName, svcPort := ingressBackendService(p.Backend)
				paths = append(paths, dto.IngressPathDTO{
					Path:               p.Path,
					PathType:           pathType,
					BackendServiceName: svcName,
					BackendServicePort: svcPort,
				})
			}
		}
		out = append(out, dto.IngressRuleDTO{
			Host:  r.Host,
			Paths: paths,
		})
	}
	return out
}

func mapIngressTLS(items []networkingv1.IngressTLS) []dto.IngressTLSDTO {
	if len(items) == 0 {
		return nil
	}
	out := make([]dto.IngressTLSDTO, 0, len(items))
	for _, t := range items {
		hosts := append([]string{}, t.Hosts...)
		out = append(out, dto.IngressTLSDTO{
			SecretName: t.SecretName,
			Hosts:      hosts,
		})
	}
	return out
}

func mapIngressBackend(backend *networkingv1.IngressBackend) *dto.IngressBackendDTO {
	if backend == nil {
		return nil
	}
	svcName, svcPort := ingressBackendService(*backend)
	if svcName == "" && svcPort == "" {
		return nil
	}
	return &dto.IngressBackendDTO{
		ServiceName: svcName,
		ServicePort: svcPort,
	}
}

func ingressBackendService(backend networkingv1.IngressBackend) (string, string) {
	if backend.Service == nil {
		return "", ""
	}
	name := backend.Service.Name
	port := ingressServiceBackendPort(backend.Service.Port)
	return name, port
}

func ingressServiceBackendPort(port networkingv1.ServiceBackendPort) string {
	if port.Name != "" {
		return port.Name
	}
	if port.Number != 0 {
		return fmtInt32(port.Number)
	}
	return ""
}

func fmtInt32(v int32) string {
	if v == 0 {
		return ""
	}
	return fmt.Sprintf("%d", v)
}

func mapIngressLoadBalancerIngress(items []networkingv1.IngressLoadBalancerIngress) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, i := range items {
		if i.IP != "" {
			out = append(out, i.IP)
		} else if i.Hostname != "" {
			out = append(out, i.Hostname)
		}
	}
	return out
}

func buildIngressWarnings(ctx context.Context, c *cluster.Clients, namespace string, rules []dto.IngressRuleDTO, defaultBackend *dto.IngressBackendDTO) dto.IngressWarningsDTO {
	backendSet := map[string]struct{}{}
	for _, r := range rules {
		for _, p := range r.Paths {
			if p.BackendServiceName != "" {
				backendSet[p.BackendServiceName] = struct{}{}
			}
		}
	}
	if defaultBackend != nil && defaultBackend.ServiceName != "" {
		backendSet[defaultBackend.ServiceName] = struct{}{}
	}

	if len(backendSet) == 0 {
		return dto.IngressWarningsDTO{}
	}

	services, err := c.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return dto.IngressWarningsDTO{}
	}
	serviceMap := map[string]struct{}{}
	for _, s := range services.Items {
		serviceMap[s.Name] = struct{}{}
	}

	//nolint:staticcheck // Deferred migration to EndpointSlice; keep legacy Endpoints rollup behavior for now.
	endpointsByName := map[string]*corev1.Endpoints{}
	if endpoints, err := c.Clientset.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{}); err == nil {
		//nolint:staticcheck // Deferred migration to EndpointSlice; keep legacy Endpoints rollup behavior for now.
		endpointsByName = make(map[string]*corev1.Endpoints, len(endpoints.Items))
		for i := range endpoints.Items {
			ep := endpoints.Items[i]
			endpointsByName[ep.Name] = &ep
		}
	}

	missing := []string{}
	noReady := []string{}
	for svcName := range backendSet {
		if _, ok := serviceMap[svcName]; !ok {
			missing = append(missing, svcName)
			continue
		}
		ready, _ := svcs.EndpointsCounts(endpointsByName[svcName])
		if ready == 0 {
			noReady = append(noReady, svcName)
		}
	}

	sort.Strings(missing)
	sort.Strings(noReady)

	return dto.IngressWarningsDTO{
		MissingBackendServices: missing,
		NoReadyEndpoints:       noReady,
	}
}
