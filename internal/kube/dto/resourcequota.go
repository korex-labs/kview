package dto

type ResourceQuotaListDTO struct {
	Items []ResourceQuotaDTO `json:"items"`
}

type ResourceQuotaDTO struct {
	Name      string                  `json:"name"`
	Namespace string                  `json:"namespace"`
	AgeSec    int64                   `json:"ageSec"`
	Entries   []ResourceQuotaEntryDTO `json:"entries"`
}

type ResourceQuotaEntryDTO struct {
	Key   string   `json:"key"`
	Used  string   `json:"used"`
	Hard  string   `json:"hard"`
	Ratio *float64 `json:"ratio,omitempty"`
}

type LimitRangeListDTO struct {
	Items []LimitRangeDTO `json:"items"`
}

type LimitRangeDTO struct {
	Name      string              `json:"name"`
	Namespace string              `json:"namespace"`
	AgeSec    int64               `json:"ageSec"`
	Items     []LimitRangeItemDTO `json:"items"`
}

type LimitRangeItemDTO struct {
	Type           string            `json:"type"`
	Min            map[string]string `json:"min,omitempty"`
	Max            map[string]string `json:"max,omitempty"`
	Default        map[string]string `json:"default,omitempty"`
	DefaultRequest map[string]string `json:"defaultRequest,omitempty"`
	MaxLimitRatio  map[string]string `json:"maxLimitRequestRatio,omitempty"`
}
