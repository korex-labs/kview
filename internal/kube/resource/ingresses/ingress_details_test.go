package ingresses

import (
	"reflect"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	networkingv1 "k8s.io/api/networking/v1"
)

func TestMapIngressRulesAndBackendPorts(t *testing.T) {
	prefix := networkingv1.PathTypePrefix
	exact := networkingv1.PathTypeExact
	rules := mapIngressRules([]networkingv1.IngressRule{
		{
			Host: "app.example.test",
			IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{
				Paths: []networkingv1.HTTPIngressPath{
					{
						Path:     "/",
						PathType: &prefix,
						Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
							Name: "web",
							Port: networkingv1.ServiceBackendPort{Number: 8080},
						}},
					},
					{
						Path:     "/admin",
						PathType: &exact,
						Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
							Name: "admin",
							Port: networkingv1.ServiceBackendPort{Name: "http-admin"},
						}},
					},
				},
			}},
		},
	})

	want := []dto.IngressRuleDTO{
		{
			Host: "app.example.test",
			Paths: []dto.IngressPathDTO{
				{Path: "/", PathType: "Prefix", BackendServiceName: "web", BackendServicePort: "8080"},
				{Path: "/admin", PathType: "Exact", BackendServiceName: "admin", BackendServicePort: "http-admin"},
			},
		},
	}
	if !reflect.DeepEqual(rules, want) {
		t.Fatalf("mapIngressRules() = %#v, want %#v", rules, want)
	}
}

func TestCollectIngressBackendReferencesPreservesRouteEvidence(t *testing.T) {
	refs := collectIngressBackendReferences(networkingv1.IngressSpec{
		DefaultBackend: &networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
			Name: "fallback", Port: networkingv1.ServiceBackendPort{Name: "http"},
		}},
		Rules: []networkingv1.IngressRule{{
			Host: "app.example.test",
			IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{
				{Path: "/", Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "web", Port: networkingv1.ServiceBackendPort{Number: 8080}}}},
				{Path: "/", Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "web", Port: networkingv1.ServiceBackendPort{Number: 8080}}}},
			}}},
		}},
	})
	want := []dto.IngressBackendReferenceDTO{
		{ServiceName: "fallback", ServicePort: "http", Default: true},
		{ServiceName: "web", ServicePort: "8080", Host: "app.example.test", Path: "/"},
	}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("collectIngressBackendReferences() = %#v, want %#v", refs, want)
	}
}

func TestMapIngressTLSAndAddressesCloneValues(t *testing.T) {
	tls := mapIngressTLS([]networkingv1.IngressTLS{
		{SecretName: "app-tls", Hosts: []string{"app.example.test", "www.example.test"}},
	})
	addresses := mapIngressLoadBalancerIngress([]networkingv1.IngressLoadBalancerIngress{
		{IP: "10.0.0.10"},
		{Hostname: "lb.example.test"},
		{},
	})

	if !reflect.DeepEqual(tls, []dto.IngressTLSDTO{{SecretName: "app-tls", Hosts: []string{"app.example.test", "www.example.test"}}}) {
		t.Fatalf("mapIngressTLS() = %#v", tls)
	}
	if !reflect.DeepEqual(addresses, []string{"10.0.0.10", "lb.example.test"}) {
		t.Fatalf("mapIngressLoadBalancerIngress() = %#v", addresses)
	}
}

func TestMapIngressBackendIgnoresNonServiceBackends(t *testing.T) {
	if got := mapIngressBackend(nil); got != nil {
		t.Fatalf("nil backend = %#v, want nil", got)
	}
	if got := mapIngressBackend(&networkingv1.IngressBackend{}); got != nil {
		t.Fatalf("non-service backend = %#v, want nil", got)
	}
	got := mapIngressBackend(&networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
		Name: "web",
		Port: networkingv1.ServiceBackendPort{Number: 80},
	}})
	if got == nil || got.ServiceName != "web" || got.ServicePort != "80" {
		t.Fatalf("service backend = %#v", got)
	}
}

func TestIngressServiceBackendPort(t *testing.T) {
	cases := []struct {
		name string
		port networkingv1.ServiceBackendPort
		want string
	}{
		{"named port wins", networkingv1.ServiceBackendPort{Name: "http", Number: 80}, "http"},
		{"numeric port", networkingv1.ServiceBackendPort{Number: 443}, "443"},
		{"empty port", networkingv1.ServiceBackendPort{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ingressServiceBackendPort(tc.port); got != tc.want {
				t.Fatalf("ingressServiceBackendPort() = %q, want %q", got, tc.want)
			}
		})
	}
}
