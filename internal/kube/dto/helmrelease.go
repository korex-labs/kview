package dto

type HelmReleaseDTO struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Status          string `json:"status"`
	Revision        int    `json:"revision"`
	Chart           string `json:"chart"`
	ChartName       string `json:"chartName"`
	ChartVersion    string `json:"chartVersion"`
	AppVersion      string `json:"appVersion"`
	Description     string `json:"description,omitempty"`
	Updated         int64  `json:"updated"`
	StorageBackend  string `json:"storageBackend"`
	StabilityBucket string `json:"stabilityBucket,omitempty"`
	Transitional    bool   `json:"transitional,omitempty"`
	NeedsAttention  bool   `json:"needsAttention,omitempty"`
}

type HelmReleaseDetailsDTO struct {
	Summary  HelmReleaseSummaryDTO `json:"summary"`
	History  []HelmReleaseRevision `json:"history"`
	Notes    string                `json:"notes,omitempty"`
	Values   string                `json:"values,omitempty"`
	Manifest string                `json:"manifest,omitempty"`
	Hooks    []HelmHookDTO         `json:"hooks,omitempty"`
	Yaml     string                `json:"yaml,omitempty"`
}

type HelmReleaseSummaryDTO struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Status         string `json:"status"`
	Revision       int    `json:"revision"`
	Updated        int64  `json:"updated"`
	Chart          string `json:"chart"`
	ChartName      string `json:"chartName"`
	ChartVersion   string `json:"chartVersion"`
	AppVersion     string `json:"appVersion"`
	StorageBackend string `json:"storageBackend"`
	Description    string `json:"description,omitempty"`
	FirstDeployed  int64  `json:"firstDeployed,omitempty"`
	LastDeployed   int64  `json:"lastDeployed,omitempty"`
}

type HelmReleaseRevision struct {
	Revision     int    `json:"revision"`
	Status       string `json:"status"`
	Updated      int64  `json:"updated"`
	Chart        string `json:"chart"`
	ChartVersion string `json:"chartVersion"`
	AppVersion   string `json:"appVersion"`
	Description  string `json:"description,omitempty"`
}

type HelmHookDTO struct {
	Name           string   `json:"name"`
	Kind           string   `json:"kind"`
	Events         []string `json:"events"`
	Weight         int      `json:"weight"`
	DeletePolicies []string `json:"deletePolicies,omitempty"`
}

type HelmChartDTO struct {
	ChartName    string   `json:"chartName"`
	ChartVersion string   `json:"chartVersion"`
	AppVersion   string   `json:"appVersion"`
	Releases     int      `json:"releases"`
	Namespaces   []string `json:"namespaces"`
}
