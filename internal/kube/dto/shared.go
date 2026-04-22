package dto

type ContainerResourcesDTO struct {
	CPURequest    string `json:"cpuRequest,omitempty"`
	CPULimit      string `json:"cpuLimit,omitempty"`
	MemoryRequest string `json:"memoryRequest,omitempty"`
	MemoryLimit   string `json:"memoryLimit,omitempty"`
}

// ContainerUsageDTO is the per-container live usage sample paired with a
// container-level request/limit percent breakdown. CPU is milliCPU, memory is
// bytes. Percent values are 0..100 or higher in rare overages; the field is
// omitted when the corresponding request/limit is absent or zero.
type ContainerUsageDTO struct {
	CPUMilli       int64   `json:"cpuMilli"`
	MemoryBytes    int64   `json:"memoryBytes"`
	CPUPctRequest  float64 `json:"cpuPctRequest,omitempty"`
	CPUPctLimit    float64 `json:"cpuPctLimit,omitempty"`
	MemoryPctReq   float64 `json:"memoryPctRequest,omitempty"`
	MemoryPctLimit float64 `json:"memoryPctLimit,omitempty"`
}

type TolerationDTO struct {
	Key      string `json:"key,omitempty"`
	Operator string `json:"operator,omitempty"`
	Value    string `json:"value,omitempty"`
	Effect   string `json:"effect,omitempty"`
	Seconds  *int64 `json:"seconds,omitempty"`
}

type TopologySpreadConstraintDTO struct {
	MaxSkew           int32  `json:"maxSkew"`
	TopologyKey       string `json:"topologyKey,omitempty"`
	WhenUnsatisfiable string `json:"whenUnsatisfiable,omitempty"`
	LabelSelector     string `json:"labelSelector,omitempty"`
}

type VolumeDTO struct {
	Name   string `json:"name"`
	Type   string `json:"type,omitempty"`
	Source string `json:"source,omitempty"`
}

type MissingReferenceDTO struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Source string `json:"source,omitempty"`
}
