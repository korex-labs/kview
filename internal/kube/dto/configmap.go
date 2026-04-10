package dto

type ConfigMapDTO struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	KeysCount      int    `json:"keysCount"`
	Immutable      bool   `json:"immutable"`
	AgeSec         int64  `json:"ageSec"`
	ContentHint    string `json:"contentHint,omitempty"`
	NeedsAttention bool   `json:"needsAttention,omitempty"`
}

type ConfigMapDetailsDTO struct {
	Summary  ConfigMapSummaryDTO  `json:"summary"`
	Keys     []ConfigMapKeyDTO    `json:"keys"`
	KeyNames []string             `json:"keyNames"`
	Metadata ConfigMapMetadataDTO `json:"metadata"`
	YAML     string               `json:"yaml"`
}

type ConfigMapSummaryDTO struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Immutable       *bool  `json:"immutable,omitempty"`
	DataKeysCount   int    `json:"dataKeysCount"`
	BinaryKeysCount int    `json:"binaryKeysCount"`
	KeysCount       int    `json:"keysCount"`
	TotalBytes      *int64 `json:"totalBytes,omitempty"`
	CreatedAt       int64  `json:"createdAt,omitempty"`
	AgeSec          int64  `json:"ageSec"`
}

type ConfigMapKeyDTO struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	SizeBytes int64  `json:"sizeBytes"`
}

type ConfigMapMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
