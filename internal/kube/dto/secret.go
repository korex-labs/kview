package dto

type SecretDTO struct {
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Type               string `json:"type"`
	KeysCount          int    `json:"keysCount"`
	Immutable          bool   `json:"immutable"`
	AgeSec             int64  `json:"ageSec"`
	ContentHint        string `json:"contentHint,omitempty"`
	TypeHint           string `json:"typeHint,omitempty"`
	NeedsAttention     bool   `json:"needsAttention,omitempty"`
	ListStatus         string `json:"listStatus,omitempty"`
	ListSignalSeverity string `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int    `json:"listSignalCount,omitempty"`
}

type SecretDetailsDTO struct {
	Summary  SecretSummaryDTO  `json:"summary"`
	Keys     []SecretKeyDTO    `json:"keys"`
	KeyNames []string          `json:"keyNames"`
	Metadata SecretMetadataDTO `json:"metadata"`
	YAML     string            `json:"yaml"`
}

type SecretKeyDTO struct {
	Name      string `json:"name"`
	Value     string `json:"value"`
	SizeBytes int    `json:"sizeBytes"`
}

type SecretSummaryDTO struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Type      string `json:"type"`
	Immutable *bool  `json:"immutable,omitempty"`
	KeysCount int    `json:"keysCount"`
	CreatedAt int64  `json:"createdAt,omitempty"`
	AgeSec    int64  `json:"ageSec"`
}

type SecretMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
