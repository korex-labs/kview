package dto

type ServiceAccountListItemDTO struct {
	Name                         string `json:"name"`
	Namespace                    string `json:"namespace"`
	ImagePullSecretsCount        int    `json:"imagePullSecretsCount"`
	SecretsCount                 int    `json:"secretsCount"`
	AutomountServiceAccountToken *bool  `json:"automountServiceAccountToken,omitempty"`
	AgeSec                       int64  `json:"ageSec"`
	TokenMountPolicy             string `json:"tokenMountPolicy,omitempty"`
	PullSecretHint               string `json:"pullSecretHint,omitempty"`
	NeedsAttention               bool   `json:"needsAttention,omitempty"`
}

type ServiceAccountDetailsDTO struct {
	Summary  ServiceAccountSummaryDTO  `json:"summary"`
	Metadata ServiceAccountMetadataDTO `json:"metadata"`
	YAML     string                    `json:"yaml"`
}

type ServiceAccountSummaryDTO struct {
	Name                         string `json:"name"`
	Namespace                    string `json:"namespace"`
	ImagePullSecretsCount        int    `json:"imagePullSecretsCount"`
	SecretsCount                 int    `json:"secretsCount"`
	AutomountServiceAccountToken *bool  `json:"automountServiceAccountToken,omitempty"`
	CreatedAt                    int64  `json:"createdAt,omitempty"`
	AgeSec                       int64  `json:"ageSec"`
}

type ServiceAccountMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
