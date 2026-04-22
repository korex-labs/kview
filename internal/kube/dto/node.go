package dto

type NodeListItemDTO struct {
	Name              string   `json:"name"`
	Status            string   `json:"status"`
	Roles             []string `json:"roles,omitempty"`
	CPUAllocatable    string   `json:"cpuAllocatable,omitempty"`
	MemoryAllocatable string   `json:"memoryAllocatable,omitempty"`
	PodsAllocatable   string   `json:"podsAllocatable,omitempty"`
	PodsCount         int      `json:"podsCount"`
	KubeletVersion    string   `json:"kubeletVersion,omitempty"`
	AgeSec            int64    `json:"ageSec"`
	HealthBucket      string   `json:"healthBucket,omitempty"`
	PodDensityBucket  string   `json:"podDensityBucket,omitempty"`
	PodDensityRatio   float64  `json:"podDensityRatio,omitempty"`
	NeedsAttention    bool     `json:"needsAttention,omitempty"`
	Derived           bool     `json:"derived,omitempty"`
	DerivedSource     string   `json:"derivedSource,omitempty"`
	DerivedCoverage   string   `json:"derivedCoverage,omitempty"`
	DerivedNote       string   `json:"derivedNote,omitempty"`
	NamespaceCount    int      `json:"namespaceCount,omitempty"`
	ProblematicPods   int      `json:"problematicPods,omitempty"`
	RestartCount      int32    `json:"restartCount,omitempty"`

	// Usage enrichment merged from cached NodeMetricsSnapshot.
	CPUMilli           int64   `json:"cpuMilli,omitempty"`
	MemoryBytes        int64   `json:"memoryBytes,omitempty"`
	CPUPctAlloc        float64 `json:"cpuPctAllocatable,omitempty"`
	MemoryPctAlloc     float64 `json:"memoryPctAllocatable,omitempty"`
	UsageAvailable     bool    `json:"usageAvailable,omitempty"`
	ListStatus         string  `json:"listStatus,omitempty"`
	ListSignalSeverity string  `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int     `json:"listSignalCount,omitempty"`
}

type NodeDetailsDTO struct {
	Summary    NodeSummaryDTO     `json:"summary"`
	Metadata   NodeMetadataDTO    `json:"metadata"`
	Conditions []NodeConditionDTO `json:"conditions"`
	Capacity   NodeCapacityDTO    `json:"capacity"`
	Taints     []NodeTaintDTO     `json:"taints,omitempty"`
	Pods       []NodePodDTO       `json:"pods"`
	LinkedPods NodePodsSummaryDTO `json:"linkedPods"`
	YAML       string             `json:"yaml"`
	Derived    *DerivedMetaDTO    `json:"derived,omitempty"`
}

type DerivedMetaDTO struct {
	Source       string `json:"source"`
	Coverage     string `json:"coverage,omitempty"`
	Completeness string `json:"completeness,omitempty"`
	Note         string `json:"note,omitempty"`
}

type NodeSummaryDTO struct {
	Name           string   `json:"name"`
	Status         string   `json:"status"`
	Roles          []string `json:"roles,omitempty"`
	KubeletVersion string   `json:"kubeletVersion,omitempty"`
	OSImage        string   `json:"osImage,omitempty"`
	KernelVersion  string   `json:"kernelVersion,omitempty"`
	Architecture   string   `json:"architecture,omitempty"`
	ProviderID     string   `json:"providerID,omitempty"`
	CreatedAt      int64    `json:"createdAt"`
	AgeSec         int64    `json:"ageSec"`
}

type NodeMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type NodeConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime,omitempty"`
}

type NodeCapacityDTO struct {
	CPUCapacity       string `json:"cpuCapacity,omitempty"`
	CPUAllocatable    string `json:"cpuAllocatable,omitempty"`
	MemoryCapacity    string `json:"memoryCapacity,omitempty"`
	MemoryAllocatable string `json:"memoryAllocatable,omitempty"`
	PodsCapacity      string `json:"podsCapacity,omitempty"`
	PodsAllocatable   string `json:"podsAllocatable,omitempty"`

	// Usage enrichment merged from cached NodeMetricsSnapshot.
	CPUMilliUsed       int64   `json:"cpuMilliUsed,omitempty"`
	MemoryBytesUsed    int64   `json:"memoryBytesUsed,omitempty"`
	CPUPctAlloc        float64 `json:"cpuPctAllocatable,omitempty"`
	MemoryPctAlloc     float64 `json:"memoryPctAllocatable,omitempty"`
	UsageAvailable     bool    `json:"usageAvailable,omitempty"`
	ListStatus         string  `json:"listStatus,omitempty"`
	ListSignalSeverity string  `json:"listSignalSeverity,omitempty"` // high | medium | low | ok
	ListSignalCount    int     `json:"listSignalCount,omitempty"`
}

type NodeTaintDTO struct {
	Key    string `json:"key,omitempty"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect,omitempty"`
}

type NodePodsSummaryDTO struct {
	Total int `json:"total"`
}

type NodePodDTO struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Phase     string `json:"phase"`
	Ready     string `json:"ready"`
	Restarts  int32  `json:"restarts"`
	AgeSec    int64  `json:"ageSec"`
}
