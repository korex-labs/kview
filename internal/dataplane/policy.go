package dataplane

import (
	"reflect"
	"strings"
	"time"
)

type DataplaneProfile string

const (
	DataplaneProfileManual     DataplaneProfile = "manual"
	DataplaneProfileFocused    DataplaneProfile = "focused"
	DataplaneProfileBalanced   DataplaneProfile = "balanced"
	DataplaneProfileWide       DataplaneProfile = "wide"
	DataplaneProfileDiagnostic DataplaneProfile = "diagnostic"
)

type DataplanePolicy struct {
	Profile DataplaneProfile `json:"profile"`

	Snapshots           SnapshotPolicy            `json:"snapshots"`
	Persistence         PersistencePolicy         `json:"persistence"`
	Observers           ObserverPolicy            `json:"observers"`
	NamespaceEnrichment NamespaceEnrichmentPolicy `json:"namespaceEnrichment"`
	BackgroundBudget    BackgroundBudgetPolicy    `json:"backgroundBudget"`
	Dashboard           DashboardPolicy           `json:"dashboard"`
	Metrics             MetricsPolicy             `json:"metrics"`
	Signals             SignalsPolicy             `json:"signals"`
}

type DataplanePolicyBundle struct {
	Version          string                             `json:"version,omitempty"`
	Global           DataplanePolicy                    `json:"global"`
	ContextOverrides map[string]DataplanePolicyOverride `json:"contextOverrides,omitempty"`
}

type DataplanePolicyOverride struct {
	Profile             *DataplaneProfile                  `json:"profile,omitempty"`
	Snapshots           *SnapshotPolicyOverride            `json:"snapshots,omitempty"`
	Observers           *ObserverPolicyOverride            `json:"observers,omitempty"`
	NamespaceEnrichment *NamespaceEnrichmentPolicyOverride `json:"namespaceEnrichment,omitempty"`
	BackgroundBudget    *BackgroundBudgetPolicyOverride    `json:"backgroundBudget,omitempty"`
	Metrics             *MetricsPolicyOverride             `json:"metrics,omitempty"`
	Signals             *SignalsPolicyOverride             `json:"signals,omitempty"`
	Persistence         *PersistencePolicyOverride         `json:"persistence,omitempty"`
}

type SnapshotPolicyOverride struct {
	TTLSeconds                 map[string]*int `json:"ttlSec,omitempty"`
	ManualRefreshBypassesTTL   *bool           `json:"manualRefreshBypassesTtl,omitempty"`
	InvalidateAfterKnownWrites *bool           `json:"invalidateAfterKnownMutations,omitempty"`
}

type ObserverPolicyOverride struct {
	Enabled               *bool `json:"enabled,omitempty"`
	NamespacesEnabled     *bool `json:"namespacesEnabled,omitempty"`
	NamespacesIntervalSec *int  `json:"namespacesIntervalSec,omitempty"`
	NodesEnabled          *bool `json:"nodesEnabled,omitempty"`
	NodesIntervalSec      *int  `json:"nodesIntervalSec,omitempty"`
	NodesBackoffMaxSec    *int  `json:"nodesBackoffMaxSec,omitempty"`
}

type NamespaceEnrichmentPolicyOverride struct {
	Enabled           *bool                         `json:"enabled,omitempty"`
	IncludeFocus      *bool                         `json:"includeFocus,omitempty"`
	IncludeRecent     *bool                         `json:"includeRecent,omitempty"`
	RecentLimit       *int                          `json:"recentLimit,omitempty"`
	IncludeFavourites *bool                         `json:"includeFavourites,omitempty"`
	FavouriteLimit    *int                          `json:"favouriteLimit,omitempty"`
	MaxTargets        *int                          `json:"maxTargets,omitempty"`
	MaxParallel       *int                          `json:"maxParallel,omitempty"`
	IdleQuietMs       *int                          `json:"idleQuietMs,omitempty"`
	EnrichDetails     *bool                         `json:"enrichDetails,omitempty"`
	EnrichPods        *bool                         `json:"enrichPods,omitempty"`
	EnrichDeployments *bool                         `json:"enrichDeployments,omitempty"`
	WarmResourceKinds *[]string                     `json:"warmResourceKinds,omitempty"`
	PollMs            *int                          `json:"pollMs,omitempty"`
	Sweep             *NamespaceSweepPolicyOverride `json:"sweep,omitempty"`
}

type NamespaceSweepPolicyOverride struct {
	Enabled                        *bool `json:"enabled,omitempty"`
	IdleQuietMs                    *int  `json:"idleQuietMs,omitempty"`
	MaxNamespacesPerCycle          *int  `json:"maxNamespacesPerCycle,omitempty"`
	MaxNamespacesPerHour           *int  `json:"maxNamespacesPerHour,omitempty"`
	MinReenrichIntervalMinutes     *int  `json:"minReenrichIntervalMinutes,omitempty"`
	MaxParallel                    *int  `json:"maxParallel,omitempty"`
	PauseOnUserActivity            *bool `json:"pauseOnUserActivity,omitempty"`
	PauseWhenSchedulerBusy         *bool `json:"pauseWhenSchedulerBusy,omitempty"`
	PauseOnRateLimitOrConnectivity *bool `json:"pauseOnRateLimitOrConnectivityIssues,omitempty"`
	IncludeSystemNamespaces        *bool `json:"includeSystemNamespaces,omitempty"`
}

type BackgroundBudgetPolicyOverride struct {
	MaxConcurrentPerCluster           *int `json:"maxConcurrentPerCluster,omitempty"`
	MaxBackgroundConcurrentPerCluster *int `json:"maxBackgroundConcurrentPerCluster,omitempty"`
	LongRunNoticeSec                  *int `json:"longRunNoticeSec,omitempty"`
	TransientRetries                  *int `json:"transientRetries,omitempty"`
}

