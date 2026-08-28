package dto

type IngressListItemDTO struct {
	Name                string                       `json:"name"`
	Namespace           string                       `json:"namespace"`
	Labels              map[string]string            `json:"-"`
	Annotations         map[string]string            `json:"-"`
	IngressClassName    string                       `json:"ingressClassName"`
	Hosts               []string                     `json:"hosts"`
	Backends            []IngressBackendReferenceDTO `json:"backends,omitempty"`
	BackendsObserved    bool                         `json:"backendsObserved,omitempty"`
	TLSCount            int32                        `json:"tlsCount"`
	Addresses           []string                     `json:"addresses"`
	AgeSec              int64                        `json:"ageSec"`
	RoutingHealthBucket string                       `json:"routingHealthBucket,omitempty"`
	AddressState        string                       `json:"addressState,omitempty"`
	TLSHint             string                       `json:"tlsHint,omitempty"`
	NeedsAttention      bool                         `json:"needsAttention,omitempty"`
	ListStatus          string                       `json:"listStatus,omitempty"`
	ListSignalSeverity  string                       `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount     int                          `json:"listSignalCount,omitempty"`
}

type IngressBackendReferenceDTO struct {
	ServiceName string `json:"serviceName"`
	ServicePort string `json:"servicePort,omitempty"`
	Host        string `json:"host,omitempty"`
	Path        string `json:"path,omitempty"`
	Default     bool   `json:"default,omitempty"`
}

type IngressDetailsDTO struct {
	Summary        IngressSummaryDTO  `json:"summary"`
	Rules          []IngressRuleDTO   `json:"rules"`
	TLS            []IngressTLSDTO    `json:"tls"`
	DefaultBackend *IngressBackendDTO `json:"defaultBackend,omitempty"`
	Warnings       IngressWarningsDTO `json:"warnings"`
	YAML           string             `json:"yaml"`
}

type IngressSummaryDTO struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	IngressClassName string            `json:"ingressClassName"`
	Addresses        []string          `json:"addresses"`
	Hosts            []string          `json:"hosts"`
	TLSCount         int32             `json:"tlsCount"`
	AgeSec           int64             `json:"ageSec"`
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
}

type IngressRuleDTO struct {
	Host  string           `json:"host"`
	Paths []IngressPathDTO `json:"paths"`
}

type IngressPathDTO struct {
	Path               string `json:"path"`
	PathType           string `json:"pathType"`
	BackendServiceName string `json:"backendServiceName"`
	BackendServicePort string `json:"backendServicePort"`
}

type IngressTLSDTO struct {
	SecretName string   `json:"secretName"`
	Hosts      []string `json:"hosts"`
}

type IngressBackendDTO struct {
	ServiceName string `json:"serviceName"`
	ServicePort string `json:"servicePort"`
}

type IngressWarningsDTO struct {
	MissingBackendServices []string `json:"missingBackendServices,omitempty"`
	NoReadyEndpoints       []string `json:"noReadyEndpoints,omitempty"`
}
