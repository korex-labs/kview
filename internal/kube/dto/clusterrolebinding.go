package dto

type ClusterRoleBindingListItemDTO struct {
	Name           string `json:"name"`
	RoleRefKind    string `json:"roleRefKind"`
	RoleRefName    string `json:"roleRefName"`
	SubjectsCount  int    `json:"subjectsCount"`
	AgeSec         int64  `json:"ageSec"`
	BindingHint    string `json:"bindingHint,omitempty"`
	SubjectBreadth string `json:"subjectBreadth,omitempty"`
	NeedsAttention bool   `json:"needsAttention,omitempty"`
}

type ClusterRoleBindingDetailsDTO struct {
	Summary  BindingSummaryDTO `json:"summary"`
	RoleRef  RoleRefDTO        `json:"roleRef"`
	Subjects []SubjectDTO      `json:"subjects"`
	YAML     string            `json:"yaml"`
}
