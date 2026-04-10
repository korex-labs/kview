package dto

type ClusterRoleListItemDTO struct {
	Name             string `json:"name"`
	RulesCount       int    `json:"rulesCount"`
	AgeSec           int64  `json:"ageSec"`
	PrivilegeBreadth string `json:"privilegeBreadth,omitempty"`
	NeedsAttention   bool   `json:"needsAttention,omitempty"`
}

type ClusterRoleDetailsDTO struct {
	Summary ClusterRoleSummaryDTO `json:"summary"`
	Rules   []PolicyRuleDTO       `json:"rules"`
	YAML    string                `json:"yaml"`
}

type ClusterRoleSummaryDTO struct {
	Name       string `json:"name"`
	RulesCount int    `json:"rulesCount"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
	AgeSec     int64  `json:"ageSec"`
}