type MetricsPolicyOverride struct {
	Enabled               *bool `json:"enabled,omitempty"`
	PodMetricsTTLSeconds  *int  `json:"podMetricsTtlSec,omitempty"`
	NodeMetricsTTLSeconds *int  `json:"nodeMetricsTtlSec,omitempty"`
	// Deprecated: use signals.detectors.container_near_limit.percent.
	ContainerNearLimitPct *int `json:"containerNearLimitPct,omitempty"`
	// Deprecated: use signals.detectors.node_resource_pressure.percent.
	NodePressurePct *int `json:"nodePressurePct,omitempty"`
}

type SignalDetectorsPolicyOverride struct {
	PodRestarts           *SignalPodRestartDetectorPolicyOverride    `json:"pod_restarts,omitempty"`
	ContainerNearLimit    *SignalPercentDetectorPolicyOverride       `json:"container_near_limit,omitempty"`
	NodeResourcePressure  *SignalPercentDetectorPolicyOverride       `json:"node_resource_pressure,omitempty"`
	ResourceQuotaPressure *SignalResourceQuotaDetectorPolicyOverride `json:"resource_quota_pressure,omitempty"`
}

type SignalPodRestartDetectorPolicyOverride struct {
	RestartCount *int `json:"restartCount,omitempty"`
}

type SignalPercentDetectorPolicyOverride struct {
	Percent *int `json:"percent,omitempty"`
}

type SignalResourceQuotaDetectorPolicyOverride struct {
	WarnPercent     *int `json:"warnPercent,omitempty"`
	CriticalPercent *int `json:"criticalPercent,omitempty"`
}

type SignalsPolicyOverride struct {
	LongRunningJobSec         *int `json:"longRunningJobSec,omitempty"`
	CronJobNoRecentSuccessSec *int `json:"cronJobNoRecentSuccessSec,omitempty"`
	StaleHelmReleaseSec       *int `json:"staleHelmReleaseSec,omitempty"`
	UnusedResourceAgeSec      *int `json:"unusedResourceAgeSec,omitempty"`
	PodYoungRestartWindowSec  *int `json:"podYoungRestartWindowSec,omitempty"`
	DeploymentUnavailableSec  *int `json:"deploymentUnavailableSec,omitempty"`
	// Deprecated: use signals.detectors.resource_quota_pressure.warnPercent.
	QuotaWarnPercent *int `json:"quotaWarnPercent,omitempty"`
	// Deprecated: use signals.detectors.resource_quota_pressure.criticalPercent.
	QuotaCriticalPercent *int                                 `json:"quotaCriticalPercent,omitempty"`
	Detectors            *SignalDetectorsPolicyOverride       `json:"detectors,omitempty"`
	Overrides            map[string]SignalOverride            `json:"overrides,omitempty"`
	ContextOverrides     map[string]map[string]SignalOverride `json:"contextOverrides,omitempty"`
}

type PersistencePolicyOverride struct {
	Enabled     *bool `json:"enabled,omitempty"`
	MaxAgeHours *int  `json:"maxAgeHours,omitempty"`
}

// MetricsPolicy governs metrics.k8s.io integration. Enabled is a soft gate
// (capability detection auto-disables metric widgets when Installed is false);
// the TTLs control per-cluster sampling frequency; the threshold percents
// drive usage-based signal detectors. All values have validation clamps that
// pin them inside operator-sensible bounds and fall back to the defaults.
type MetricsPolicy struct {
	Enabled               bool `json:"enabled"`
	PodMetricsTTLSeconds  int  `json:"podMetricsTtlSec"`
	NodeMetricsTTLSeconds int  `json:"nodeMetricsTtlSec"`
	// Deprecated: use signals.detectors.container_near_limit.percent.
	ContainerNearLimitPct int `json:"containerNearLimitPct"`
	// Deprecated: use signals.detectors.node_resource_pressure.percent.
	NodePressurePct int `json:"nodePressurePct"`
}

// SignalsPolicy governs detector thresholds used by dashboard, namespace insights,
// and per-resource signals. Values are validated and clamped in
// ValidateDataplanePolicy.
type SignalsPolicy struct {
	LongRunningJobSec         int `json:"longRunningJobSec"`
	CronJobNoRecentSuccessSec int `json:"cronJobNoRecentSuccessSec"`
	StaleHelmReleaseSec       int `json:"staleHelmReleaseSec"`
	UnusedResourceAgeSec      int `json:"unusedResourceAgeSec"`
	PodYoungRestartWindowSec  int `json:"podYoungRestartWindowSec"`
	DeploymentUnavailableSec  int `json:"deploymentUnavailableSec"`
	// Deprecated: use signals.detectors.resource_quota_pressure.warnPercent.
	QuotaWarnPercent int `json:"quotaWarnPercent"`
	// Deprecated: use signals.detectors.resource_quota_pressure.criticalPercent.
	QuotaCriticalPercent int                   `json:"quotaCriticalPercent"`
	Detectors            SignalDetectorsPolicy `json:"detectors"`

	Overrides        map[string]SignalOverride            `json:"overrides,omitempty"`
	ContextOverrides map[string]map[string]SignalOverride `json:"contextOverrides,omitempty"`
}

type SignalDetectorsPolicy struct {
	PodRestarts           SignalPodRestartDetectorPolicy    `json:"pod_restarts"`
	ContainerNearLimit    SignalPercentDetectorPolicy       `json:"container_near_limit"`
	NodeResourcePressure  SignalPercentDetectorPolicy       `json:"node_resource_pressure"`
	ResourceQuotaPressure SignalResourceQuotaDetectorPolicy `json:"resource_quota_pressure"`
}

type SignalPodRestartDetectorPolicy struct {
	RestartCount int `json:"restartCount"`
}

type SignalPercentDetectorPolicy struct {
	Percent int `json:"percent"`
}

type SignalResourceQuotaDetectorPolicy struct {
	WarnPercent     int `json:"warnPercent"`
	CriticalPercent int `json:"criticalPercent"`
}

// SignalOverride customizes a signal type. Nil fields inherit from the next
// outer layer: built-in defaults -> global overrides -> context overrides.
type SignalOverride struct {
	Enabled  *bool  `json:"enabled,omitempty"`
	Severity string `json:"severity,omitempty"`
	Priority *int   `json:"priority,omitempty"`
}

