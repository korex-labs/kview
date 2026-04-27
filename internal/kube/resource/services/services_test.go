package services

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

//nolint:staticcheck // Deferred migration to EndpointSlice; test matches current behavior.
func TestEndpointsCounts(t *testing.T) {
	addr := func(ip string) corev1.EndpointAddress { return corev1.EndpointAddress{IP: ip} }

	cases := []struct {
		name         string
		ep           *corev1.Endpoints
		wantReady    int
		wantNotReady int
	}{
		{
			name:         "nil endpoint",
			ep:           nil,
			wantReady:    0,
			wantNotReady: 0,
		},
		{
			name:         "empty subsets",
			ep:           &corev1.Endpoints{},
			wantReady:    0,
			wantNotReady: 0,
		},
		{
			name: "ready addresses only",
			ep: &corev1.Endpoints{
				Subsets: []corev1.EndpointSubset{
					{Addresses: []corev1.EndpointAddress{addr("10.0.0.1"), addr("10.0.0.2")}},
				},
			},
			wantReady:    2,
			wantNotReady: 0,
		},
		{
			name: "not-ready addresses only",
			ep: &corev1.Endpoints{
				Subsets: []corev1.EndpointSubset{
					{NotReadyAddresses: []corev1.EndpointAddress{addr("10.0.0.3")}},
				},
			},
			wantReady:    0,
			wantNotReady: 1,
		},
		{
			name: "mixed ready and not-ready",
			ep: &corev1.Endpoints{
				Subsets: []corev1.EndpointSubset{
					{
						Addresses:         []corev1.EndpointAddress{addr("10.0.0.1")},
						NotReadyAddresses: []corev1.EndpointAddress{addr("10.0.0.2"), addr("10.0.0.3")},
					},
				},
			},
			wantReady:    1,
			wantNotReady: 2,
		},
		{
			name: "multiple subsets summed",
			ep: &corev1.Endpoints{
				Subsets: []corev1.EndpointSubset{
					{Addresses: []corev1.EndpointAddress{addr("10.0.0.1")}},
					{
						Addresses:         []corev1.EndpointAddress{addr("10.0.0.2")},
						NotReadyAddresses: []corev1.EndpointAddress{addr("10.0.0.3")},
					},
				},
			},
			wantReady:    2,
			wantNotReady: 1,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ready, notReady := EndpointsCounts(tc.ep)
			if ready != tc.wantReady || notReady != tc.wantNotReady {
				t.Fatalf("EndpointsCounts() = (%d, %d), want (%d, %d)",
					ready, notReady, tc.wantReady, tc.wantNotReady)
			}
		})
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
