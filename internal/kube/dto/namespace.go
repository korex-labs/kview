package dto

type NamespaceListItemDTO struct {
	Name                   string `json:"name"`
	Phase                  string `json:"phase"`
	AgeSec                 int64  `json:"ageSec"`
	HasUnhealthyConditions bool   `json:"hasUnhealthyConditions"`
}

type NamespaceDetailsDTO struct {
	Summary    NamespaceSummaryDTO     `json:"summary"`
	Metadata   NamespaceMetadataDTO    `json:"metadata"`
	Conditions []NamespaceConditionDTO `json:"conditions"`
	YAML       string                  `json:"yaml"`
}

type NamespaceSummaryDTO struct {
	Name      string `json:"name"`
	Phase     string `json:"phase"`
	CreatedAt int64  `json:"createdAt"`
	AgeSec    int64  `json:"ageSec"`
}

type NamespaceMetadataDTO struct {
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type NamespaceConditionDTO struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime int64  `json:"lastTransitionTime"`
}

type NamespaceSummaryResourcesDTO struct {
	Counts       NamespaceResourceCounts   `json:"counts"`
	PodHealth    NamespacePodHealth        `json:"podHealth"`
	DeployHealth NamespaceDeploymentHealth `json:"deploymentHealth"`
	Problematic  []ProblematicResource     `json:"problematic"`
	HelmReleases []NamespaceHelmRelease    `json:"helmReleases,omitempty"`
	// RestartHotspots is a bounded, severity-sorted view from dataplane pod snapshots (Stage 5C).
	RestartHotspots []PodRestartHotspotDTO `json:"restartHotspots,omitempty"`
	// WorkloadByKind rolls up coarse health from dataplane workload list snapshots (Stage 5C).
	WorkloadByKind *NamespaceWorkloadHealthRollupDTO `json:"workloadByKind,omitempty"`
	Meta           *NamespaceSummaryMetaDTO          `json:"meta,omitempty"`
}

// PodRestartHotspotDTO surfaces restart-heavy pods for operator attention.
type PodRestartHotspotDTO struct {
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	Restarts        int32  `json:"restarts"`
	Phase           string `json:"phase"`
	Node            string `json:"node,omitempty"`
	LastEventReason string `json:"lastEventReason,omitempty"`
	Severity        string `json:"severity"` // high | medium | low
}

// WorkloadKindHealthRollupDTO is a simple healthy / progressing / degraded partition per kind.
type WorkloadKindHealthRollupDTO struct {
	Total       int `json:"total"`
	Healthy     int `json:"healthy"`
	Progressing int `json:"progressing"`
	Degraded    int `json:"degraded"`
}

// NamespaceWorkloadHealthRollupDTO aggregates workload health for a namespace from list snapshots.
type NamespaceWorkloadHealthRollupDTO struct {
	Deployments  WorkloadKindHealthRollupDTO `json:"deployments"`
	DaemonSets   WorkloadKindHealthRollupDTO `json:"daemonSets"`
	StatefulSets WorkloadKindHealthRollupDTO `json:"statefulSets"`
	Jobs         WorkloadKindHealthRollupDTO `json:"jobs"`
	CronJobs     WorkloadKindHealthRollupDTO `json:"cronJobs"`
	ReplicaSets  WorkloadKindHealthRollupDTO `json:"replicaSets"`
}

type NamespaceResourceCounts struct {
	Pods         int `json:"pods"`
	Deployments  int `json:"deployments"`
	StatefulSets int `json:"statefulSets"`
	DaemonSets   int `json:"daemonSets"`
	Jobs         int `json:"jobs"`
	CronJobs     int `json:"cronJobs"`
	Services     int `json:"services"`
	Ingresses    int `json:"ingresses"`
	PVCs         int `json:"pvcs"`
	ConfigMaps   int `json:"configMaps"`
	Secrets      int `json:"secrets"`
	HelmReleases int `json:"helmReleases"`
}

type NamespacePodHealth struct {
	Running   int `json:"running"`
	Pending   int `json:"pending"`
	Failed    int `json:"failed"`
	Succeeded int `json:"succeeded"`
	Unknown   int `json:"unknown"`
}

type NamespaceDeploymentHealth struct {
	Healthy     int `json:"healthy"`
	Degraded    int `json:"degraded"`
	Progressing int `json:"progressing"`
}

type ProblematicResource struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type NamespaceHelmRelease struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Revision int    `json:"revision"`
}

// NamespaceSummaryMetaDTO describes projection metadata for the namespace summary.
type NamespaceSummaryMetaDTO struct {
	Freshness    string `json:"freshness"`
	Coverage     string `json:"coverage"`
	Degradation  string `json:"degradation"`
	Completeness string `json:"completeness"`
	// State is a coarse overall state for the current summary contract.
	// Stage 5A currently returns values like:
	// "ok", "empty", "denied", "partial_proxy", or "degraded".
	State string `json:"state"`
}