type SnapshotPolicy struct {
	TTLSeconds                 map[string]int `json:"ttlSec"`
	ManualRefreshBypassesTTL   bool           `json:"manualRefreshBypassesTtl"`
	InvalidateAfterKnownWrites bool           `json:"invalidateAfterKnownMutations"`
}

type PersistencePolicy struct {
	Enabled     bool `json:"enabled"`
	MaxAgeHours int  `json:"maxAgeHours"`
}

type ObserverPolicy struct {
	Enabled               bool `json:"enabled"`
	NamespacesEnabled     bool `json:"namespacesEnabled"`
	NamespacesIntervalSec int  `json:"namespacesIntervalSec"`
	NodesEnabled          bool `json:"nodesEnabled"`
	NodesIntervalSec      int  `json:"nodesIntervalSec"`
	NodesBackoffMaxSec    int  `json:"nodesBackoffMaxSec"`
}

type NamespaceEnrichmentPolicy struct {
	Enabled           bool     `json:"enabled"`
	IncludeFocus      bool     `json:"includeFocus"`
	IncludeRecent     bool     `json:"includeRecent"`
	RecentLimit       int      `json:"recentLimit"`
	IncludeFavourites bool     `json:"includeFavourites"`
	FavouriteLimit    int      `json:"favouriteLimit"`
	MaxTargets        int      `json:"maxTargets"`
	MaxParallel       int      `json:"maxParallel"`
	IdleQuietMs       int      `json:"idleQuietMs"`
	EnrichDetails     bool     `json:"enrichDetails"`
	EnrichPods        bool     `json:"enrichPods"`
	EnrichDeployments bool     `json:"enrichDeployments"`
	WarmResourceKinds []string `json:"warmResourceKinds"`
	PollMs            int      `json:"pollMs"`

	Sweep NamespaceSweepPolicy `json:"sweep"`
}

type NamespaceSweepPolicy struct {
	Enabled                        bool `json:"enabled"`
	IdleQuietMs                    int  `json:"idleQuietMs"`
	MaxNamespacesPerCycle          int  `json:"maxNamespacesPerCycle"`
	MaxNamespacesPerHour           int  `json:"maxNamespacesPerHour"`
	MinReenrichIntervalMinutes     int  `json:"minReenrichIntervalMinutes"`
	MaxParallel                    int  `json:"maxParallel"`
	PauseOnUserActivity            bool `json:"pauseOnUserActivity"`
	PauseWhenSchedulerBusy         bool `json:"pauseWhenSchedulerBusy"`
	PauseOnRateLimitOrConnectivity bool `json:"pauseOnRateLimitOrConnectivityIssues"`
	IncludeSystemNamespaces        bool `json:"includeSystemNamespaces"`
}

type BackgroundBudgetPolicy struct {
	MaxConcurrentPerCluster           int `json:"maxConcurrentPerCluster"`
	MaxBackgroundConcurrentPerCluster int `json:"maxBackgroundConcurrentPerCluster"`
	LongRunNoticeSec                  int `json:"longRunNoticeSec"`
	TransientRetries                  int `json:"transientRetries"`
}

type DashboardPolicy struct {
	RefreshSec               int  `json:"refreshSec"`
	UseCachedTotalsOnly      bool `json:"useCachedTotalsOnly"`
	RestartElevatedThreshold int  `json:"restartElevatedThreshold"`
	SignalLimit              int  `json:"signalLimit"`
}

func DefaultDataplanePolicy() DataplanePolicy {
	return DataplanePolicy{
		Profile: DataplaneProfileFocused,
		Snapshots: SnapshotPolicy{
			TTLSeconds: map[string]int{
				string(ResourceKindNamespaces):          120,
				string(ResourceKindNodes):               120,
				string(ResourceKindPersistentVolumes):   180,
				string(ResourceKindClusterRoles):        300,
				string(ResourceKindClusterRoleBindings): 300,
				string(ResourceKindCRDs):                300,
				string(ResourceKindPods):                15,
				string(ResourceKindDeployments):         45,
				string(ResourceKindDaemonSets):          45,
				string(ResourceKindStatefulSets):        45,
				string(ResourceKindReplicaSets):         30,
				string(ResourceKindJobs):                30,
				string(ResourceKindCronJobs):            30,
				string(ResourceKindHPAs):                45,
				string(ResourceKindServices):            60,
				string(ResourceKindIngresses):           60,
				string(ResourceKindPVCs):                60,
				string(ResourceKindConfigMaps):          120,
				string(ResourceKindSecrets):             120,
				string(ResourceKindServiceAccounts):     180,
				string(ResourceKindRoles):               180,
				string(ResourceKindRoleBindings):        180,
				string(ResourceKindHelmReleases):        120,
				string(ResourceKindResourceQuotas):      180,
				string(ResourceKindLimitRanges):         180,
				string(ResourceKindPodMetrics):          30,
				string(ResourceKindNodeMetrics):         30,
			},
			ManualRefreshBypassesTTL:   true,
			InvalidateAfterKnownWrites: true,
		},
		Persistence: PersistencePolicy{
			Enabled:     true,
			MaxAgeHours: 168,
		},
		Observers: ObserverPolicy{
			Enabled:               true,
			NamespacesEnabled:     true,
			NamespacesIntervalSec: 120,
			NodesEnabled:          true,
			NodesIntervalSec:      180,
			NodesBackoffMaxSec:    300,
		},
		NamespaceEnrichment: NamespaceEnrichmentPolicy{
			Enabled:           true,
			IncludeFocus:      true,
			IncludeRecent:     true,
			RecentLimit:       20,
			IncludeFavourites: true,
			FavouriteLimit:    40,
			MaxTargets:        32,
			MaxParallel:       2,
			IdleQuietMs:       2000,
			EnrichDetails:     true,
			EnrichPods:        true,
			EnrichDeployments: true,
			WarmResourceKinds: []string{string(ResourceKindPods), string(ResourceKindDeployments), string(ResourceKindResourceQuotas), string(ResourceKindLimitRanges)},
			PollMs:            1500,
			Sweep: NamespaceSweepPolicy{
				Enabled:                        false,
				IdleQuietMs:                    30000,
				MaxNamespacesPerCycle:          2,
				MaxNamespacesPerHour:           30,
				MinReenrichIntervalMinutes:     360,
				MaxParallel:                    1,
				PauseOnUserActivity:            true,
				PauseWhenSchedulerBusy:         true,
				PauseOnRateLimitOrConnectivity: true,
				IncludeSystemNamespaces:        false,
			},
		},
		BackgroundBudget: BackgroundBudgetPolicy{
			MaxConcurrentPerCluster:           4,
			MaxBackgroundConcurrentPerCluster: 2,
			LongRunNoticeSec:                  2,
			TransientRetries:                  3,
		},
		Dashboard: DashboardPolicy{
			RefreshSec:               10,
			UseCachedTotalsOnly:      true,
			RestartElevatedThreshold: 3,
			SignalLimit:              10,
		},
		Metrics: MetricsPolicy{
			Enabled:               true,
			PodMetricsTTLSeconds:  30,
			NodeMetricsTTLSeconds: 30,
			ContainerNearLimitPct: 90,
			NodePressurePct:       85,
		},
		Signals: SignalsPolicy{
			LongRunningJobSec:         int(signalLongRunningJobDuration.Seconds()),
			CronJobNoRecentSuccessSec: int(signalCronJobNoSuccessDuration.Seconds()),
			StaleHelmReleaseSec:       int(signalStaleHelmReleaseDuration.Seconds()),
			UnusedResourceAgeSec:      int(signalUnusedResourceAgeDuration.Seconds()),
			PodYoungRestartWindowSec:  int(signalPodYoungRestartDuration.Seconds()),
			DeploymentUnavailableSec:  int(signalDeploymentUnavailableDuration.Seconds()),
			QuotaWarnPercent:          int(quotaWarnRatio * 100),
			QuotaCriticalPercent:      int(quotaCritRatio * 100),
			Detectors: SignalDetectorsPolicy{
				PodRestarts: SignalPodRestartDetectorPolicy{
					RestartCount: 3,
				},
				ContainerNearLimit: SignalPercentDetectorPolicy{
					Percent: 90,
				},
				NodeResourcePressure: SignalPercentDetectorPolicy{
					Percent: 85,
				},
				ResourceQuotaPressure: SignalResourceQuotaDetectorPolicy{
					WarnPercent:     int(quotaWarnRatio * 100),
					CriticalPercent: int(quotaCritRatio * 100),
				},
			},
		},
	}
}

