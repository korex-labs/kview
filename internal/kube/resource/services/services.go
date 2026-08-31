package services

import (
	"context"
	"fmt"
	"maps"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/kube/resource/relationships"
)

func ListServices(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ServiceListItemDTO, error) {
	services, err := c.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	endpointSlicesByName := map[string][]discoveryv1.EndpointSlice{}
	endpointCoverage := "unknown"
	if slices, err := ListEndpointSlicesByService(ctx, c, namespace); err == nil {
		endpointSlicesByName = slices
		endpointCoverage = "complete"
	}
	return serviceListItems(services.Items, endpointSlicesByName, endpointCoverage, time.Now()), nil
}

func serviceListItems(services []corev1.Service, endpointSlicesByName map[string][]discoveryv1.EndpointSlice, endpointCoverage string, now time.Time) []dto.ServiceListItemDTO {
	out := make([]dto.ServiceListItemDTO, 0, len(services))
	for _, svc := range services {
		age := int64(0)
		if !svc.CreationTimestamp.IsZero() {
			age = int64(now.Sub(svc.CreationTimestamp.Time).Seconds())
		}

		ready, notReady := EndpointSlicesCounts(endpointSlicesByName[svc.Name])
		carrier := relationships.Capture(&svc, relationships.ServiceDescriptor)
		carrier = relationships.WithSelectors(carrier, relationships.ServiceSelector(svc.Spec.Selector))

		out = append(out, dto.ServiceListItemDTO{
			ResourceRelationshipCarrier: carrier,
			Name:                        svc.Name,
			Namespace:                   svc.Namespace,
			Labels:                      svc.Labels,
			Annotations:                 svc.Annotations,
			Type:                        ServiceType(svc.Spec.Type),
			ClusterIPs:                  serviceClusterIPs(svc.Spec),
			Selector:                    maps.Clone(svc.Spec.Selector),
			Ports:                       mapServicePorts(svc.Spec.Ports),
			PortsObserved:               true,
			PortsSummary:                FormatServicePortsSummary(svc.Spec.Ports),
			EndpointCoverage:            endpointCoverage,
			EndpointsReady:              int32(ready),
			EndpointsNotReady:           int32(notReady),
			AgeSec:                      age,
		})
	}

	return out
}

func mapServicePorts(ports []corev1.ServicePort) []dto.ServicePortDTO {
	out := make([]dto.ServicePortDTO, 0, len(ports))
	for _, p := range ports {
		out = append(out, dto.ServicePortDTO{
			Name:       p.Name,
			Port:       p.Port,
			TargetPort: serviceIntOrString(p.TargetPort),
			Protocol:   string(p.Protocol),
			NodePort:   p.NodePort,
		})
	}
	return out
}

func FormatServicePortsSummary(ports []corev1.ServicePort) string {
	if len(ports) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ports))
	for _, p := range ports {
		base := fmt.Sprintf("%d", p.Port)
		target := serviceIntOrString(p.TargetPort)
		if target != "" && target != base {
			base = fmt.Sprintf("%s→%s", base, target)
		}
		proto := string(p.Protocol)
		if proto == "" {
			proto = "TCP"
		}
		entry := fmt.Sprintf("%s/%s", base, proto)
		if p.NodePort != 0 {
			entry = fmt.Sprintf("%s (NP %d)", entry, p.NodePort)
		}
		parts = append(parts, entry)
	}
	return strings.Join(parts, ", ")
}

func serviceClusterIPs(spec corev1.ServiceSpec) []string {
	if len(spec.ClusterIPs) > 0 {
		return append([]string{}, spec.ClusterIPs...)
	}
	if spec.ClusterIP != "" {
		return []string{spec.ClusterIP}
	}
	return nil
}

func ServiceType(t corev1.ServiceType) string {
	if t == "" {
		return "ClusterIP"
	}
	return string(t)
}

func serviceIntOrString(v intstr.IntOrString) string {
	if v.Type == intstr.String {
		return v.StrVal
	}
	if v.IntVal == 0 {
		return ""
	}
	return fmt.Sprintf("%d", v.IntVal)
}

// ResolveServiceTargetPod returns a Pod name backing the Service.
// It prefers ready endpoint addresses and falls back to not-ready ones.
func ResolveServiceTargetPod(ctx context.Context, c *cluster.Clients, namespace, serviceName string) (string, error) {
	slices, err := ListServiceEndpointSlices(ctx, c, namespace, serviceName)
	if err != nil {
		return "", err
	}
	if podName := EndpointSliceTargetPodName(slices); podName != "" {
		return podName, nil
	}
	return "", fmt.Errorf("service has no endpoint pods")
}
