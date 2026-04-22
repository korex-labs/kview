package dto

type RoleBindingListItemDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
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

type RoleBindingDetailsDTO struct {
	Summary  BindingSummaryDTO `json:"summary"`
	RoleRef  RoleRefDTO        `json:"roleRef"`
	Subjects []SubjectDTO      `json:"subjects"`
	YAML     string            `json:"yaml"`
}

type BindingSummaryDTO struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
	AgeSec    int64  `json:"ageSec"`
}

type RoleRefDTO struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	APIGroup string `json:"apiGroup"`
}

type SubjectDTO struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}
