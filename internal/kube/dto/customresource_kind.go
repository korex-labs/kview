package dto

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// CustomResourceKindList is an on-demand exact-GVR page, never an aggregate snapshot.
type CustomResourceKindList struct {
	Group     string                         `json:"group"`
	Version   string                         `json:"version"`
	Resource  string                         `json:"resource"`
	Kind      string                         `json:"kind"`
	Scope     string                         `json:"scope"`
	Namespace string                         `json:"namespace,omitempty"`
	Columns   []metav1.TableColumnDefinition `json:"columns"`
	Items     []CustomResourceKindRow        `json:"items"`
	Meta      CustomResourceKindMeta         `json:"meta"`
}

type CustomResourceKindRow struct {
	CustomResourceInstanceDTO
	UID           string `json:"uid"`
	IdentityKnown bool   `json:"identityKnown"`
	AgeKnown      bool   `json:"ageKnown"`
	// Cells align with Columns. Missing cells are JSON null, never guessed.
	Cells []any `json:"cells"`
}

type CustomResourceKindMeta struct {
	ColumnSource        string `json:"columnSource"` // table | standard
	FallbackReason      string `json:"fallbackReason,omitempty"`
	Limit               int    `json:"limit"`
	Pages               int    `json:"pages"`
	Truncated           bool   `json:"truncated"`
	Continue            string `json:"continue,omitempty"`
	ResourceVersion     string `json:"resourceVersion,omitempty"`
	Partial             bool   `json:"partial"`
	UnknownIdentityRows int    `json:"unknownIdentityRows"`
	IncompleteCellRows  int    `json:"incompleteCellRows"`
}
