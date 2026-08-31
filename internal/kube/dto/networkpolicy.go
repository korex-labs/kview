package dto

type NetworkPolicyDTO struct {
	ResourceRelationshipCarrier `json:"-"`
	Name                        string   `json:"name"`
	Namespace                   string   `json:"namespace"`
	PodSelector                 string   `json:"podSelector,omitempty"`
	PolicyTypes                 []string `json:"policyTypes,omitempty"`
	IngressRules                int      `json:"ingressRules"`
	EgressRules                 int      `json:"egressRules"`
	SelectedPods                int      `json:"selectedPods,omitempty"`
	AgeSec                      int64    `json:"ageSec"`
	ListStatus                  string   `json:"listStatus,omitempty"`
	NeedsAttention              bool     `json:"needsAttention,omitempty"`
}

type NetworkPolicyDetailsDTO struct {
	Summary  NetworkPolicySummaryDTO  `json:"summary"`
	Ingress  []NetworkPolicyRuleDTO   `json:"ingress,omitempty"`
	Egress   []NetworkPolicyRuleDTO   `json:"egress,omitempty"`
	Metadata NetworkPolicyMetadataDTO `json:"metadata"`
	YAML     string                   `json:"yaml"`
}

type NetworkPolicySummaryDTO struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	PodSelector  string            `json:"podSelector,omitempty"`
	PolicyTypes  []string          `json:"policyTypes,omitempty"`
	IngressRules int               `json:"ingressRules"`
	EgressRules  int               `json:"egressRules"`
	SelectedPods int               `json:"selectedPods,omitempty"`
	AgeSec       int64             `json:"ageSec"`
	Labels       map[string]string `json:"labels,omitempty"`
	Annotations  map[string]string `json:"annotations,omitempty"`
}

type NetworkPolicyRuleDTO struct {
	Peers []string `json:"peers,omitempty"`
	Ports []string `json:"ports,omitempty"`
}

type NetworkPolicyMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
