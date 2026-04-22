package dto

type ClusterRoleBindingListItemDTO struct {
	Name               string `json:"name"`
	RoleRefKind        string `json:"roleRefKind"`
	RoleRefName        string `json:"roleRefName"`
	SubjectsCount      int    `json:"subjectsCount"`
	AgeSec             int64  `json:"ageSec"`
	BindingHint        string `json:"bindingHint,omitempty"`
	SubjectBreadth     string `json:"subjectBreadth,omitempty"`
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type ClusterRoleBindingDetailsDTO struct {
	Summary  BindingSummaryDTO `json:"summary"`
	RoleRef  RoleRefDTO        `json:"roleRef"`
	Subjects []SubjectDTO      `json:"subjects"`
	YAML     string            `json:"yaml"`
}