func DefaultDataplanePolicyBundle() DataplanePolicyBundle {
	return DataplanePolicyBundle{
		Version: "v1",
		Global:  DefaultDataplanePolicy(),
	}
}

func ValidateDataplanePolicy(in DataplanePolicy) DataplanePolicy {
	def := DefaultDataplanePolicy()
	if in.Profile == "" && in.Snapshots.TTLSeconds == nil {
		return def
	}
	out := CloneDataplanePolicy(in)
	switch out.Profile {
	case DataplaneProfileManual, DataplaneProfileFocused, DataplaneProfileBalanced, DataplaneProfileWide, DataplaneProfileDiagnostic:
	default:
		out.Profile = def.Profile
	}

	if out.Snapshots.TTLSeconds == nil {
		out.Snapshots.TTLSeconds = map[string]int{}
	}
	for k, v := range def.Snapshots.TTLSeconds {
		out.Snapshots.TTLSeconds[k] = clampInt(out.Snapshots.TTLSeconds[k], 5, 3600, v)
	}
	out.Persistence.MaxAgeHours = clampInt(out.Persistence.MaxAgeHours, 1, 720, def.Persistence.MaxAgeHours)

	out.Observers.NamespacesIntervalSec = clampInt(out.Observers.NamespacesIntervalSec, 10, 3600, def.Observers.NamespacesIntervalSec)
	out.Observers.NodesIntervalSec = clampInt(out.Observers.NodesIntervalSec, 10, 3600, def.Observers.NodesIntervalSec)
	out.Observers.NodesBackoffMaxSec = clampInt(out.Observers.NodesBackoffMaxSec, 30, 3600, def.Observers.NodesBackoffMaxSec)

	ne := &out.NamespaceEnrichment
	ne.RecentLimit = clampInt(ne.RecentLimit, 0, 200, def.NamespaceEnrichment.RecentLimit)
	ne.FavouriteLimit = clampInt(ne.FavouriteLimit, 0, 200, def.NamespaceEnrichment.FavouriteLimit)
	ne.MaxTargets = clampInt(ne.MaxTargets, 0, 250, def.NamespaceEnrichment.MaxTargets)
	ne.MaxParallel = clampInt(ne.MaxParallel, 1, 8, def.NamespaceEnrichment.MaxParallel)
	ne.IdleQuietMs = clampInt(ne.IdleQuietMs, 0, 60000, def.NamespaceEnrichment.IdleQuietMs)
	ne.WarmResourceKinds = normalizeNamespaceWarmResourceKinds(ne.WarmResourceKinds, def.NamespaceEnrichment.WarmResourceKinds)
	ne.PollMs = clampInt(ne.PollMs, 500, 60000, def.NamespaceEnrichment.PollMs)

	ne.Sweep.IdleQuietMs = clampInt(ne.Sweep.IdleQuietMs, 5000, 300000, def.NamespaceEnrichment.Sweep.IdleQuietMs)
	ne.Sweep.MaxNamespacesPerCycle = clampInt(ne.Sweep.MaxNamespacesPerCycle, 1, 25, def.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle)
	ne.Sweep.MaxNamespacesPerHour = clampInt(ne.Sweep.MaxNamespacesPerHour, 1, 500, def.NamespaceEnrichment.Sweep.MaxNamespacesPerHour)
	ne.Sweep.MinReenrichIntervalMinutes = clampInt(ne.Sweep.MinReenrichIntervalMinutes, 5, 1440, def.NamespaceEnrichment.Sweep.MinReenrichIntervalMinutes)
	ne.Sweep.MaxParallel = clampInt(ne.Sweep.MaxParallel, 1, 4, def.NamespaceEnrichment.Sweep.MaxParallel)

	out.BackgroundBudget.MaxConcurrentPerCluster = clampInt(out.BackgroundBudget.MaxConcurrentPerCluster, 1, 16, def.BackgroundBudget.MaxConcurrentPerCluster)
	out.BackgroundBudget.MaxBackgroundConcurrentPerCluster = clampInt(out.BackgroundBudget.MaxBackgroundConcurrentPerCluster, 1, out.BackgroundBudget.MaxConcurrentPerCluster, def.BackgroundBudget.MaxBackgroundConcurrentPerCluster)
	out.BackgroundBudget.LongRunNoticeSec = clampInt(out.BackgroundBudget.LongRunNoticeSec, 0, 300, def.BackgroundBudget.LongRunNoticeSec)
	out.BackgroundBudget.TransientRetries = clampInt(out.BackgroundBudget.TransientRetries, 1, 6, def.BackgroundBudget.TransientRetries)

	out.Dashboard.RefreshSec = clampInt(out.Dashboard.RefreshSec, 0, 3600, def.Dashboard.RefreshSec)
	out.Dashboard.RestartElevatedThreshold = clampInt(out.Dashboard.RestartElevatedThreshold, 1, 1000, def.Dashboard.RestartElevatedThreshold)
	out.Dashboard.SignalLimit = clampInt(out.Dashboard.SignalLimit, 1, 100, def.Dashboard.SignalLimit)

	out.Metrics.PodMetricsTTLSeconds = clampInt(out.Metrics.PodMetricsTTLSeconds, 15, 300, def.Metrics.PodMetricsTTLSeconds)
	out.Metrics.NodeMetricsTTLSeconds = clampInt(out.Metrics.NodeMetricsTTLSeconds, 15, 300, def.Metrics.NodeMetricsTTLSeconds)
	out.Metrics.ContainerNearLimitPct = clampInt(out.Metrics.ContainerNearLimitPct, 50, 100, def.Metrics.ContainerNearLimitPct)
	out.Metrics.NodePressurePct = clampInt(out.Metrics.NodePressurePct, 50, 100, def.Metrics.NodePressurePct)

	// Backward compatibility: allow legacy dashboard/metrics/signal fields and
	// migrate them into detector-specific signal config if detector values are missing.
	if out.Signals.Detectors.PodRestarts.RestartCount <= 0 {
		out.Signals.Detectors.PodRestarts.RestartCount = out.Dashboard.RestartElevatedThreshold
	}
	if out.Signals.Detectors.ContainerNearLimit.Percent <= 0 {
		out.Signals.Detectors.ContainerNearLimit.Percent = out.Metrics.ContainerNearLimitPct
	}
	if out.Signals.Detectors.NodeResourcePressure.Percent <= 0 {
		out.Signals.Detectors.NodeResourcePressure.Percent = out.Metrics.NodePressurePct
	}
	if out.Signals.Detectors.ResourceQuotaPressure.WarnPercent <= 0 {
		out.Signals.Detectors.ResourceQuotaPressure.WarnPercent = out.Signals.QuotaWarnPercent
	}
	if out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent <= 0 {
		out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent = out.Signals.QuotaCriticalPercent
	}

	out.Signals.Detectors.PodRestarts.RestartCount = clampInt(out.Signals.Detectors.PodRestarts.RestartCount, 1, 1000, def.Signals.Detectors.PodRestarts.RestartCount)
	out.Signals.Detectors.ContainerNearLimit.Percent = clampInt(out.Signals.Detectors.ContainerNearLimit.Percent, 50, 100, def.Signals.Detectors.ContainerNearLimit.Percent)
	out.Signals.Detectors.NodeResourcePressure.Percent = clampInt(out.Signals.Detectors.NodeResourcePressure.Percent, 50, 100, def.Signals.Detectors.NodeResourcePressure.Percent)
	out.Signals.Detectors.ResourceQuotaPressure.WarnPercent = clampInt(out.Signals.Detectors.ResourceQuotaPressure.WarnPercent, 1, 99, def.Signals.Detectors.ResourceQuotaPressure.WarnPercent)
	out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent = clampInt(out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent, 1, 100, def.Signals.Detectors.ResourceQuotaPressure.CriticalPercent)
	if out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent <= out.Signals.Detectors.ResourceQuotaPressure.WarnPercent {
		out.Signals.Detectors.ResourceQuotaPressure.WarnPercent = def.Signals.Detectors.ResourceQuotaPressure.WarnPercent
		out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent = def.Signals.Detectors.ResourceQuotaPressure.CriticalPercent
	}

	// Keep deprecated fields mirrored for compatibility with older clients.
	out.Dashboard.RestartElevatedThreshold = out.Signals.Detectors.PodRestarts.RestartCount
	out.Metrics.ContainerNearLimitPct = out.Signals.Detectors.ContainerNearLimit.Percent
	out.Metrics.NodePressurePct = out.Signals.Detectors.NodeResourcePressure.Percent
	out.Signals.QuotaWarnPercent = out.Signals.Detectors.ResourceQuotaPressure.WarnPercent
	out.Signals.QuotaCriticalPercent = out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent

	out.Signals.LongRunningJobSec = clampInt(out.Signals.LongRunningJobSec, 60, 604800, def.Signals.LongRunningJobSec)
	out.Signals.CronJobNoRecentSuccessSec = clampInt(out.Signals.CronJobNoRecentSuccessSec, 300, 2592000, def.Signals.CronJobNoRecentSuccessSec)
	out.Signals.StaleHelmReleaseSec = clampInt(out.Signals.StaleHelmReleaseSec, 60, 86400, def.Signals.StaleHelmReleaseSec)
	out.Signals.UnusedResourceAgeSec = clampInt(out.Signals.UnusedResourceAgeSec, 300, 2592000, def.Signals.UnusedResourceAgeSec)
	out.Signals.PodYoungRestartWindowSec = clampInt(out.Signals.PodYoungRestartWindowSec, 60, 86400, def.Signals.PodYoungRestartWindowSec)
	out.Signals.DeploymentUnavailableSec = clampInt(out.Signals.DeploymentUnavailableSec, 60, 86400, def.Signals.DeploymentUnavailableSec)
	out.Signals.QuotaWarnPercent = clampInt(out.Signals.QuotaWarnPercent, 1, 99, def.Signals.QuotaWarnPercent)
	out.Signals.QuotaCriticalPercent = clampInt(out.Signals.QuotaCriticalPercent, 1, 100, def.Signals.QuotaCriticalPercent)
	if out.Signals.QuotaCriticalPercent <= out.Signals.QuotaWarnPercent {
		out.Signals.QuotaWarnPercent = def.Signals.QuotaWarnPercent
		out.Signals.QuotaCriticalPercent = def.Signals.QuotaCriticalPercent
	}
	out.Signals.Overrides = normalizeSignalOverrides(out.Signals.Overrides)
	out.Signals.ContextOverrides = normalizeContextSignalOverrides(out.Signals.ContextOverrides)
	// Mirror the validated metrics TTLs into the snapshot TTL map so
	// SnapshotTTL(ResourceKindPodMetrics/NodeMetrics) agrees with the
	// operator-facing Metrics knobs in a single place.
	out.Snapshots.TTLSeconds[string(ResourceKindPodMetrics)] = out.Metrics.PodMetricsTTLSeconds
	out.Snapshots.TTLSeconds[string(ResourceKindNodeMetrics)] = out.Metrics.NodeMetricsTTLSeconds

	if out.Profile == DataplaneProfileManual {
		out.Observers.Enabled = false
		out.NamespaceEnrichment.Enabled = false
		out.NamespaceEnrichment.Sweep.Enabled = false
	}

	return out
}

