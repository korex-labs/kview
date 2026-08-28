package dto

type ServiceDetailsDTO struct {
	Summary   ServiceSummaryDTO   `json:"summary"`
	Ports     []ServicePortDTO    `json:"ports"`
	Traffic   ServiceTrafficDTO   `json:"traffic"`
	Endpoints ServiceEndpointsDTO `json:"endpoints"`
	YAML      string              `json:"yaml"`
}

type ServiceSummaryDTO struct {
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	Type            string            `json:"type"`
	ClusterIPs      []string          `json:"clusterIPs"`
	ExternalName    string            `json:"externalName,omitempty"`
	Selector        map[string]string `json:"selector,omitempty"`
	SessionAffinity string            `json:"sessionAffinity,omitempty"`
	AgeSec          int64             `json:"ageSec"`
	Labels          map[string]string `json:"labels,omitempty"`
	Annotations     map[string]string `json:"annotations,omitempty"`
}

type ServicePortDTO struct {
	Name       string `json:"name,omitempty"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	NodePort   int32  `json:"nodePort,omitempty"`
}

type ServiceTrafficDTO struct {
	ExternalTrafficPolicy string   `json:"externalTrafficPolicy,omitempty"`
	LoadBalancerIngress   []string `json:"loadBalancerIngress,omitempty"`
}

type ServiceEndpointsDTO struct {
	Ready    int32                   `json:"ready"`
	NotReady int32                   `json:"notReady"`
	Pods     []ServiceEndpointPodDTO `json:"pods,omitempty"`
}

type ServiceEndpointPodDTO struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Node      string `json:"node,omitempty"`
	Ready     bool   `json:"ready"`
}

type ServiceListItemDTO struct {
	Name                 string            `json:"name"`
	Namespace            string            `json:"namespace"`
	Labels               map[string]string `json:"-"`
	Annotations          map[string]string `json:"-"`
	Type                 string            `json:"type"`
	ClusterIPs           []string          `json:"clusterIPs"`
	Selector             map[string]string `json:"selector,omitempty"`
	Ports                []ServicePortDTO  `json:"ports,omitempty"`
	PortsObserved        bool              `json:"portsObserved,omitempty"`
	PortsSummary         string            `json:"portsSummary,omitempty"`
	EndpointCoverage     string            `json:"endpointCoverage,omitempty"` // complete | unknown
	EndpointsReady       int32             `json:"endpointsReady"`
	EndpointsNotReady    int32             `json:"endpointsNotReady"`
	AgeSec               int64             `json:"ageSec"`
	EndpointHealthBucket string            `json:"endpointHealthBucket,omitempty"`
	ExposureHint         string            `json:"exposureHint,omitempty"`
	NeedsAttention       bool              `json:"needsAttention,omitempty"`
	ListStatus           string            `json:"listStatus,omitempty"`
	ListSignalSeverity   string            `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount      int               `json:"listSignalCount,omitempty"`
}

type ServiceLinkDTO struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	Type              string            `json:"type"`
	Selector          map[string]string `json:"selector,omitempty"`
	PortsSummary      string            `json:"portsSummary,omitempty"`
	EndpointsReady    int32             `json:"endpointsReady"`
	EndpointsNotReady int32             `json:"endpointsNotReady"`
}
