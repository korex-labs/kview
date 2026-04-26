package dto

// CRDListItemDTO is the compact representation for the list table.
type CRDListItemDTO struct {
	Name               string `json:"name"`
	Group              string `json:"group"`
	Scope              string `json:"scope"`
	Kind               string `json:"kind"`
	Versions           string `json:"versions"`
	StorageVersion     string `json:"storageVersion,omitempty"` // preferred version for dynamic client queries
	Plural             string `json:"plural,omitempty"`         // resource name (plural), e.g. "certificates"
	Established        bool   `json:"established"`
	AgeSec             int64  `json:"ageSec"`
	HealthBucket       string `json:"healthBucket,omitempty"`
	VersionBreadth     string `json:"versionBreadth,omitempty"`
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

// CRDDetailsDTO is the full representation for the drawer.
type CRDDetailsDTO struct {
	Summary    CRDSummaryDTO     `json:"summary"`
	Versions   []CRDVersionDTO   `json:"versions"`
	Conditions []CRDConditionDTO `json:"conditions"`
	Metadata   CRDMetadataDTO    `json:"metadata"`
	YAML       string            `json:"yaml"`
}

type CRDSummaryDTO struct {
	Name               string   `json:"name"`
	Group              string   `json:"group"`
	Scope              string   `json:"scope"`
	Kind               string   `json:"kind"`
	Plural             string   `json:"plural"`
	Singular           string   `json:"singular,omitempty"`
	ShortNames         []string `json:"shortNames,omitempty"`
	Categories         []string `json:"categories,omitempty"`
	ConversionStrategy string   `json:"conversionStrategy,omitempty"`
	Established        bool     `json:"established"`
	AgeSec             int64    `json:"ageSec"`
	CreatedAt          int64    `json:"createdAt"`
}

type CRDVersionDTO struct {
	Name               string `json:"name"`
	Served             bool   `json:"served"`
	Storage            bool   `json:"storage"`
	Deprecated         bool   `json:"deprecated"`
	DeprecationWarning string `json:"deprecationWarning,omitempty"`
}

type CRDConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type CRDMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