func ValidateDataplanePolicyBundle(in DataplanePolicyBundle) DataplanePolicyBundle {
	def := DefaultDataplanePolicyBundle()
	out := CloneDataplanePolicyBundle(in)
	if strings.TrimSpace(out.Version) == "" {
		out.Version = def.Version
	}
	out.Global = ValidateDataplanePolicy(out.Global)
	if len(out.ContextOverrides) == 0 {
		out.ContextOverrides = nil
		return out
	}
	next := make(map[string]DataplanePolicyOverride, len(out.ContextOverrides))
	for rawContext, override := range out.ContextOverrides {
		contextName := strings.TrimSpace(rawContext)
		if contextName == "" {
			continue
		}
		resolved := applyDataplanePolicyOverride(out.Global, override)
		if reflect.DeepEqual(resolved, out.Global) {
			continue
		}
		next[contextName] = override
	}
	if len(next) == 0 {
		out.ContextOverrides = nil
		return out
	}
	out.ContextOverrides = next
	return out
}

func (b DataplanePolicyBundle) EffectivePolicy(contextName string) DataplanePolicy {
	valid := ValidateDataplanePolicyBundle(b)
	contextName = strings.TrimSpace(contextName)
	if contextName == "" {
		return valid.Global
	}
	override, ok := valid.ContextOverrides[contextName]
	if !ok {
		return valid.Global
	}
	return applyDataplanePolicyOverride(valid.Global, override)
}

