package dto

type PersistentVolumeDTO struct {
	Name             string   `json:"name"`
	Phase            string   `json:"phase,omitempty"`
	Capacity         string   `json:"capacity,omitempty"`
	AccessModes      []string `json:"accessModes,omitempty"`
	StorageClassName string   `json:"storageClassName,omitempty"`
	ReclaimPolicy    string   `json:"reclaimPolicy,omitempty"`
	VolumeMode       string   `json:"volumeMode,omitempty"`
	ClaimRef         string   `json:"claimRef,omitempty"`
	AgeSec           int64    `json:"ageSec"`
	HealthBucket     string   `json:"healthBucket,omitempty"`
	BindingHint      string   `json:"bindingHint,omitempty"`
	NeedsAttention   bool     `json:"needsAttention,omitempty"`
}

type PersistentVolumeDetailsDTO struct {
	Summary  PersistentVolumeSummaryDTO  `json:"summary"`
	Spec     PersistentVolumeSpecDTO     `json:"spec"`
	Status   PersistentVolumeStatusDTO   `json:"status"`
	Metadata PersistentVolumeMetadataDTO `json:"metadata"`
	YAML     string                      `json:"yaml"`
}

type PersistentVolumeSummaryDTO struct {
	Name             string                       `json:"name"`
	Phase            string                       `json:"phase,omitempty"`
	Capacity         string                       `json:"capacity,omitempty"`
	AccessModes      []string                     `json:"accessModes,omitempty"`
	StorageClassName string                       `json:"storageClassName,omitempty"`
	ReclaimPolicy    string                       `json:"reclaimPolicy,omitempty"`
	VolumeMode       string                       `json:"volumeMode,omitempty"`
	ClaimRef         *PersistentVolumeClaimRefDTO `json:"claimRef,omitempty"`
	AgeSec           int64                        `json:"ageSec"`
	CreatedAt        int64                        `json:"createdAt,omitempty"`
}

type PersistentVolumeSpecDTO struct {
	AccessModes      []string                  `json:"accessModes,omitempty"`
	VolumeMode       string                    `json:"volumeMode,omitempty"`
	StorageClassName string                    `json:"storageClassName,omitempty"`
	ReclaimPolicy    string                    `json:"reclaimPolicy,omitempty"`
	MountOptions     []string                  `json:"mountOptions,omitempty"`
	VolumeSource     PersistentVolumeSourceDTO `json:"volumeSource"`
}

type PersistentVolumeSourceDTO struct {
	Type    string                            `json:"type,omitempty"`
	Details []PersistentVolumeSourceDetailDTO `json:"details,omitempty"`
}

type PersistentVolumeSourceDetailDTO struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type PersistentVolumeStatusDTO struct {
	Phase      string                         `json:"phase,omitempty"`
	Capacity   string                         `json:"capacity,omitempty"`
	Conditions []PersistentVolumeConditionDTO `json:"conditions,omitempty"`
}

type PersistentVolumeConditionDTO struct {
	Type               string `json:"type,omitempty"`
	Status             string `json:"status,omitempty"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type PersistentVolumeMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type PersistentVolumeClaimRefDTO struct {
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
}
