package dto

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestConnectivityEvidenceJSONRoundTripAndLegacyDefaults(t *testing.T) {
	service := ServiceListItemDTO{
		Name:             "api",
		Namespace:        "apps",
		Selector:         map[string]string{"app": "api"},
		Ports:            []ServicePortDTO{{Name: "http", Port: 8080}},
		PortsObserved:    true,
		EndpointCoverage: "complete",
	}
	ingress := IngressListItemDTO{
		Name:             "public",
		Namespace:        "apps",
		BackendsObserved: true,
		Backends: []IngressBackendReferenceDTO{{
			ServiceName: "api",
			ServicePort: "8080",
			Host:        "app.example.test",
			Path:        "/",
		}},
	}

	for name, test := range map[string]struct {
		value any
		out   any
		check func(t *testing.T, got any)
	}{
		"service": {
			value: service,
			out:   &ServiceListItemDTO{},
			check: func(t *testing.T, got any) {
				item := got.(*ServiceListItemDTO)
				if !item.PortsObserved || item.EndpointCoverage != "complete" || !reflect.DeepEqual(item.Selector, service.Selector) || !reflect.DeepEqual(item.Ports, service.Ports) {
					t.Fatalf("Service evidence did not round-trip: %+v", item)
				}
			},
		},
		"ingress": {
			value: ingress,
			out:   &IngressListItemDTO{},
			check: func(t *testing.T, got any) {
				item := got.(*IngressListItemDTO)
				if !item.BackendsObserved || !reflect.DeepEqual(item.Backends, ingress.Backends) {
					t.Fatalf("Ingress evidence did not round-trip: %+v", item)
				}
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			payload, err := json.Marshal(test.value)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if err := json.Unmarshal(payload, test.out); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			test.check(t, test.out)
		})
	}

	var legacyService ServiceListItemDTO
	if err := json.Unmarshal([]byte(`{"name":"legacy","endpointsReady":0,"endpointsNotReady":0}`), &legacyService); err != nil {
		t.Fatalf("unmarshal legacy Service: %v", err)
	}
	if legacyService.PortsObserved || legacyService.EndpointCoverage != "" {
		t.Fatalf("legacy Service gained authoritative evidence: %+v", legacyService)
	}

	var legacyIngress IngressListItemDTO
	if err := json.Unmarshal([]byte(`{"name":"legacy","hosts":[]}`), &legacyIngress); err != nil {
		t.Fatalf("unmarshal legacy Ingress: %v", err)
	}
	if legacyIngress.BackendsObserved || len(legacyIngress.Backends) != 0 {
		t.Fatalf("legacy Ingress gained authoritative evidence: %+v", legacyIngress)
	}
}

func TestPodMatchingMetadataIsNotSerialized(t *testing.T) {
	payload, err := json.Marshal(PodListItemDTO{
		Name:           "api-0",
		Labels:         map[string]string{"app": "api"},
		LabelsObserved: true,
	})
	if err != nil {
		t.Fatalf("marshal Pod: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode Pod payload: %v", err)
	}
	if _, ok := decoded["labels"]; ok {
		t.Fatalf("Pod labels leaked into JSON: %s", payload)
	}
	if _, ok := decoded["labelsObserved"]; ok {
		t.Fatalf("Pod labels observation marker leaked into JSON: %s", payload)
	}
}