func CloneDataplanePolicy(in DataplanePolicy) DataplanePolicy {
	out := in
	out.Snapshots.TTLSeconds = cloneStringIntMap(in.Snapshots.TTLSeconds)
	out.NamespaceEnrichment.WarmResourceKinds = append([]string(nil), in.NamespaceEnrichment.WarmResourceKinds...)
	out.Signals.Overrides = cloneSignalOverrideMap(in.Signals.Overrides)
	out.Signals.ContextOverrides = cloneContextSignalOverrideMap(in.Signals.ContextOverrides)
	return out
}

func CloneDataplanePolicyBundle(in DataplanePolicyBundle) DataplanePolicyBundle {
	out := DataplanePolicyBundle{
		Version: in.Version,
		Global:  CloneDataplanePolicy(in.Global),
	}
	if len(in.ContextOverrides) > 0 {
		out.ContextOverrides = make(map[string]DataplanePolicyOverride, len(in.ContextOverrides))
		for k, v := range in.ContextOverrides {
			out.ContextOverrides[k] = v
		}
	}
	return out
}

func applyDataplanePolicyOverride(global DataplanePolicy, override DataplanePolicyOverride) DataplanePolicy {
	out := CloneDataplanePolicy(global)
	if override.Profile != nil {
		out.Profile = *override.Profile
	}
	if ov := override.Snapshots; ov != nil {
		if ov.TTLSeconds != nil {
			if out.Snapshots.TTLSeconds == nil {
				out.Snapshots.TTLSeconds = map[string]int{}
			}
			for k, v := range ov.TTLSeconds {
				if v == nil {
					delete(out.Snapshots.TTLSeconds, k)
					continue
				}
				out.Snapshots.TTLSeconds[k] = *v
			}
		}
		if ov.ManualRefreshBypassesTTL != nil {
			out.Snapshots.ManualRefreshBypassesTTL = *ov.ManualRefreshBypassesTTL
		}
		if ov.InvalidateAfterKnownWrites != nil {
			out.Snapshots.InvalidateAfterKnownWrites = *ov.InvalidateAfterKnownWrites
		}
	}
	if ov := override.Observers; ov != nil {
		if ov.Enabled != nil {
			out.Observers.Enabled = *ov.Enabled
		}
		if ov.NamespacesEnabled != nil {
			out.Observers.NamespacesEnabled = *ov.NamespacesEnabled
		}
		if ov.NamespacesIntervalSec != nil {
			out.Observers.NamespacesIntervalSec = *ov.NamespacesIntervalSec
		}
		if ov.NodesEnabled != nil {
			out.Observers.NodesEnabled = *ov.NodesEnabled
		}
		if ov.NodesIntervalSec != nil {
			out.Observers.NodesIntervalSec = *ov.NodesIntervalSec
		}
		if ov.NodesBackoffMaxSec != nil {
			out.Observers.NodesBackoffMaxSec = *ov.NodesBackoffMaxSec
		}
	}
	if ov := override.NamespaceEnrichment; ov != nil {
		if ov.Enabled != nil {
			out.NamespaceEnrichment.Enabled = *ov.Enabled
		}
		if ov.IncludeFocus != nil {
			out.NamespaceEnrichment.IncludeFocus = *ov.IncludeFocus
		}
		if ov.IncludeRecent != nil {
			out.NamespaceEnrichment.IncludeRecent = *ov.IncludeRecent
		}
		if ov.RecentLimit != nil {
			out.NamespaceEnrichment.RecentLimit = *ov.RecentLimit
		}
		if ov.IncludeFavourites != nil {
			out.NamespaceEnrichment.IncludeFavourites = *ov.IncludeFavourites
		}
		if ov.FavouriteLimit != nil {
			out.NamespaceEnrichment.FavouriteLimit = *ov.FavouriteLimit
		}
		if ov.MaxTargets != nil {
			out.NamespaceEnrichment.MaxTargets = *ov.MaxTargets
		}
		if ov.MaxParallel != nil {
			out.NamespaceEnrichment.MaxParallel = *ov.MaxParallel
		}
		if ov.IdleQuietMs != nil {
			out.NamespaceEnrichment.IdleQuietMs = *ov.IdleQuietMs
		}
		if ov.EnrichDetails != nil {
			out.NamespaceEnrichment.EnrichDetails = *ov.EnrichDetails
		}
		if ov.EnrichPods != nil {
			out.NamespaceEnrichment.EnrichPods = *ov.EnrichPods
		}
		if ov.EnrichDeployments != nil {
			out.NamespaceEnrichment.EnrichDeployments = *ov.EnrichDeployments
		}
		if ov.WarmResourceKinds != nil {
			out.NamespaceEnrichment.WarmResourceKinds = append([]string(nil), (*ov.WarmResourceKinds)...)
		}
		if ov.PollMs != nil {
			out.NamespaceEnrichment.PollMs = *ov.PollMs
		}
		if ov.Sweep != nil {
			if ov.Sweep.Enabled != nil {
				out.NamespaceEnrichment.Sweep.Enabled = *ov.Sweep.Enabled
			}
			if ov.Sweep.IdleQuietMs != nil {
				out.NamespaceEnrichment.Sweep.IdleQuietMs = *ov.Sweep.IdleQuietMs
			}
			if ov.Sweep.MaxNamespacesPerCycle != nil {
				out.NamespaceEnrichment.Sweep.MaxNamespacesPerCycle = *ov.Sweep.MaxNamespacesPerCycle
			}
			if ov.Sweep.MaxNamespacesPerHour != nil {
				out.NamespaceEnrichment.Sweep.MaxNamespacesPerHour = *ov.Sweep.MaxNamespacesPerHour
			}
			if ov.Sweep.MinReenrichIntervalMinutes != nil {
				out.NamespaceEnrichment.Sweep.MinReenrichIntervalMinutes = *ov.Sweep.MinReenrichIntervalMinutes
			}
			if ov.Sweep.MaxParallel != nil {
				out.NamespaceEnrichment.Sweep.MaxParallel = *ov.Sweep.MaxParallel
			}
			if ov.Sweep.PauseOnUserActivity != nil {
				out.NamespaceEnrichment.Sweep.PauseOnUserActivity = *ov.Sweep.PauseOnUserActivity
			}
			if ov.Sweep.PauseWhenSchedulerBusy != nil {
				out.NamespaceEnrichment.Sweep.PauseWhenSchedulerBusy = *ov.Sweep.PauseWhenSchedulerBusy
			}
			if ov.Sweep.PauseOnRateLimitOrConnectivity != nil {
				out.NamespaceEnrichment.Sweep.PauseOnRateLimitOrConnectivity = *ov.Sweep.PauseOnRateLimitOrConnectivity
			}
			if ov.Sweep.IncludeSystemNamespaces != nil {
				out.NamespaceEnrichment.Sweep.IncludeSystemNamespaces = *ov.Sweep.IncludeSystemNamespaces
			}
		}
	}
	if ov := override.BackgroundBudget; ov != nil {
		if ov.MaxConcurrentPerCluster != nil {
			out.BackgroundBudget.MaxConcurrentPerCluster = *ov.MaxConcurrentPerCluster
		}
		if ov.MaxBackgroundConcurrentPerCluster != nil {
			out.BackgroundBudget.MaxBackgroundConcurrentPerCluster = *ov.MaxBackgroundConcurrentPerCluster
		}
		if ov.LongRunNoticeSec != nil {
			out.BackgroundBudget.LongRunNoticeSec = *ov.LongRunNoticeSec
		}
		if ov.TransientRetries != nil {
			out.BackgroundBudget.TransientRetries = *ov.TransientRetries
		}
	}
	if ov := override.Metrics; ov != nil {
		if ov.Enabled != nil {
			out.Metrics.Enabled = *ov.Enabled
		}
		if ov.PodMetricsTTLSeconds != nil {
			out.Metrics.PodMetricsTTLSeconds = *ov.PodMetricsTTLSeconds
		}
		if ov.NodeMetricsTTLSeconds != nil {
			out.Metrics.NodeMetricsTTLSeconds = *ov.NodeMetricsTTLSeconds
		}
		if ov.ContainerNearLimitPct != nil {
			out.Metrics.ContainerNearLimitPct = *ov.ContainerNearLimitPct
		}
		if ov.NodePressurePct != nil {
			out.Metrics.NodePressurePct = *ov.NodePressurePct
		}
	}
	if ov := override.Signals; ov != nil {
		if ov.LongRunningJobSec != nil {
			out.Signals.LongRunningJobSec = *ov.LongRunningJobSec
		}
		if ov.CronJobNoRecentSuccessSec != nil {
			out.Signals.CronJobNoRecentSuccessSec = *ov.CronJobNoRecentSuccessSec
		}
		if ov.StaleHelmReleaseSec != nil {
			out.Signals.StaleHelmReleaseSec = *ov.StaleHelmReleaseSec
		}
		if ov.UnusedResourceAgeSec != nil {
			out.Signals.UnusedResourceAgeSec = *ov.UnusedResourceAgeSec
		}
		if ov.PodYoungRestartWindowSec != nil {
			out.Signals.PodYoungRestartWindowSec = *ov.PodYoungRestartWindowSec
		}
		if ov.DeploymentUnavailableSec != nil {
			out.Signals.DeploymentUnavailableSec = *ov.DeploymentUnavailableSec
		}
		if ov.QuotaWarnPercent != nil {
			out.Signals.QuotaWarnPercent = *ov.QuotaWarnPercent
		}
		if ov.QuotaCriticalPercent != nil {
			out.Signals.QuotaCriticalPercent = *ov.QuotaCriticalPercent
		}
		if ov.Detectors != nil {
			if ov.Detectors.PodRestarts != nil && ov.Detectors.PodRestarts.RestartCount != nil {
				out.Signals.Detectors.PodRestarts.RestartCount = *ov.Detectors.PodRestarts.RestartCount
			}
			if ov.Detectors.ContainerNearLimit != nil && ov.Detectors.ContainerNearLimit.Percent != nil {
				out.Signals.Detectors.ContainerNearLimit.Percent = *ov.Detectors.ContainerNearLimit.Percent
			}
			if ov.Detectors.NodeResourcePressure != nil && ov.Detectors.NodeResourcePressure.Percent != nil {
				out.Signals.Detectors.NodeResourcePressure.Percent = *ov.Detectors.NodeResourcePressure.Percent
			}
			if ov.Detectors.ResourceQuotaPressure != nil {
				if ov.Detectors.ResourceQuotaPressure.WarnPercent != nil {
					out.Signals.Detectors.ResourceQuotaPressure.WarnPercent = *ov.Detectors.ResourceQuotaPressure.WarnPercent
				}
				if ov.Detectors.ResourceQuotaPressure.CriticalPercent != nil {
					out.Signals.Detectors.ResourceQuotaPressure.CriticalPercent = *ov.Detectors.ResourceQuotaPressure.CriticalPercent
				}
			}
		}
		if ov.Overrides != nil {
			out.Signals.Overrides = cloneSignalOverrideMap(ov.Overrides)
		}
		if ov.ContextOverrides != nil {
			out.Signals.ContextOverrides = cloneContextSignalOverrideMap(ov.ContextOverrides)
		}
	}
	if ov := override.Persistence; ov != nil {
		if ov.Enabled != nil {
			out.Persistence.Enabled = *ov.Enabled
		}
		if ov.MaxAgeHours != nil {
			out.Persistence.MaxAgeHours = *ov.MaxAgeHours
		}
	}
	return ValidateDataplanePolicy(out)
}

