package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube/dto"
)

func ListServices(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.ServiceListItemDTO, error) {
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

	now := time.Now()
	out := make([]dto.ServiceListItemDTO, 0, len(services.Items))
	for _, svc := range services.Items {
		age := int64(0)
		if !svc.CreationTimestamp.IsZero() {
			age = int64(now.Sub(svc.CreationTimestamp.Time).Seconds())
		}

		ready, notReady := EndpointsCounts(endpointsByName[svc.Name])

		out = append(out, dto.ServiceListItemDTO{
			Name:              svc.Name,
			Namespace:         svc.Namespace,
			Type:              ServiceType(svc.Spec.Type),
			ClusterIPs:        serviceClusterIPs(svc.Spec),
			PortsSummary:      FormatServicePortsSummary(svc.Spec.Ports),
			EndpointsReady:    int32(ready),
			EndpointsNotReady: int32(notReady),
			AgeSec:            age,
		})
	}

	return out, nil
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

func EndpointsCounts(ep *corev1.Endpoints) (int, int) {
	if ep == nil {
		return 0, 0
	}
	ready := 0
	notReady := 0
	for _, subset := range ep.Subsets {
		ready += len(subset.Addresses)
		notReady += len(subset.NotReadyAddresses)
	}
	return ready, notReady
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
	ep, err := c.Clientset.CoreV1().Endpoints(namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	for _, subset := range ep.Subsets {
		for _, addr := range subset.Addresses {
			if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" && addr.TargetRef.Name != "" {
				return addr.TargetRef.Name, nil
			}
		}
	}
	for _, subset := range ep.Subsets {
		for _, addr := range subset.NotReadyAddresses {
			if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" && addr.TargetRef.Name != "" {
				return addr.TargetRef.Name, nil
			}
		}
	}
	return "", fmt.Errorf("service has no endpoint pods")
}
