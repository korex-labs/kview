package dto

type RoleListItemDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	RulesCount         int    `json:"rulesCount"`
	AgeSec             int64  `json:"ageSec"`
	PrivilegeBreadth   string `json:"privilegeBreadth,omitempty"`
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type RoleDetailsDTO struct {
	Summary RoleSummaryDTO  `json:"summary"`
	Rules   []PolicyRuleDTO `json:"rules"`
	YAML    string          `json:"yaml"`
}

type RoleSummaryDTO struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	RulesCount int    `json:"rulesCount"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
	AgeSec     int64  `json:"ageSec"`
}

type PolicyRuleDTO struct {
	APIGroups       []string `json:"apiGroups,omitempty"`
	Resources       []string `json:"resources,omitempty"`
	Verbs           []string `json:"verbs,omitempty"`
	ResourceNames   []string `json:"resourceNames,omitempty"`
	NonResourceURLs []string `json:"nonResourceURLs,omitempty"`
}