func cloneStringIntMap(in map[string]int) map[string]int {
	if in == nil {
		return nil
	}
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func normalizeNamespaceWarmResourceKinds(in []string, fallback []string) []string {
	allowed := map[string]struct{}{}
	for _, kind := range dataplaneNamespacedListResourceKinds() {
		allowed[string(kind)] = struct{}{}
	}
	out := make([]string, 0, len(in))
	seen := map[string]struct{}{}
	for _, raw := range in {
		kind := string(ResourceKind(raw))
		if _, ok := allowed[kind]; !ok {
			continue
		}
		if _, ok := seen[kind]; ok {
			continue
		}
		seen[kind] = struct{}{}
		out = append(out, kind)
	}
	if len(out) == 0 {
		return append([]string(nil), fallback...)
	}
	return out
}

func (p DataplanePolicy) SnapshotTTL(kind ResourceKind) time.Duration {
	def := DefaultDataplanePolicy()
	secs := p.Snapshots.TTLSeconds[string(kind)]
	if secs <= 0 {
		secs = def.Snapshots.TTLSeconds[string(kind)]
	}
	if secs <= 0 {
		secs = 15
	}
	return time.Duration(secs) * time.Second
}

func (p DataplanePolicy) PersistenceMaxAge() time.Duration {
	def := DefaultDataplanePolicy()
	hours := p.Persistence.MaxAgeHours
	if hours <= 0 {
		hours = def.Persistence.MaxAgeHours
	}
	return time.Duration(hours) * time.Hour
}

func clampInt(value, min, max, fallback int) int {
	if value < min || value > max {
		return fallback
	}
	return value
}

func normalizeSignalOverrides(in map[string]SignalOverride) map[string]SignalOverride {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]SignalOverride, len(in))
	for rawType, raw := range in {
		signalType := dashboardSignalTypeKey(rawType)
		if signalType == "" || !knownDashboardSignalType(signalType) {
			continue
		}
		override := normalizeSignalOverride(raw)
		if signalOverrideEmpty(override) {
			continue
		}
		out[signalType] = override
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeContextSignalOverrides(in map[string]map[string]SignalOverride) map[string]map[string]SignalOverride {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]map[string]SignalOverride, len(in))
	for rawContext, rawOverrides := range in {
		contextName := strings.TrimSpace(rawContext)
		if contextName == "" {
			continue
		}
		overrides := normalizeSignalOverrides(rawOverrides)
		if len(overrides) == 0 {
			continue
		}
		out[contextName] = overrides
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeSignalOverride(in SignalOverride) SignalOverride {
	out := SignalOverride{
		Enabled: in.Enabled,
	}
	if isSignalSeverityOverride(in.Severity) {
		out.Severity = in.Severity
	}
	if in.Priority != nil {
		p := clampInt(*in.Priority, 0, 100, 10)
		out.Priority = &p
	}
	return out
}

func signalOverrideEmpty(in SignalOverride) bool {
	return in.Enabled == nil && in.Severity == "" && in.Priority == nil
}

func cloneSignalOverrideMap(in map[string]SignalOverride) map[string]SignalOverride {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]SignalOverride, len(in))
	for k, v := range in {
		out[k] = cloneSignalOverride(v)
	}
	return out
}

func cloneContextSignalOverrideMap(in map[string]map[string]SignalOverride) map[string]map[string]SignalOverride {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]map[string]SignalOverride, len(in))
	for k, v := range in {
		out[k] = cloneSignalOverrideMap(v)
	}
	return out
}

func cloneSignalOverride(in SignalOverride) SignalOverride {
	out := in
	if in.Enabled != nil {
		v := *in.Enabled
		out.Enabled = &v
	}
	if in.Priority != nil {
		v := *in.Priority
		out.Priority = &v
	}
	return out
}
