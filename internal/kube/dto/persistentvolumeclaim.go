package dto

type PersistentVolumeClaimDTO struct {
	Name               string   `json:"name"`
	Namespace          string   `json:"namespace"`
	Phase              string   `json:"phase,omitempty"`
	StorageClassName   string   `json:"storageClassName,omitempty"`
	VolumeName         string   `json:"volumeName,omitempty"`
	AccessModes        []string `json:"accessModes,omitempty"`
	RequestedStorage   string   `json:"requestedStorage,omitempty"`
	Capacity           string   `json:"capacity,omitempty"`
	VolumeMode         string   `json:"volumeMode,omitempty"`
	AgeSec             int64    `json:"ageSec"`
	HealthBucket       string   `json:"healthBucket,omitempty"`
	NeedsAttention     bool     `json:"needsAttention,omitempty"`
	ResizePending      bool     `json:"resizePending,omitempty"`
	ListStatus         string   `json:"listStatus,omitempty"`
	ListSignalSeverity string   `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int      `json:"listSignalCount,omitempty"`
}

type PersistentVolumeClaimDetailsDTO struct {
	Summary  PersistentVolumeClaimSummaryDTO  `json:"summary"`
	Spec     PersistentVolumeClaimSpecDTO     `json:"spec"`
	Status   PersistentVolumeClaimStatusDTO   `json:"status"`
	Metadata PersistentVolumeClaimMetadataDTO `json:"metadata"`
	YAML     string                           `json:"yaml"`
}

type PersistentVolumeClaimSummaryDTO struct {
	Name             string   `json:"name"`
	Namespace        string   `json:"namespace"`
	Phase            string   `json:"phase,omitempty"`
	StorageClassName string   `json:"storageClassName,omitempty"`
	VolumeName       string   `json:"volumeName,omitempty"`
	AccessModes      []string `json:"accessModes,omitempty"`
	RequestedStorage string   `json:"requestedStorage,omitempty"`
	Capacity         string   `json:"capacity,omitempty"`
	VolumeMode       string   `json:"volumeMode,omitempty"`
	AgeSec           int64    `json:"ageSec"`
	CreatedAt        int64    `json:"createdAt,omitempty"`
}

type PersistentVolumeClaimSpecDTO struct {
	AccessModes   []string                         `json:"accessModes,omitempty"`
	VolumeMode    string                           `json:"volumeMode,omitempty"`
	Requests      PersistentVolumeClaimRequestsDTO `json:"requests,omitempty"`
	Selector      *LabelSelectorDTO                `json:"selector,omitempty"`
	DataSource    *PersistentVolumeClaimDataRefDTO `json:"dataSource,omitempty"`
	DataSourceRef *PersistentVolumeClaimDataRefDTO `json:"dataSourceRef,omitempty"`
	Finalizers    []string                         `json:"finalizers,omitempty"`
}

type PersistentVolumeClaimRequestsDTO struct {
	Storage string `json:"storage,omitempty"`
}

type PersistentVolumeClaimStatusDTO struct {
	Phase      string                              `json:"phase,omitempty"`
	Capacity   string                              `json:"capacity,omitempty"`
	Conditions []PersistentVolumeClaimConditionDTO `json:"conditions,omitempty"`
}

type PersistentVolumeClaimConditionDTO struct {
	Type               string `json:"type,omitempty"`
	Status             string `json:"status,omitempty"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type PersistentVolumeClaimMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type PersistentVolumeClaimDataRefDTO struct {
	Kind     string `json:"kind,omitempty"`
	Name     string `json:"name,omitempty"`
	APIGroup string `json:"apiGroup,omitempty"`
}

type LabelSelectorDTO struct {
	MatchLabels      map[string]string         `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorExpression `json:"matchExpressions,omitempty"`
}

type LabelSelectorExpression struct {
	Key      string   `json:"key,omitempty"`
	Operator string   `json:"operator,omitempty"`
	Values   []string `json:"values,omitempty"`
}
