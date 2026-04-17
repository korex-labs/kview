package services

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"

	"github.com/alex-mamchenkov/kview/internal/cluster"
	"github.com/alex-mamchenkov/kview/internal/kube/dto"
)

func GetServiceDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.ServiceDetailsDTO, error) {
	svc, err := c.Clientset.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// YAML
	svcCopy := svc.DeepCopy()
	svcCopy.ManagedFields = nil
	b, err := json.Marshal(svcCopy)
	if err != nil {
		return nil, err
	}
	y, err := yaml.JSONToYAML(b)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	age := int64(0)
	if !svc.CreationTimestamp.IsZero() {
		age = int64(now.Sub(svc.CreationTimestamp.Time).Seconds())
	}

	selector := map[string]string{}
	for k, v := range svc.Spec.Selector {
		selector[k] = v
	}
	if len(selector) == 0 {
		selector = nil
	}

	ports := make([]dto.ServicePortDTO, 0, len(svc.Spec.Ports))
	for _, p := range svc.Spec.Ports {
		ports = append(ports, dto.ServicePortDTO{
			Name:       p.Name,
			Port:       p.Port,
			TargetPort: serviceIntOrString(p.TargetPort),
			Protocol:   string(p.Protocol),
			NodePort:   p.NodePort,
		})
	}

	traffic := dto.ServiceTrafficDTO{
		ExternalTrafficPolicy: string(svc.Spec.ExternalTrafficPolicy),
		LoadBalancerIngress:   mapLoadBalancerIngress(svc.Status.LoadBalancer.Ingress),
	}

	ready, notReady, endpointPods, err := listServiceEndpointPods(ctx, c, svc)
	if err != nil {
		return nil, err
	}

	summary := dto.ServiceSummaryDTO{
		Name:            svc.Name,
		Namespace:       svc.Namespace,
		Type:            ServiceType(svc.Spec.Type),
		ClusterIPs:      serviceClusterIPs(svc.Spec),
		ExternalName:    svc.Spec.ExternalName,
		Selector:        selector,
		SessionAffinity: string(svc.Spec.SessionAffinity),
		AgeSec:          age,
		Labels:          svc.Labels,
		Annotations:     svc.Annotations,
	}

	return &dto.ServiceDetailsDTO{
		Summary: summary,
		Ports:   ports,
		Traffic: traffic,
		Endpoints: dto.ServiceEndpointsDTO{
			Ready:    int32(ready),
			NotReady: int32(notReady),
			Pods:     endpointPods,
		},
		YAML: string(y),
	}, nil
}

func mapLoadBalancerIngress(items []corev1.LoadBalancerIngress) []string {
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

func listServiceEndpointPods(ctx context.Context, c *cluster.Clients, svc *corev1.Service) (int, int, []dto.ServiceEndpointPodDTO, error) {
	ep, err := c.Clientset.CoreV1().Endpoints(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return 0, 0, nil, nil
		}
		return 0, 0, nil, err
	}

	readyCount, notReadyCount := EndpointsCounts(ep)
	podRefs := map[string]corev1.ObjectReference{}

	for _, subset := range ep.Subsets {
		for _, addr := range subset.Addresses {
			addPodRef(podRefs, addr.TargetRef, svc.Namespace)
		}
		for _, addr := range subset.NotReadyAddresses {
			addPodRef(podRefs, addr.TargetRef, svc.Namespace)
		}
	}

	pods := make([]dto.ServiceEndpointPodDTO, 0, len(podRefs))
	for _, ref := range podRefs {
		if ref.Kind != "Pod" || ref.Name == "" {
			continue
		}
		ns := ref.Namespace
		if ns == "" {
			ns = svc.Namespace
		}
		pod, err := c.Clientset.CoreV1().Pods(ns).Get(ctx, ref.Name, metav1.GetOptions{})
		if err != nil {
			continue
		}
		pods = append(pods, dto.ServiceEndpointPodDTO{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Node:      pod.Spec.NodeName,
			Ready:     IsPodReady(pod),
		})
	}

	sort.Slice(pods, func(i, j int) bool {
		if pods[i].Namespace == pods[j].Namespace {
			return pods[i].Name < pods[j].Name
		}
		return pods[i].Namespace < pods[j].Namespace
	})

	return readyCount, notReadyCount, pods, nil
}

func addPodRef(target map[string]corev1.ObjectReference, ref *corev1.ObjectReference, defaultNS string) {
	if ref == nil {
		return
	}
	ns := ref.Namespace
	if ns == "" {
		ns = defaultNS
	}
	key := ns + "/" + ref.Name
	target[key] = *ref
}

func IsPodReady(pod *corev1.Pod) bool {
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady {
			return cond.Status == corev1.ConditionTrue
		}
	}
	return false
}
