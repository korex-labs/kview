package services

import (
	"context"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

// ListEndpointSlicesByService returns all EndpointSlices in a namespace grouped
// by the Service name recorded in discovery.k8s.io's standard label.
func ListEndpointSlicesByService(ctx context.Context, c *cluster.Clients, namespace string) (map[string][]discoveryv1.EndpointSlice, error) {
	list, err := c.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make(map[string][]discoveryv1.EndpointSlice)
	for i := range list.Items {
		slice := list.Items[i]
		serviceName := slice.Labels[discoveryv1.LabelServiceName]
		if serviceName == "" {
			continue
		}
		out[serviceName] = append(out[serviceName], slice)
	}
	return out, nil
}

// ListServiceEndpointSlices reads only EndpointSlices owned by one Service.
func ListServiceEndpointSlices(ctx context.Context, c *cluster.Clients, namespace, serviceName string) ([]discoveryv1.EndpointSlice, error) {
	selector := labels.Set{discoveryv1.LabelServiceName: serviceName}.AsSelector().String()
	list, err := c.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

// EndpointSlicesCounts returns unique ready and not-ready backends. A nil Ready
// condition means ready according to the EndpointSlice API. Target references
// deduplicate the same backend when dual-stack address families use two slices.
func EndpointSlicesCounts(slices []discoveryv1.EndpointSlice) (ready, notReady int) {
	readinessByEndpoint := make(map[string]bool)
	for i := range slices {
		slice := &slices[i]
		for j := range slice.Endpoints {
			endpoint := &slice.Endpoints[j]
			key := endpointSliceEndpointKey(slice, endpoint)
			isReady := endpoint.Conditions.Ready == nil || *endpoint.Conditions.Ready
			readinessByEndpoint[key] = readinessByEndpoint[key] || isReady
		}
	}
	for _, isReady := range readinessByEndpoint {
		if isReady {
			ready++
		} else {
			notReady++
		}
	}
	return ready, notReady
}

// EndpointSlicePodRefs returns unique Pod target references across all slices.
func EndpointSlicePodRefs(slices []discoveryv1.EndpointSlice, defaultNamespace string) []corev1.ObjectReference {
	refs := make(map[string]corev1.ObjectReference)
	for i := range slices {
		for j := range slices[i].Endpoints {
			ref := slices[i].Endpoints[j].TargetRef
			if ref == nil || ref.Kind != "Pod" || ref.Name == "" {
				continue
			}
			copyRef := *ref
			if copyRef.Namespace == "" {
				copyRef.Namespace = defaultNamespace
			}
			refs[copyRef.Namespace+"/"+copyRef.Name] = copyRef
		}
	}
	out := make([]corev1.ObjectReference, 0, len(refs))
	for _, ref := range refs {
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// EndpointSliceTargetPodName prefers a ready Pod target and falls back to a
// not-ready Pod, matching the legacy Endpoints behavior used by sessions.
func EndpointSliceTargetPodName(slices []discoveryv1.EndpointSlice) string {
	for _, wantReady := range []bool{true, false} {
		for i := range slices {
			for j := range slices[i].Endpoints {
				endpoint := &slices[i].Endpoints[j]
				ready := endpoint.Conditions.Ready == nil || *endpoint.Conditions.Ready
				if ready != wantReady || endpoint.TargetRef == nil {
					continue
				}
				ref := endpoint.TargetRef
				if ref.Kind == "Pod" && ref.Name != "" {
					return ref.Name
				}
			}
		}
	}
	return ""
}

func endpointSliceEndpointKey(slice *discoveryv1.EndpointSlice, endpoint *discoveryv1.Endpoint) string {
	if endpoint.TargetRef != nil {
		ref := endpoint.TargetRef
		if ref.UID != "" {
			return "uid:" + string(ref.UID)
		}
		if ref.Kind != "" && ref.Name != "" {
			namespace := ref.Namespace
			if namespace == "" {
				namespace = slice.Namespace
			}
			return "ref:" + ref.Kind + ":" + namespace + ":" + ref.Name
		}
	}
	addresses := append([]string(nil), endpoint.Addresses...)
	sort.Strings(addresses)
	return "addr:" + string(slice.AddressType) + ":" + strings.Join(addresses, ",")
}
