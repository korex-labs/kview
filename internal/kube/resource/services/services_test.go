package services

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestServiceType(t *testing.T) {
	cases := []struct {
		name string
		t    corev1.ServiceType
		want string
	}{
		{"empty defaults to ClusterIP", "", "ClusterIP"},
		{"explicit ClusterIP", corev1.ServiceTypeClusterIP, "ClusterIP"},
		{"NodePort", corev1.ServiceTypeNodePort, "NodePort"},
		{"LoadBalancer", corev1.ServiceTypeLoadBalancer, "LoadBalancer"},
		{"ExternalName", corev1.ServiceTypeExternalName, "ExternalName"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ServiceType(tc.t); got != tc.want {
				t.Fatalf("ServiceType(%q) = %q, want %q", tc.t, got, tc.want)
			}
		})
	}
}

func TestFormatServicePortsSummary(t *testing.T) {
	intPort := func(n int32) intstr.IntOrString { return intstr.FromInt32(n) }
	strPort := func(s string) intstr.IntOrString { return intstr.FromString(s) }

	cases := []struct {
		name  string
		ports []corev1.ServicePort
		want  string
	}{
		{
			name:  "empty ports",
			ports: nil,
			want:  "",
		},
		{
			name: "single port same target omitted",
			ports: []corev1.ServicePort{
				{Port: 80, Protocol: corev1.ProtocolTCP, TargetPort: intPort(80)},
			},
			want: "80/TCP",
		},
		{
			name: "port with different int target",
			ports: []corev1.ServicePort{
				{Port: 80, Protocol: corev1.ProtocolTCP, TargetPort: intPort(8080)},
			},
			want: "80→8080/TCP",
		},
		{
			name: "port with named string target",
			ports: []corev1.ServicePort{
				{Port: 443, Protocol: corev1.ProtocolTCP, TargetPort: strPort("https")},
			},
			want: "443→https/TCP",
		},
		{
			name: "port with NodePort",
			ports: []corev1.ServicePort{
				{Port: 80, Protocol: corev1.ProtocolTCP, TargetPort: intPort(80), NodePort: 30080},
			},
			want: "80/TCP (NP 30080)",
		},
		{
			name: "missing protocol defaults to TCP",
			ports: []corev1.ServicePort{
				{Port: 9090, TargetPort: intPort(9090)},
			},
			want: "9090/TCP",
		},
		{
			name: "UDP protocol preserved",
			ports: []corev1.ServicePort{
				{Port: 53, Protocol: corev1.ProtocolUDP, TargetPort: intPort(53)},
			},
			want: "53/UDP",
		},
		{
			name: "multiple ports joined with comma",
			ports: []corev1.ServicePort{
				{Port: 80, Protocol: corev1.ProtocolTCP, TargetPort: intPort(8080)},
				{Port: 443, Protocol: corev1.ProtocolTCP, TargetPort: intPort(8443)},
			},
			want: "80→8080/TCP, 443→8443/TCP",
		},
		{
			name: "zero int target treated as empty",
			ports: []corev1.ServicePort{
				{Port: 8080, Protocol: corev1.ProtocolTCP, TargetPort: intPort(0)},
			},
			want: "8080/TCP",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := FormatServicePortsSummary(tc.ports); got != tc.want {
				t.Fatalf("FormatServicePortsSummary() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEndpointSlicesCounts(t *testing.T) {
	ready := true
	notReady := false
	podRef := func(name, uid string) *corev1.ObjectReference {
		return &corev1.ObjectReference{Kind: "Pod", Namespace: "default", Name: name, UID: types.UID(uid)}
	}
	slices := []discoveryv1.EndpointSlice{
		{
			ObjectMeta:  metav1.ObjectMeta{Name: "api-v4", Namespace: "default"},
			AddressType: discoveryv1.AddressTypeIPv4,
			Endpoints: []discoveryv1.Endpoint{
				{Addresses: []string{"10.0.0.1"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}, TargetRef: podRef("api-1", "pod-1")},
				{Addresses: []string{"10.0.0.2"}, Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: podRef("api-2", "pod-2")},
				{Addresses: []string{"10.0.0.3"}, TargetRef: podRef("api-3", "pod-3")},
			},
		},
		{
			ObjectMeta:  metav1.ObjectMeta{Name: "api-v6", Namespace: "default"},
			AddressType: discoveryv1.AddressTypeIPv6,
			Endpoints: []discoveryv1.Endpoint{
				// Same target as api-1: dual-stack must not double count the backend.
				{Addresses: []string{"2001:db8::1"}, Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: podRef("api-1", "pod-1")},
			},
		},
	}

	gotReady, gotNotReady := EndpointSlicesCounts(slices)
	if gotReady != 2 || gotNotReady != 1 {
		t.Fatalf("EndpointSlicesCounts() = (%d, %d), want (2, 1)", gotReady, gotNotReady)
	}
}

func TestEndpointSlicePodRefsDeduplicatesAndDefaultsNamespace(t *testing.T) {
	ref := &corev1.ObjectReference{Kind: "Pod", Name: "api-1", UID: "pod-1"}
	slices := []discoveryv1.EndpointSlice{
		{ObjectMeta: metav1.ObjectMeta{Namespace: "default"}, Endpoints: []discoveryv1.Endpoint{{TargetRef: ref}}},
		{ObjectMeta: metav1.ObjectMeta{Namespace: "default"}, Endpoints: []discoveryv1.Endpoint{{TargetRef: ref}}},
	}

	got := EndpointSlicePodRefs(slices, "default")
	if len(got) != 1 || got[0].Namespace != "default" || got[0].Name != "api-1" {
		t.Fatalf("EndpointSlicePodRefs() = %#v, want one default/api-1 ref", got)
	}
}

func TestEndpointSliceTargetPodNamePrefersReady(t *testing.T) {
	ready := true
	notReady := false
	slices := []discoveryv1.EndpointSlice{{Endpoints: []discoveryv1.Endpoint{
		{Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "fallback"}},
		{Conditions: discoveryv1.EndpointConditions{Ready: &ready}, TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "preferred"}},
	}}}

	if got := EndpointSliceTargetPodName(slices); got != "preferred" {
		t.Fatalf("EndpointSliceTargetPodName() = %q, want preferred", got)
	}
}

func TestIsPodReady(t *testing.T) {
	cases := []struct {
		name string
		pod  *corev1.Pod
		want bool
	}{
		{
			name: "no conditions",
			pod:  &corev1.Pod{},
			want: false,
		},
		{
			name: "ready condition true",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionTrue},
					},
				},
			},
			want: true,
		},
		{
			name: "ready condition false",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodReady, Status: corev1.ConditionFalse},
					},
				},
			},
			want: false,
		},
		{
			name: "non-ready condition true but no PodReady",
			pod: &corev1.Pod{
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodScheduled, Status: corev1.ConditionTrue},
					},
				},
			},
			want: false,
		},
		{
			name: "ready condition present among several",
			pod: &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "my-pod"},
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{Type: corev1.PodScheduled, Status: corev1.ConditionTrue},
						{Type: corev1.ContainersReady, Status: corev1.ConditionTrue},
						{Type: corev1.PodReady, Status: corev1.ConditionTrue},
					},
				},
			},
			want: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsPodReady(tc.pod); got != tc.want {
				t.Fatalf("IsPodReady() = %v, want %v", got, tc.want)
			}
		})
	}
}
