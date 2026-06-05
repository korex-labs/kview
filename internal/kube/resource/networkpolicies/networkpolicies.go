package networkpolicies

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func ListNetworkPolicies(ctx context.Context, c *cluster.Clients, namespace string) ([]dto.NetworkPolicyDTO, error) {
	items, err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	pods := podsInNamespace(ctx, c, namespace)
	now := time.Now()
	out := make([]dto.NetworkPolicyDTO, 0, len(items.Items))
	for _, item := range items.Items {
		out = append(out, dto.NetworkPolicyDTO{
			Name:         item.Name,
			Namespace:    item.Namespace,
			PodSelector:  selectorString(item.Spec.PodSelector),
			PolicyTypes:  policyTypes(item.Spec.PolicyTypes),
			IngressRules: len(item.Spec.Ingress),
			EgressRules:  len(item.Spec.Egress),
			SelectedPods: selectedPodCount(item.Spec.PodSelector, pods),
			AgeSec:       ageSeconds(now, item.CreationTimestamp),
		})
	}
	return out, nil
}

func GetNetworkPolicyDetails(ctx context.Context, c *cluster.Clients, namespace, name string) (*dto.NetworkPolicyDetailsDTO, error) {
	item, err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	copy := item.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "networking.k8s.io/v1", "NetworkPolicy")
	if err != nil {
		return nil, err
	}

	pods := podsInNamespace(ctx, c, namespace)
	now := time.Now()
	return &dto.NetworkPolicyDetailsDTO{
		Summary: dto.NetworkPolicySummaryDTO{
			Name:         item.Name,
			Namespace:    item.Namespace,
			PodSelector:  selectorString(item.Spec.PodSelector),
			PolicyTypes:  policyTypes(item.Spec.PolicyTypes),
			IngressRules: len(item.Spec.Ingress),
			EgressRules:  len(item.Spec.Egress),
			SelectedPods: selectedPodCount(item.Spec.PodSelector, pods),
			AgeSec:       ageSeconds(now, item.CreationTimestamp),
			Labels:       item.Labels,
			Annotations:  item.Annotations,
		},
		Ingress:  mapIngressRules(item.Spec.Ingress),
		Egress:   mapEgressRules(item.Spec.Egress),
		Metadata: dto.NetworkPolicyMetadataDTO{Labels: item.Labels, Annotations: item.Annotations},
		YAML:     string(y),
	}, nil
}

func GetNetworkPolicyYAML(ctx context.Context, c *cluster.Clients, namespace, name string) (string, error) {
	item, err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	copy := item.DeepCopy()
	copy.ManagedFields = nil
	y, err := kube.MarshalObjectYAML(copy, "networking.k8s.io/v1", "NetworkPolicy")
	if err != nil {
		return "", err
	}
	return string(y), nil
}

func ageSeconds(now time.Time, ts metav1.Time) int64 {
	if ts.IsZero() {
		return 0
	}
	return int64(now.Sub(ts.Time).Seconds())
}

func selectorString(selector metav1.LabelSelector) string {
	parsed, err := metav1.LabelSelectorAsSelector(&selector)
	if err != nil {
		return ""
	}
	if parsed.Empty() {
		return "all pods"
	}
	return parsed.String()
}

func policyTypes(items []networkingv1.PolicyType) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, string(item))
	}
	sort.Strings(out)
	return out
}

func podsInNamespace(ctx context.Context, c *cluster.Clients, namespace string) []corev1.Pod {
	pods, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil
	}
	return pods.Items
}

func selectedPodCount(selector metav1.LabelSelector, pods []corev1.Pod) int {
	parsed, err := metav1.LabelSelectorAsSelector(&selector)
	if err != nil || len(pods) == 0 {
		return 0
	}
	count := 0
	for _, pod := range pods {
		if parsed.Matches(labels.Set(pod.Labels)) {
			count++
		}
	}
	return count
}

func mapIngressRules(items []networkingv1.NetworkPolicyIngressRule) []dto.NetworkPolicyRuleDTO {
	out := make([]dto.NetworkPolicyRuleDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dto.NetworkPolicyRuleDTO{
			Peers: mapPeers(item.From),
			Ports: mapPorts(item.Ports),
		})
	}
	return out
}

func mapEgressRules(items []networkingv1.NetworkPolicyEgressRule) []dto.NetworkPolicyRuleDTO {
	out := make([]dto.NetworkPolicyRuleDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dto.NetworkPolicyRuleDTO{
			Peers: mapPeers(item.To),
			Ports: mapPorts(item.Ports),
		})
	}
	return out
}

func mapPeers(items []networkingv1.NetworkPolicyPeer) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		parts := []string{}
		if item.PodSelector != nil {
			parts = append(parts, "pod:"+selectorString(*item.PodSelector))
		}
		if item.NamespaceSelector != nil {
			parts = append(parts, "namespace:"+selectorString(*item.NamespaceSelector))
		}
		if item.IPBlock != nil {
			parts = append(parts, "ip:"+item.IPBlock.CIDR)
			if len(item.IPBlock.Except) > 0 {
				parts = append(parts, "except:"+strings.Join(item.IPBlock.Except, ","))
			}
		}
		if len(parts) == 0 {
			parts = append(parts, "all")
		}
		out = append(out, strings.Join(parts, " "))
	}
	sort.Strings(out)
	return out
}

func mapPorts(items []networkingv1.NetworkPolicyPort) []string {
	if len(items) == 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		protocol := "TCP"
		if item.Protocol != nil {
			protocol = string(*item.Protocol)
		}
		port := "any"
		if item.Port != nil {
			port = item.Port.String()
		}
		if item.EndPort != nil {
			port = fmt.Sprintf("%s-%d", port, *item.EndPort)
		}
		out = append(out, protocol+"/"+port)
	}
	sort.Strings(out)
	return out
}
