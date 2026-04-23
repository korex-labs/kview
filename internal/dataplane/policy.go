package dataplane

import "time"

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

// MetricsPolicy governs metrics.k8s.io integration. Enabled is a soft gate
// (capability detection auto-disables metric widgets when Installed is false);
// the TTLs control per-cluster sampling frequency; the threshold percents
// drive usage-based signal detectors. All values have validation clamps that
// pin them inside operator-sensible bounds and fall back to the defaults.
type MetricsPolicy struct {
	Enabled               bool `json:"enabled"`
	PodMetricsTTLSeconds  int  `json:"podMetricsTtlSec"`
	NodeMetricsTTLSeconds int  `json:"nodeMetricsTtlSec"`
	ContainerNearLimitPct int  `json:"containerNearLimitPct"`
	NodePressurePct       int  `json:"nodePressurePct"`
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
	QuotaWarnPercent          int `json:"quotaWarnPercent"`
	QuotaCriticalPercent      int `json:"quotaCriticalPercent"`
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
		},
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

func CloneDataplanePolicy(in DataplanePolicy) DataplanePolicy {
	out := in
	out.Snapshots.TTLSeconds = cloneStringIntMap(in.Snapshots.TTLSeconds)
	out.NamespaceEnrichment.WarmResourceKinds = append([]string(nil), in.NamespaceEnrichment.WarmResourceKinds...)
	return out
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
