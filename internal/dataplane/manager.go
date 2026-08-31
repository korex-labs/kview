package dataplane

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	crbindings "github.com/korex-labs/kview/v5/internal/kube/resource/clusterrolebindings"
	clusterroles "github.com/korex-labs/kview/v5/internal/kube/resource/clusterroles"
	configmaps "github.com/korex-labs/kview/v5/internal/kube/resource/configmaps"
	cronjobs "github.com/korex-labs/kview/v5/internal/kube/resource/cronjobs"
	crds "github.com/korex-labs/kview/v5/internal/kube/resource/customresourcedefinitions"
	daemonsets "github.com/korex-labs/kview/v5/internal/kube/resource/daemonsets"
	deployments "github.com/korex-labs/kview/v5/internal/kube/resource/deployments"
	kubehelm "github.com/korex-labs/kview/v5/internal/kube/resource/helm"
	hpas "github.com/korex-labs/kview/v5/internal/kube/resource/horizontalpodautoscalers"
	ingresses "github.com/korex-labs/kview/v5/internal/kube/resource/ingresses"
	jobs "github.com/korex-labs/kview/v5/internal/kube/resource/jobs"
	limitranges "github.com/korex-labs/kview/v5/internal/kube/resource/limitranges"
	kubemetrics "github.com/korex-labs/kview/v5/internal/kube/resource/metrics"
	namespaces "github.com/korex-labs/kview/v5/internal/kube/resource/namespaces"
	networkpolicies "github.com/korex-labs/kview/v5/internal/kube/resource/networkpolicies"
	nodes "github.com/korex-labs/kview/v5/internal/kube/resource/nodes"
	pvcs "github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumeclaims"
	pvs "github.com/korex-labs/kview/v5/internal/kube/resource/persistentvolumes"
	pods "github.com/korex-labs/kview/v5/internal/kube/resource/pods"
	replicasets "github.com/korex-labs/kview/v5/internal/kube/resource/replicasets"
	rquotas "github.com/korex-labs/kview/v5/internal/kube/resource/resourcequotas"
	rolebindings "github.com/korex-labs/kview/v5/internal/kube/resource/rolebindings"
	roles "github.com/korex-labs/kview/v5/internal/kube/resource/roles"
	secrets "github.com/korex-labs/kview/v5/internal/kube/resource/secrets"
	serviceaccounts "github.com/korex-labs/kview/v5/internal/kube/resource/serviceaccounts"
	svcs "github.com/korex-labs/kview/v5/internal/kube/resource/services"
	statefulsets "github.com/korex-labs/kview/v5/internal/kube/resource/statefulsets"
	"github.com/korex-labs/kview/v5/internal/runtime"
)

// ClusterPlane represents the per-cluster read-side data plane boundary.
// It owns observers, projections, and capability registries for a single cluster.
type ClusterPlane interface {
	// ClusterName is the underlying logical cluster/context name.
	ClusterName() string

	// Profile is the current data plane behavior profile for this cluster.
	Profile() Profile

	// DiscoveryMode returns the active discovery mode for this plane.
	DiscoveryMode() DiscoveryMode

	// Scope returns the current observation scope configuration.
	Scope() ObservationScope

	// Health returns the current coarse health of the plane.
	Health() PlaneHealth

	// ResourceMap projects a bounded relationship graph from cache cells only.
	ResourceMap(req ResourceMapRequest) (ResourceMapResponse, error)
}

// DataPlaneManager is the top-level entrypoint for read-side data planes.
// It is responsible for:
//   - constructing per-cluster planes
//   - tracking their lifecycles
//   - exposing high-level plane metadata to other subsystems
type DataPlaneManager interface {
	// PlaneForCluster returns (and lazily creates) a ClusterPlane for the given cluster context name.
	PlaneForCluster(ctx context.Context, clusterName string) (ClusterPlane, error)

	// DefaultProfile reports the system-wide default profile.
	DefaultProfile() Profile

	// DefaultDiscoveryMode reports the system-wide default discovery mode.
	DefaultDiscoveryMode() DiscoveryMode

	// NamespacesSnapshot returns a raw snapshot for namespaces in the given cluster.
	NamespacesSnapshot(ctx context.Context, clusterName string) (NamespaceSnapshot, error)
	// NoteUserActivity marks UI/API interaction so background namespace enrichment can wait for idle.
	NoteUserActivity()
	// BeginNamespaceListProgressiveEnrichment starts scored, idle-gated enrichment for list rows.
	BeginNamespaceListProgressiveEnrichment(clusterName string, items []dto.NamespaceListItemDTO, hints NamespaceEnrichHints) uint64
	// NamespaceListEnrichmentPoll returns merged rows for a revision (GET /api/namespaces/enrichment).
	NamespaceListEnrichmentPoll(clusterName string, revision uint64) NamespaceListEnrichmentPoll
	// NamespaceListEnrichmentPollSince returns only rows changed after the provided sequence.
	NamespaceListEnrichmentPollSince(clusterName string, revision uint64, sinceSeq uint64) NamespaceListEnrichmentPoll
	// MergeCachedNamespaceRowProjection overlays cached namespace row metrics onto list rows when available.
	MergeCachedNamespaceRowProjection(ctx context.Context, clusterName string, items []dto.NamespaceListItemDTO) ([]dto.NamespaceListItemDTO, int)
	// NodesSnapshot returns a raw snapshot for nodes in the given cluster.
	NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error)
	// DerivedNodesSnapshot returns a sparse node list inferred from cached pod snapshots only.
	DerivedNodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error)
	// DerivedNodeDetails returns sparse node details inferred from cached pod snapshots only.
	DerivedNodeDetails(ctx context.Context, clusterName, nodeName string) (dto.NodeDetailsDTO, bool, error)
	// PersistentVolumesSnapshot returns a raw snapshot for persistent volumes in the given cluster.
	PersistentVolumesSnapshot(ctx context.Context, clusterName string) (PersistentVolumesSnapshot, error)
	// ClusterRolesSnapshot returns a raw snapshot for cluster roles in the given cluster.
	ClusterRolesSnapshot(ctx context.Context, clusterName string) (ClusterRolesSnapshot, error)
	// ClusterRoleBindingsSnapshot returns a raw snapshot for cluster role bindings in the given cluster.
	ClusterRoleBindingsSnapshot(ctx context.Context, clusterName string) (ClusterRoleBindingsSnapshot, error)
	// CRDsSnapshot returns a raw snapshot for custom resource definitions in the given cluster.
	CRDsSnapshot(ctx context.Context, clusterName string) (CRDsSnapshot, error)
	// ClusterCustomResourcesSnapshot returns aggregated cluster-scoped custom resource instances.
	ClusterCustomResourcesSnapshot(ctx context.Context, clusterName string) (CustomResourcesSnapshot, error)
	// PodsSnapshot returns a raw snapshot for pods in the given namespace.
	PodsSnapshot(ctx context.Context, clusterName, namespace string) (PodsSnapshot, error)
	// CustomResourcesSnapshot returns aggregated namespaced custom resource instances.
	CustomResourcesSnapshot(ctx context.Context, clusterName, namespace string) (CustomResourcesSnapshot, error)
	// DeploymentsSnapshot returns a raw snapshot for deployments in the given namespace.
	DeploymentsSnapshot(ctx context.Context, clusterName, namespace string) (DeploymentsSnapshot, error)
	// ServicesSnapshot returns a raw snapshot for services in the given namespace.
	ServicesSnapshot(ctx context.Context, clusterName, namespace string) (ServicesSnapshot, error)
	// IngressesSnapshot returns a raw snapshot for ingresses in the given namespace.
	IngressesSnapshot(ctx context.Context, clusterName, namespace string) (IngressesSnapshot, error)
	// NetworkPoliciesSnapshot returns a raw snapshot for network policies in the given namespace.
	NetworkPoliciesSnapshot(ctx context.Context, clusterName, namespace string) (NetworkPoliciesSnapshot, error)
	// PVCsSnapshot returns a raw snapshot for PVCs in the given namespace.
	PVCsSnapshot(ctx context.Context, clusterName, namespace string) (PVCsSnapshot, error)
	// ConfigMapsSnapshot returns a raw snapshot for configmaps in the given namespace.
	ConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) (ConfigMapsSnapshot, error)
	// SecretsSnapshot returns a raw snapshot for secrets in the given namespace.
	SecretsSnapshot(ctx context.Context, clusterName, namespace string) (SecretsSnapshot, error)
	// ServiceAccountsSnapshot returns a raw snapshot for serviceaccounts in the given namespace.
	ServiceAccountsSnapshot(ctx context.Context, clusterName, namespace string) (ServiceAccountsSnapshot, error)
	// RolesSnapshot returns a raw snapshot for roles in the given namespace.
	RolesSnapshot(ctx context.Context, clusterName, namespace string) (RolesSnapshot, error)
	// RoleBindingsSnapshot returns a raw snapshot for rolebindings in the given namespace.
	RoleBindingsSnapshot(ctx context.Context, clusterName, namespace string) (RoleBindingsSnapshot, error)
	// HelmReleasesSnapshot returns a raw snapshot for Helm releases in the given namespace.
	HelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) (HelmReleasesSnapshot, error)
	// DerivedHelmChartsSnapshot returns sparse chart rows inferred from cached Helm release snapshots only.
	DerivedHelmChartsSnapshot(ctx context.Context, clusterName string) (Snapshot[dto.HelmChartDTO], error)
	// InvalidateHelmReleasesSnapshot drops the cached Helm release list for a namespace after a Helm mutation.
	InvalidateHelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateClusterCustomResourcesSnapshot drops the cached cluster-scoped custom resource list after a mutation.
	InvalidateClusterCustomResourcesSnapshot(ctx context.Context, clusterName string) error
	// InvalidateCustomResourcesSnapshot drops the cached namespaced custom resource list after a mutation.
	InvalidateCustomResourcesSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateDeploymentsSnapshot drops the cached Deployment list for a namespace after a live edit or mutation.
	InvalidateDeploymentsSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateConfigMapsSnapshot drops the cached ConfigMap list for a namespace after a live edit or mutation.
	InvalidateConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateServicesSnapshot drops the cached Service list for a namespace after a live edit or mutation.
	InvalidateServicesSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateSecretsSnapshot drops the cached Secret list for a namespace after a live edit or mutation.
	InvalidateSecretsSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateIngressesSnapshot drops the cached Ingress list for a namespace after a live edit or mutation.
	InvalidateIngressesSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateStatefulSetsSnapshot drops the cached StatefulSet list for a namespace after a live edit or mutation.
	InvalidateStatefulSetsSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateDaemonSetsSnapshot drops the cached DaemonSet list for a namespace after a live edit or mutation.
	InvalidateDaemonSetsSnapshot(ctx context.Context, clusterName, namespace string) error
	// InvalidateJobsSnapshot drops the cached Job list for a namespace after a Job mutation.
	InvalidateJobsSnapshot(ctx context.Context, clusterName, namespace string) error
	// DaemonSetsSnapshot returns a raw snapshot for daemonsets in the given namespace.
	DaemonSetsSnapshot(ctx context.Context, clusterName, namespace string) (DaemonSetsSnapshot, error)
	// StatefulSetsSnapshot returns a raw snapshot for statefulsets in the given namespace.
	StatefulSetsSnapshot(ctx context.Context, clusterName, namespace string) (StatefulSetsSnapshot, error)
	// ReplicaSetsSnapshot returns a raw snapshot for replicasets in the given namespace.
	ReplicaSetsSnapshot(ctx context.Context, clusterName, namespace string) (ReplicaSetsSnapshot, error)
	// JobsSnapshot returns a raw snapshot for jobs in the given namespace.
	JobsSnapshot(ctx context.Context, clusterName, namespace string) (JobsSnapshot, error)
	// CronJobsSnapshot returns a raw snapshot for cronjobs in the given namespace.
	CronJobsSnapshot(ctx context.Context, clusterName, namespace string) (CronJobsSnapshot, error)
	// HPAsSnapshot returns a raw snapshot for horizontal pod autoscalers in the given namespace.
	HPAsSnapshot(ctx context.Context, clusterName, namespace string) (HPAsSnapshot, error)
	// ResourceQuotasSnapshot returns a raw snapshot for resource quotas in the given namespace.
	ResourceQuotasSnapshot(ctx context.Context, clusterName, namespace string) (ResourceQuotasSnapshot, error)
	// LimitRangesSnapshot returns a raw snapshot for limit ranges in the given namespace.
	LimitRangesSnapshot(ctx context.Context, clusterName, namespace string) (LimitRangesSnapshot, error)
	// NodeMetricsSnapshot returns a cluster-scoped node usage snapshot from metrics.k8s.io (not persisted).
	// Triggers a live fetch via the scheduler when the cache is cold; intended for the
	// background metrics warmer and for dedicated /api/nodemetrics callers, NOT for the
	// pod/node list/detail enrichment path (use NodeMetricsCachedSnapshot for that).
	NodeMetricsSnapshot(ctx context.Context, clusterName string) (NodeMetricsSnapshot, error)
	// PodMetricsSnapshot returns a namespaced pod usage snapshot from metrics.k8s.io (not persisted).
	// Same fetching semantics as NodeMetricsSnapshot.
	PodMetricsSnapshot(ctx context.Context, clusterName, namespace string) (PodMetricsSnapshot, error)
	// NodeMetricsCachedSnapshot returns the most recent cached node metrics snapshot
	// without scheduling a fetch. Returns ok=false when no cache entry exists yet.
	// Use this from handler enrichment paths so a missing or RBAC-denied metrics-server
	// can never block the underlying list/detail response.
	NodeMetricsCachedSnapshot(clusterName string) (NodeMetricsSnapshot, bool)
	// PodMetricsCachedSnapshot returns the most recent cached pod metrics snapshot
	// for a namespace without scheduling a fetch. See NodeMetricsCachedSnapshot.
	PodMetricsCachedSnapshot(clusterName, namespace string) (PodMetricsSnapshot, bool)
	// MetricsCapability reports whether metrics.k8s.io is installed and list-allowed for the cluster.
	MetricsCapability(ctx context.Context, clusterName string) MetricsCapability

	// EnsureObservers makes sure observers are running for the given cluster.
	EnsureObservers(ctx context.Context, clusterName string)
	// WarmClusterBackground performs one low-priority background pass for a cluster.
	WarmClusterBackground(ctx context.Context, clusterName string) error

	// DashboardSummary returns the legacy combined dashboard projection.
	DashboardSummary(ctx context.Context, clusterName string, opts ClusterDashboardListOptions) ClusterDashboardSummary
	// DashboardSignalsSummary returns only signal-triage data and readiness metadata.
	DashboardSignalsSummary(ctx context.Context, clusterName string, opts ClusterDashboardListOptions) ClusterDashboardSignalsSummary
	// DashboardDataplaneSummary returns only dataplane diagnostics and resource totals.
	DashboardDataplaneSummary(ctx context.Context, clusterName string) ClusterDashboardDataplaneSummary

	// ListSnapshotRevision returns revision metadata for a list cell without scheduling kube fetches.
	ListSnapshotRevision(ctx context.Context, clusterName string, kind ResourceKind, namespace string) (ListSnapshotRevisionEnvelope, error)

	// NamespaceSummaryProjection builds namespace summary from dataplane snapshots (projection-led).
	NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error)
	// NamespaceInsightsProjection builds a namespace observability view from dataplane snapshots.
	NamespaceInsightsProjection(ctx context.Context, clusterName, namespace string) (NamespaceInsightsProjection, error)

	// ResourceSignals returns dataplane-derived signals attributed to a single resource (cache-only).
	// scope must be one of ResourceSignalsScopeNamespace / ResourceSignalsScopeCluster.
	// kind is the canonical Kubernetes kind (e.g. "Pod", "Deployment", "Node").
	ResourceSignals(ctx context.Context, clusterName, scope, namespace, kind, name string) (ResourceSignalsResult, error)
	// ResourceMap projects a bounded relationship graph from cache cells only.
	ResourceMap(clusterName string, req ResourceMapRequest) (ResourceMapResponse, error)
	// PreviewSignalExclusions evaluates draft rules against cached raw signal candidates without mutating policy or history.
	PreviewSignalExclusions(ctx context.Context, clusterName, signalType string, exclusions SignalExclusionSet) (SignalExclusionPreviewResult, error)
	// AcknowledgeSignal records local operator acknowledgement metadata for a stable signal history key.
	AcknowledgeSignal(clusterName string, req SignalAcknowledgementRequest) (SignalAcknowledgementRecord, error)
	// UnacknowledgeSignal removes local acknowledgement metadata for a stable signal history key.
	UnacknowledgeSignal(clusterName, historyKey string) error
	// ExportSignalAcknowledgements returns local signal acknowledgement metadata for a context.
	ExportSignalAcknowledgements(clusterName string) map[string]SignalAcknowledgementRecord
	// ImportSignalAcknowledgements merges local signal acknowledgement metadata for a context.
	ImportSignalAcknowledgements(clusterName string, incoming map[string]SignalAcknowledgementRecord, strategy string) (SignalAcknowledgementImportResult, error)
	SuppressSignal(clusterName string, req SignalSuppressionRequest) (SignalSuppressionRecord, error)
	UnsuppressSignal(clusterName, historyKey string) error
	ExportSignalSuppressions(clusterName string) map[string]SignalSuppressionRecord
	ImportSignalSuppressions(clusterName string, incoming map[string]SignalSuppressionRecord, strategy string) (SignalSuppressionImportResult, error)
	ResetSignalSuppressions(clusterName, historyKey string) (int, error)
	// ExportSignalHistory returns bounded local observation history for a context.
	ExportSignalHistory(clusterName string) map[string]SignalHistoryRecord
	// ImportSignalHistory merges bounded local observation history for a context.
	ImportSignalHistory(clusterName string, incoming map[string]SignalHistoryRecord, strategy string) (SignalHistoryImportResult, error)
	// ResetSignalHistory removes one signal identity or all history for a context.
	ResetSignalHistory(clusterName, historyKey string) (int, error)

	// Policy returns the current dataplane behavior policy.
	Policy() DataplanePolicy
	// PolicyBundle returns the current dataplane behavior bundle.
	PolicyBundle() DataplanePolicyBundle
	// EffectivePolicy returns context-aware policy with overrides applied.
	EffectivePolicy(contextName string) DataplanePolicy
	// SetPolicy updates the current dataplane behavior policy for existing and future planes.
	SetPolicy(policy DataplanePolicy) DataplanePolicy
	// SetPolicyBundle updates the current dataplane behavior bundle for existing and future planes.
	SetPolicyBundle(bundle DataplanePolicyBundle) DataplanePolicyBundle

	// SchedulerRunStats returns cumulative snapshot-run durations by priority and resource kind.
	SchedulerRunStats() SchedulerRunStatsSnapshot

	// SchedulerLiveWork returns running and queued snapshot scheduler work (for operator visibility).
	SchedulerLiveWork() SchedulerLiveWork

	// SearchCachedResources returns persisted dataplane name-index matches without live Kubernetes reads.
	SearchCachedResources(ctx context.Context, clusterName string, query string, limit int, offset int) (CachedResourceSearch, error)
	// PersistenceMigrationStatus reports latest local cache migration lifecycle details.
	PersistenceMigrationStatus() PersistenceMigrationStatus
}

type PersistenceMigrationPhase string

const (
	PersistenceMigrationPhaseIdle    PersistenceMigrationPhase = "idle"
	PersistenceMigrationPhaseRunning PersistenceMigrationPhase = "running"
	PersistenceMigrationPhaseDone    PersistenceMigrationPhase = "done"
	PersistenceMigrationPhaseFailed  PersistenceMigrationPhase = "failed"
)

type PersistenceMigrationStatus struct {
	Phase       PersistenceMigrationPhase `json:"phase"`
	FromVersion int                       `json:"fromVersion,omitempty"`
	ToVersion   int                       `json:"toVersion,omitempty"`
	Applied     bool                      `json:"applied"`
	Error       string                    `json:"error,omitempty"`
}

// ManagerConfig describes construction-time parameters for the data plane manager.
type ManagerConfig struct {
	ClusterManager *cluster.Manager

	Runtime runtime.RuntimeManager

	// Profile is the system-wide default profile. If empty, ProfileFocused is used.
	Profile Profile
	// DiscoveryMode is the system-wide default discovery mode. If empty, DiscoveryModeTargeted is used.
	DiscoveryMode DiscoveryMode

	// Policy controls TTLs, observers, enrichment, and background budgets.
	Policy DataplanePolicy
}

// ClientsProvider exposes per-context Kubernetes clients to the dataplane.
type ClientsProvider interface {
	GetClientsForContext(ctx context.Context, contextName string) (*cluster.Clients, string, error)
}

type managerClients struct {
	m *cluster.Manager
}

func (mc managerClients) GetClientsForContext(ctx context.Context, name string) (*cluster.Clients, string, error) {
	return mc.m.GetClientsForContext(ctx, name)
}

// manager is the foundational implementation of DataPlaneManager: per-cluster planes,
// scheduler-mediated snapshot reads, namespace summary projection, dashboard aggregate, and observers.
type manager struct {
	rt runtime.RuntimeManager

	defaultProfile       Profile
	defaultDiscoveryMode DiscoveryMode

	mu     sync.RWMutex
	planes map[string]*clusterPlane

	scheduler *workScheduler
	clients   ClientsProvider
	stats     *dataplaneSessionStats

	policyMu sync.RWMutex
	policy   DataplanePolicy
	bundle   DataplanePolicyBundle

	persistenceMu sync.RWMutex
	persistence   snapshotPersistence
	migration     PersistenceMigrationStatus

	signalHistoryMu sync.RWMutex
	signalHistory   map[string]map[string]SignalHistoryRecord
	signalAckMu     sync.RWMutex
	signalAck       map[string]map[string]SignalAcknowledgementRecord

	// Suppression lock order is prune barrier -> context operation lock -> map mutex.
	// Global prune holds the barrier exclusively and therefore skips context locks.
	// Persistence implementations must not call back into manager methods.
	signalSuppressionsPruneMu sync.RWMutex
	signalSuppressionOpsMu    sync.Mutex
	signalSuppressionOps      map[string]*sync.Mutex
	signalSuppressionsMu      sync.RWMutex
	signalSuppressions        map[string]map[string]SignalSuppressionRecord

	nsEnrich *nsEnrichmentCoordinator

	observerEnsureMu   sync.Mutex
	observerEnsureLast map[string]time.Time

	nsSweepMu        sync.Mutex
	nsSweepLast      map[string]map[string]time.Time
	nsSweepHourStart map[string]time.Time
	nsSweepHourCount map[string]int

	// Last HTTP activity (Unix nano) for namespace enrichment idle gating.
	uiActivityUnix atomic.Int64
}

// NewManager creates a new DataPlaneManager with default configuration.
func NewManager(cfg ManagerConfig) DataPlaneManager {
	profile := cfg.Profile
	if profile == "" {
		profile = ProfileFocused
	}
	mode := cfg.DiscoveryMode
	if mode == "" {
		mode = DiscoveryModeTargeted
	}

	var cp ClientsProvider
	if cfg.ClusterManager != nil {
		cp = managerClients{m: cfg.ClusterManager}
	}

	bundle := ValidateDataplanePolicyBundle(DataplanePolicyBundle{
		Global: cfg.Policy,
	})
	policy := bundle.Global

	sched := newWorkScheduler(policy.BackgroundBudget.MaxConcurrentPerCluster)
	sched.configureRetries(policy.BackgroundBudget.TransientRetries, 100*time.Millisecond, 1500*time.Millisecond)
	if cfg.Runtime != nil {
		reg := cfg.Runtime.Registry()
		sched.configureLongRun(time.Duration(policy.BackgroundBudget.LongRunNoticeSec)*time.Second, newDataplaneLongRunRecorder(reg))
	}
	m := &manager{
		rt:                   cfg.Runtime,
		defaultProfile:       profile,
		defaultDiscoveryMode: mode,
		planes:               map[string]*clusterPlane{},
		scheduler:            sched,
		clients:              cp,
		stats:                newDataplaneSessionStats(time.Now().UTC()),
		policy:               policy,
		bundle:               bundle,
		signalHistory:        map[string]map[string]SignalHistoryRecord{},
		signalAck:            map[string]map[string]SignalAcknowledgementRecord{},
		signalSuppressionOps: map[string]*sync.Mutex{},
		signalSuppressions:   map[string]map[string]SignalSuppressionRecord{},
		nsEnrich:             newNsEnrichmentCoordinator(),
		observerEnsureLast:   map[string]time.Time{},
		nsSweepLast:          map[string]map[string]time.Time{},
		nsSweepHourStart:     map[string]time.Time{},
		nsSweepHourCount:     map[string]int{},
		migration:            PersistenceMigrationStatus{Phase: PersistenceMigrationPhaseIdle},
	}
	if err := m.configurePersistence(policy); err != nil {
		m.policy.Persistence.Enabled = false
		m.bundle.Global.Persistence.Enabled = false
	}
	return m
}

func (m *manager) Policy() DataplanePolicy {
	return m.PolicyBundle().Global
}

func (m *manager) PolicyBundle() DataplanePolicyBundle {
	m.policyMu.RLock()
	bundle := CloneDataplanePolicyBundle(m.bundle)
	m.policyMu.RUnlock()
	return ValidateDataplanePolicyBundle(bundle)
}

func (m *manager) EffectivePolicy(contextName string) DataplanePolicy {
	m.policyMu.RLock()
	bundle := CloneDataplanePolicyBundle(m.bundle)
	m.policyMu.RUnlock()
	return bundle.EffectivePolicy(contextName)
}

func (m *manager) SetPolicy(policy DataplanePolicy) DataplanePolicy {
	bundle := m.PolicyBundle()
	bundle.Global = policy
	return m.SetPolicyBundle(bundle).Global
}

func (m *manager) SetPolicyBundle(bundle DataplanePolicyBundle) DataplanePolicyBundle {
	nextBundle := ValidateDataplanePolicyBundle(bundle)
	next := nextBundle.Global
	m.policyMu.Lock()
	m.bundle = nextBundle
	m.policy = next
	m.policyMu.Unlock()
	if m.scheduler != nil {
		// Scheduler lane limits/retry policy are process-global by design:
		// slots are shared across all clusters in one manager instance, so
		// per-context background budget overrides cannot safely mutate
		// scheduler-wide settings without cross-cluster contention effects.
		m.scheduler.setMaxPerCluster(next.BackgroundBudget.MaxConcurrentPerCluster)
		m.scheduler.configureRetries(next.BackgroundBudget.TransientRetries, 100*time.Millisecond, 1500*time.Millisecond)
		m.scheduler.configureLongRun(time.Duration(next.BackgroundBudget.LongRunNoticeSec)*time.Second, newDataplaneLongRunRecorder(m.activityReg()))
	}
	if err := m.configurePersistence(next); err != nil {
		next.Persistence.Enabled = false
		nextBundle.Global = next
		m.policyMu.Lock()
		m.bundle = nextBundle
		m.policy = next
		m.policyMu.Unlock()
	}
	return nextBundle
}

func (m *manager) configurePersistence(policy DataplanePolicy) error {
	m.persistenceMu.Lock()
	if !policy.Persistence.Enabled {
		if m.persistence != nil {
			_ = m.persistence.Close()
			m.persistence = nil
		}
		m.migration = PersistenceMigrationStatus{Phase: PersistenceMigrationPhaseIdle}
		m.persistenceMu.Unlock()
		return nil
	}
	if m.persistence != nil {
		if m.migration.Phase == "" {
			m.migration = PersistenceMigrationStatus{Phase: PersistenceMigrationPhaseDone}
		}
		m.persistenceMu.Unlock()
		m.hydratePersistedPlanes(policy)
		return nil
	}
	m.migration = PersistenceMigrationStatus{Phase: PersistenceMigrationPhaseRunning}
	p, err := openBoltSnapshotPersistence("")
	if err != nil {
		m.migration = PersistenceMigrationStatus{
			Phase: PersistenceMigrationPhaseFailed,
			Error: err.Error(),
		}
		m.persistenceMu.Unlock()
		return persistenceOpenError(err)
	}
	ms := p.MigrationStatus()
	m.migration = PersistenceMigrationStatus{
		Phase:       PersistenceMigrationPhaseDone,
		FromVersion: ms.FromVersion,
		ToVersion:   ms.ToVersion,
		Applied:     ms.Applied,
	}
	m.persistence = p
	m.persistenceMu.Unlock()
	m.hydratePersistedPlanes(policy)
	return nil
}

func (m *manager) currentPersistence() snapshotPersistence {
	m.persistenceMu.RLock()
	defer m.persistenceMu.RUnlock()
	return m.persistence
}

func (m *manager) PersistenceMigrationStatus() PersistenceMigrationStatus {
	m.persistenceMu.RLock()
	defer m.persistenceMu.RUnlock()
	return m.migration
}

func (m *manager) hydratePersistedPlanes(policy DataplanePolicy) {
	sp := m.currentPersistence()
	if sp == nil {
		return
	}
	maxAge := policy.PersistenceMaxAge()
	_ = sp.PruneOlderThan("", maxAge)
	_ = sp.PruneSignalHistoryOlderThan("", maxAge)
	_ = sp.PruneSignalAcknowledgementsOlderThan("", maxAge)
	_ = m.pruneSignalSuppressions(sp, time.Now().UTC(), maxAge)
	m.mu.RLock()
	planes := make([]*clusterPlane, 0, len(m.planes))
	for _, plane := range m.planes {
		planes = append(planes, plane)
	}
	m.mu.RUnlock()
	for _, plane := range planes {
		_ = plane.hydratePersistedSnapshots(maxAge)
		m.ensureSignalHistory(plane.name)
	}
}

// pruneSignalSuppressions reconciles global durable pruning with lazily loaded
// suppression state. Successful prune invalidates every loaded context so its
// next operation reloads retained persistence records; failure leaves memory as-is.
func (m *manager) pruneSignalSuppressions(sp snapshotPersistence, now time.Time, maxAge time.Duration) error {
	m.signalSuppressionsPruneMu.Lock()
	defer m.signalSuppressionsPruneMu.Unlock()
	if err := sp.PruneSignalSuppressions("", now, maxAge); err != nil {
		return err
	}
	m.signalSuppressionsMu.Lock()
	m.signalSuppressions = map[string]map[string]SignalSuppressionRecord{}
	m.signalSuppressionsMu.Unlock()
	return nil
}

func (m *manager) DefaultProfile() Profile {
	return m.defaultProfile
}

func (m *manager) DefaultDiscoveryMode() DiscoveryMode {
	return m.defaultDiscoveryMode
}

func (m *manager) PlaneForCluster(_ context.Context, clusterName string) (ClusterPlane, error) {
	m.mu.RLock()
	if p, ok := m.planes[clusterName]; ok {
		m.mu.RUnlock()
		return p, nil
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.planes[clusterName]; ok {
		return p, nil
	}

	scope := ObservationScope{
		ClusterName:   clusterName,
		Namespaces:    nil,
		ResourceKinds: nil,
	}
	p := newClusterPlane(clusterName, m.defaultProfile, m.defaultDiscoveryMode, scope, func() DataplanePolicy {
		return m.EffectivePolicy(clusterName)
	}, m.currentPersistence, m.stats)
	m.planes[clusterName] = p
	policy := m.EffectivePolicy(clusterName)
	if policy.Persistence.Enabled {
		_ = p.hydratePersistedSnapshots(policy.PersistenceMaxAge())
		m.ensureSignalHistory(clusterName)
	}
	return p, nil
}

func (m *manager) WarmClusterBackground(ctx context.Context, clusterName string) error {
	if strings.TrimSpace(clusterName) == "" || m.clients == nil {
		return nil
	}
	admission := m.scheduler.BackgroundAdmission(clusterName)
	if admission == SchedulerBackgroundAdmissionPaused {
		return nil
	}
	policy := m.EffectivePolicy(clusterName)
	allContexts := policy.AllContextEnrichment
	if policy.Profile == DataplaneProfileManual || !allContexts.Enabled {
		return nil
	}
	if allContexts.PauseWhenSchedulerBusy && m.schedulerHasWork(clusterName) {
		return nil
	}
	if allContexts.PauseOnUserActivity {
		if err := m.waitAPIQuiet(ctx, time.Duration(allContexts.IdleQuietMs)*time.Millisecond); err != nil {
			return err
		}
	}
	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceAllContexts)
	m.EnsureObservers(ctx, clusterName)
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)

	nsSnap, err := plane.NamespacesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityLow)
	if policy.Observers.Enabled && policy.Observers.NodesEnabled {
		_, _ = plane.NodesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityLow)
	}
	if admission == SchedulerBackgroundAdmissionOpen && shouldWarmClusterCustomResources(policy) {
		_, _ = plane.ClusterCustomResourcesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityLow)
	}
	if err != nil {
		return err
	}
	if policy.NamespaceEnrichment.Enabled && policy.NamespaceEnrichment.Sweep.Enabled && len(nsSnap.Items) > 0 && !m.hasNamespaceEnrichmentInFlight(clusterName) {
		m.BeginNamespaceListProgressiveEnrichment(clusterName, nsSnap.Items, NamespaceEnrichHints{})
	}
	return nil
}

func shouldWarmClusterCustomResources(policy DataplanePolicy) bool {
	return policy.Profile == DataplaneProfileDiagnostic
}

type clusterPlane struct {
	name          string
	profile       Profile
	discoveryMode DiscoveryMode
	scope         ObservationScope

	healthMu sync.RWMutex
	health   PlaneHealth

	// Per-cluster capability registry.
	capRegistry *CapabilityRegistry

	// First-wave raw snapshots.
	nsStore                     snapshotStore[NamespaceSnapshot]
	nodesStore                  snapshotStore[NodesSnapshot]
	persistentVolumesStore      snapshotStore[PersistentVolumesSnapshot]
	clusterRolesStore           snapshotStore[ClusterRolesSnapshot]
	clusterRoleBindingsStore    snapshotStore[ClusterRoleBindingsSnapshot]
	crdsStore                   snapshotStore[CRDsSnapshot]
	clusterCustomResourcesStore snapshotStore[CustomResourcesSnapshot]
	// Metrics snapshots are cluster-scoped for nodes and namespaced for pods.
	// These kinds are not persisted (see snapshot_exec.go skipPersistence);
	// they are short-TTL and optional, only meaningful when metrics-server is
	// installed and the caller has list RBAC on metrics.k8s.io.
	nodeMetricsStore snapshotStore[NodeMetricsSnapshot]

	// Namespace-scoped snapshots for first-wave resources.
	podsStore            namespacedSnapshotStore[PodsSnapshot]
	depsStore            namespacedSnapshotStore[DeploymentsSnapshot]
	svcsStore            namespacedSnapshotStore[ServicesSnapshot]
	ingStore             namespacedSnapshotStore[IngressesSnapshot]
	networkPoliciesStore namespacedSnapshotStore[NetworkPoliciesSnapshot]
	pvcsStore            namespacedSnapshotStore[PVCsSnapshot]
	cmsStore             namespacedSnapshotStore[ConfigMapsSnapshot]
	secsStore            namespacedSnapshotStore[SecretsSnapshot]
	saStore              namespacedSnapshotStore[ServiceAccountsSnapshot]
	rolesStore           namespacedSnapshotStore[RolesSnapshot]
	roleBindingsStore    namespacedSnapshotStore[RoleBindingsSnapshot]
	helmReleasesStore    namespacedSnapshotStore[HelmReleasesSnapshot]
	dsStore              namespacedSnapshotStore[DaemonSetsSnapshot]
	stsStore             namespacedSnapshotStore[StatefulSetsSnapshot]
	rsStore              namespacedSnapshotStore[ReplicaSetsSnapshot]
	jobsStore            namespacedSnapshotStore[JobsSnapshot]
	cjStore              namespacedSnapshotStore[CronJobsSnapshot]
	hpaStore             namespacedSnapshotStore[HPAsSnapshot]
	rqStore              namespacedSnapshotStore[ResourceQuotasSnapshot]
	lrStore              namespacedSnapshotStore[LimitRangesSnapshot]
	customResourcesStore namespacedSnapshotStore[CustomResourcesSnapshot]
	podMetricsStore      namespacedSnapshotStore[PodMetricsSnapshot]

	// Observers state for this cluster.
	obsMu     sync.Mutex
	observers *clusterObservers

	persistHydrateMu sync.Mutex
	persistHydrating atomic.Bool

	policy      func() DataplanePolicy
	persistence func() snapshotPersistence
	stats       *dataplaneSessionStats
}

func newClusterPlane(name string, profile Profile, mode DiscoveryMode, scope ObservationScope, policy func() DataplanePolicy, persistence func() snapshotPersistence, stats *dataplaneSessionStats) *clusterPlane {
	if policy == nil {
		policy = func() DataplanePolicy { return DefaultDataplanePolicy() }
	}
	if persistence == nil {
		persistence = func() snapshotPersistence { return nil }
	}
	p := &clusterPlane{
		name:                 name,
		profile:              profile,
		discoveryMode:        mode,
		scope:                scope,
		health:               PlaneHealthUnknown,
		capRegistry:          NewCapabilityRegistry(),
		podsStore:            newNamespacedSnapshotStore[PodsSnapshot](),
		depsStore:            newNamespacedSnapshotStore[DeploymentsSnapshot](),
		svcsStore:            newNamespacedSnapshotStore[ServicesSnapshot](),
		ingStore:             newNamespacedSnapshotStore[IngressesSnapshot](),
		networkPoliciesStore: newNamespacedSnapshotStore[NetworkPoliciesSnapshot](),
		pvcsStore:            newNamespacedSnapshotStore[PVCsSnapshot](),
		cmsStore:             newNamespacedSnapshotStore[ConfigMapsSnapshot](),
		secsStore:            newNamespacedSnapshotStore[SecretsSnapshot](),
		saStore:              newNamespacedSnapshotStore[ServiceAccountsSnapshot](),
		rolesStore:           newNamespacedSnapshotStore[RolesSnapshot](),
		roleBindingsStore:    newNamespacedSnapshotStore[RoleBindingsSnapshot](),
		helmReleasesStore:    newNamespacedSnapshotStore[HelmReleasesSnapshot](),
		dsStore:              newNamespacedSnapshotStore[DaemonSetsSnapshot](),
		stsStore:             newNamespacedSnapshotStore[StatefulSetsSnapshot](),
		rsStore:              newNamespacedSnapshotStore[ReplicaSetsSnapshot](),
		jobsStore:            newNamespacedSnapshotStore[JobsSnapshot](),
		cjStore:              newNamespacedSnapshotStore[CronJobsSnapshot](),
		hpaStore:             newNamespacedSnapshotStore[HPAsSnapshot](),
		rqStore:              newNamespacedSnapshotStore[ResourceQuotasSnapshot](),
		lrStore:              newNamespacedSnapshotStore[LimitRangesSnapshot](),
		customResourcesStore: newNamespacedSnapshotStore[CustomResourcesSnapshot](),
		podMetricsStore:      newNamespacedSnapshotStore[PodMetricsSnapshot](),
		policy:               policy,
		persistence:          persistence,
		stats:                stats,
	}
	p.nsStore.configureTelemetry(stats, name, ResourceKindNamespaces)
	p.nodesStore.configureTelemetry(stats, name, ResourceKindNodes)
	p.persistentVolumesStore.configureTelemetry(stats, name, ResourceKindPersistentVolumes)
	p.clusterRolesStore.configureTelemetry(stats, name, ResourceKindClusterRoles)
	p.clusterRoleBindingsStore.configureTelemetry(stats, name, ResourceKindClusterRoleBindings)
	p.crdsStore.configureTelemetry(stats, name, ResourceKindCRDs)
	p.clusterCustomResourcesStore.configureTelemetry(stats, name, ResourceKindClusterCustomResources)
	p.podsStore.configureTelemetry(stats, name, ResourceKindPods)
	p.depsStore.configureTelemetry(stats, name, ResourceKindDeployments)
	p.svcsStore.configureTelemetry(stats, name, ResourceKindServices)
	p.ingStore.configureTelemetry(stats, name, ResourceKindIngresses)
	p.networkPoliciesStore.configureTelemetry(stats, name, ResourceKindNetworkPolicies)
	p.pvcsStore.configureTelemetry(stats, name, ResourceKindPVCs)
	p.cmsStore.configureTelemetry(stats, name, ResourceKindConfigMaps)
	p.secsStore.configureTelemetry(stats, name, ResourceKindSecrets)
	p.saStore.configureTelemetry(stats, name, ResourceKindServiceAccounts)
	p.rolesStore.configureTelemetry(stats, name, ResourceKindRoles)
	p.roleBindingsStore.configureTelemetry(stats, name, ResourceKindRoleBindings)
	p.helmReleasesStore.configureTelemetry(stats, name, ResourceKindHelmReleases)
	p.dsStore.configureTelemetry(stats, name, ResourceKindDaemonSets)
	p.stsStore.configureTelemetry(stats, name, ResourceKindStatefulSets)
	p.rsStore.configureTelemetry(stats, name, ResourceKindReplicaSets)
	p.jobsStore.configureTelemetry(stats, name, ResourceKindJobs)
	p.cjStore.configureTelemetry(stats, name, ResourceKindCronJobs)
	p.hpaStore.configureTelemetry(stats, name, ResourceKindHPAs)
	p.rqStore.configureTelemetry(stats, name, ResourceKindResourceQuotas)
	p.lrStore.configureTelemetry(stats, name, ResourceKindLimitRanges)
	p.customResourcesStore.configureTelemetry(stats, name, ResourceKindCustomResources)
	p.nodeMetricsStore.configureTelemetry(stats, name, ResourceKindNodeMetrics)
	p.podMetricsStore.configureTelemetry(stats, name, ResourceKindPodMetrics)
	return p
}

func (p *clusterPlane) ClusterName() string {
	return p.name
}

func (p *clusterPlane) Profile() Profile {
	return p.profile
}

func (p *clusterPlane) DiscoveryMode() DiscoveryMode {
	return p.discoveryMode
}

func (p *clusterPlane) Scope() ObservationScope {
	return p.scope
}

func (p *clusterPlane) Health() PlaneHealth {
	p.healthMu.RLock()
	defer p.healthMu.RUnlock()
	return p.health
}

func (p *clusterPlane) currentPolicy() DataplanePolicy {
	if p.policy == nil {
		return DefaultDataplanePolicy()
	}
	return p.policy()
}

func (p *clusterPlane) currentPersistence() snapshotPersistence {
	if p.persistence == nil {
		return nil
	}
	return p.persistence()
}

func (p *clusterPlane) hydratePersistedSnapshots(maxAge time.Duration) error {
	p.persistHydrateMu.Lock()
	p.persistHydrating.Store(true)
	defer func() {
		p.persistHydrating.Store(false)
		p.persistHydrateMu.Unlock()
	}()

	sp := p.currentPersistence()
	if sp == nil {
		return nil
	}
	if err := sp.PruneOlderThan(p.name, maxAge); err != nil {
		return err
	}
	cells, err := sp.ListSnapshots(p.name)
	if err != nil {
		return err
	}
	var firstErr error
	for _, cell := range cells {
		if cell.Namespace == "" {
			if err := p.hydratePersistedClusterSnapshot(cell.Kind, cell.Payload, maxAge); err != nil {
				if firstErr == nil {
					firstErr = err
				}
			}
			continue
		}
		if err := p.hydratePersistedNamespacedSnapshot(cell.Kind, cell.Namespace, cell.Payload, maxAge); err != nil {
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (p *clusterPlane) hydratePersistedClusterSnapshot(kind ResourceKind, payload []byte, maxAge time.Duration) error {
	switch kind {
	case ResourceKindNamespaces:
		return hydratePersistedClusterSnapshotInto(&p.nsStore, payload, maxAge)
	case ResourceKindNodes:
		return hydratePersistedClusterSnapshotInto(&p.nodesStore, payload, maxAge)
	case ResourceKindPersistentVolumes:
		return hydratePersistedClusterSnapshotInto(&p.persistentVolumesStore, payload, maxAge)
	case ResourceKindClusterRoles:
		return hydratePersistedClusterSnapshotInto(&p.clusterRolesStore, payload, maxAge)
	case ResourceKindClusterRoleBindings:
		return hydratePersistedClusterSnapshotInto(&p.clusterRoleBindingsStore, payload, maxAge)
	case ResourceKindCRDs:
		return hydratePersistedClusterSnapshotInto(&p.crdsStore, payload, maxAge)
	case ResourceKindClusterCustomResources:
		return hydratePersistedClusterSnapshotInto(&p.clusterCustomResourcesStore, payload, maxAge)
	}
	return nil
}

func (p *clusterPlane) hydratePersistedNamespacedSnapshot(kind ResourceKind, namespace string, payload []byte, maxAge time.Duration) error {
	switch kind {
	case ResourceKindPods:
		return hydratePersistedNamespacedSnapshotInto(&p.podsStore, namespace, payload, maxAge)
	case ResourceKindDeployments:
		return hydratePersistedNamespacedSnapshotInto(&p.depsStore, namespace, payload, maxAge)
	case ResourceKindServices:
		return hydratePersistedNamespacedSnapshotInto(&p.svcsStore, namespace, payload, maxAge)
	case ResourceKindIngresses:
		return hydratePersistedNamespacedSnapshotInto(&p.ingStore, namespace, payload, maxAge)
	case ResourceKindNetworkPolicies:
		return hydratePersistedNamespacedSnapshotInto(&p.networkPoliciesStore, namespace, payload, maxAge)
	case ResourceKindPVCs:
		return hydratePersistedNamespacedSnapshotInto(&p.pvcsStore, namespace, payload, maxAge)
	case ResourceKindConfigMaps:
		return hydratePersistedNamespacedSnapshotInto(&p.cmsStore, namespace, payload, maxAge)
	case ResourceKindSecrets:
		return hydratePersistedNamespacedSnapshotInto(&p.secsStore, namespace, payload, maxAge)
	case ResourceKindServiceAccounts:
		return hydratePersistedNamespacedSnapshotInto(&p.saStore, namespace, payload, maxAge)
	case ResourceKindRoles:
		return hydratePersistedNamespacedSnapshotInto(&p.rolesStore, namespace, payload, maxAge)
	case ResourceKindRoleBindings:
		return hydratePersistedNamespacedSnapshotInto(&p.roleBindingsStore, namespace, payload, maxAge)
	case ResourceKindHelmReleases:
		return hydratePersistedNamespacedSnapshotInto(&p.helmReleasesStore, namespace, payload, maxAge)
	case ResourceKindDaemonSets:
		return hydratePersistedNamespacedSnapshotInto(&p.dsStore, namespace, payload, maxAge)
	case ResourceKindStatefulSets:
		return hydratePersistedNamespacedSnapshotInto(&p.stsStore, namespace, payload, maxAge)
	case ResourceKindReplicaSets:
		return hydratePersistedNamespacedSnapshotInto(&p.rsStore, namespace, payload, maxAge)
	case ResourceKindJobs:
		return hydratePersistedNamespacedSnapshotInto(&p.jobsStore, namespace, payload, maxAge)
	case ResourceKindCronJobs:
		return hydratePersistedNamespacedSnapshotInto(&p.cjStore, namespace, payload, maxAge)
	case ResourceKindHPAs:
		return hydratePersistedNamespacedSnapshotInto(&p.hpaStore, namespace, payload, maxAge)
	case ResourceKindResourceQuotas:
		return hydratePersistedNamespacedSnapshotInto(&p.rqStore, namespace, payload, maxAge)
	case ResourceKindLimitRanges:
		return hydratePersistedNamespacedSnapshotInto(&p.lrStore, namespace, payload, maxAge)
	case ResourceKindCustomResources:
		return hydratePersistedNamespacedSnapshotInto(&p.customResourcesStore, namespace, payload, maxAge)
	}
	return nil
}

func hydratePersistedClusterSnapshotInto[I any](store *snapshotStore[Snapshot[I]], payload []byte, maxAge time.Duration) error {
	if _, ok := peekClusterSnapshot(store); ok {
		return nil
	}
	var snap Snapshot[I]
	if err := json.Unmarshal(payload, &snap); err != nil {
		return err
	}
	if markPersistedSnapshot(&snap, maxAge) {
		if store.telemetry.stats != nil {
			store.telemetry.stats.recordHydration(store.telemetry.kind, len(payload))
		}
		setClusterSnapshot(store, snap)
	}
	return nil
}

func hydratePersistedNamespacedSnapshotInto[I any](store *namespacedSnapshotStore[Snapshot[I]], namespace string, payload []byte, maxAge time.Duration) error {
	if _, ok := peekNamespacedSnapshot(store, namespace); ok {
		return nil
	}
	var snap Snapshot[I]
	if err := json.Unmarshal(payload, &snap); err != nil {
		return err
	}
	if markPersistedSnapshot(&snap, maxAge) {
		if store.telemetry.stats != nil {
			store.telemetry.stats.recordHydration(store.telemetry.kind, len(payload))
		}
		setNamespacedSnapshot(store, namespace, snap)
	}
	return nil
}

// NamespacesSnapshot returns a raw snapshot for namespaces plus metadata and any normalized error.
func (p *clusterPlane) NamespacesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NamespaceSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NamespaceListItemDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.NamespaceListItemDTO],
		kind:                 ResourceKindNamespaces,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindNamespaces),
		capGroup:             "",
		capResource:          "namespaces",
		capScope:             CapabilityScopeCluster,
		fetch:                namespaces.ListNamespaces,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.nsStore, desc)
}

// NodesSnapshot returns a raw snapshot for nodes plus metadata and any normalized error.
func (p *clusterPlane) NodesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NodesSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NodeListItemDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.NodeListItemDTO],
		kind:                 ResourceKindNodes,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindNodes),
		capGroup:             "",
		capResource:          "nodes",
		capScope:             CapabilityScopeCluster,
		fetch:                nodes.ListNodes,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.nodesStore, desc)
}

// PersistentVolumesSnapshot returns a raw snapshot for persistent volumes plus metadata and any normalized error.
func (p *clusterPlane) PersistentVolumesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (PersistentVolumesSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.PersistentVolumeDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.PersistentVolumeDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindPersistentVolumes,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindPersistentVolumes),
		capGroup:                  "",
		capResource:               "persistentvolumes",
		capScope:                  CapabilityScopeCluster,
		fetch:                     pvs.ListPersistentVolumes,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.persistentVolumesStore, desc)
}

// ClusterRolesSnapshot returns a raw snapshot for cluster roles plus metadata and any normalized error.
func (p *clusterPlane) ClusterRolesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (ClusterRolesSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.ClusterRoleListItemDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.ClusterRoleListItemDTO],
		kind:                 ResourceKindClusterRoles,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindClusterRoles),
		capGroup:             "rbac.authorization.k8s.io",
		capResource:          "clusterroles",
		capScope:             CapabilityScopeCluster,
		fetch:                clusterroles.ListClusterRoles,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.clusterRolesStore, desc)
}

// ClusterRoleBindingsSnapshot returns a raw snapshot for cluster role bindings plus metadata and any normalized error.
func (p *clusterPlane) ClusterRoleBindingsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (ClusterRoleBindingsSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.ClusterRoleBindingListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.ClusterRoleBindingListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindClusterRoleBindings,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindClusterRoleBindings),
		capGroup:                  "rbac.authorization.k8s.io",
		capResource:               "clusterrolebindings",
		capScope:                  CapabilityScopeCluster,
		fetch:                     crbindings.ListClusterRoleBindings,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.clusterRoleBindingsStore, desc)
}

// CRDsSnapshot returns a raw snapshot for custom resource definitions plus metadata and any normalized error.
func (p *clusterPlane) CRDsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (CRDsSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.CRDListItemDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.CRDListItemDTO],
		kind:                 ResourceKindCRDs,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindCRDs),
		capGroup:             "apiextensions.k8s.io",
		capResource:          "customresourcedefinitions",
		capScope:             CapabilityScopeCluster,
		fetch:                crds.ListCustomResourceDefinitions,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.crdsStore, desc)
}

// PodsSnapshot returns a raw snapshot for pods in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PodsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (PodsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.PodListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.PodListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference, dto.ResourceRelationshipFamilyLabels},
		kind:                      ResourceKindPods,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindPods),
		capGroup:                  "",
		capResource:               "pods",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     pods.ListPods,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.podsStore, desc)
}

// DeploymentsSnapshot returns a raw snapshot for deployments in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DeploymentsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (DeploymentsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.DeploymentListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.DeploymentListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindDeployments,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindDeployments),
		capGroup:                  "",
		capResource:               "deployments",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     deployments.ListDeployments,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.depsStore, desc)
}

// ServicesSnapshot returns a raw snapshot for services in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ServicesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ServicesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ServiceListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.ServiceListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector},
		kind:                      ResourceKindServices,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindServices),
		capGroup:                  "",
		capResource:               "services",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     svcs.ListServices,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.svcsStore, desc)
}

// IngressesSnapshot returns a raw snapshot for ingresses in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) IngressesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (IngressesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.IngressListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.IngressListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindIngresses,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindIngresses),
		capGroup:                  "networking.k8s.io",
		capResource:               "ingresses",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     ingresses.ListIngresses,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.ingStore, desc)
}

// NetworkPoliciesSnapshot returns a raw snapshot for network policies in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) NetworkPoliciesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (NetworkPoliciesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.NetworkPolicyDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.NetworkPolicyDTO],
		kind:                 ResourceKindNetworkPolicies,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindNetworkPolicies),
		capGroup:             "networking.k8s.io",
		capResource:          "networkpolicies",
		capScope:             CapabilityScopeNamespace,
		fetch:                networkpolicies.ListNetworkPolicies,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.networkPoliciesStore, desc)
}

// PVCsSnapshot returns a raw snapshot for PVCs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PVCsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (PVCsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.PersistentVolumeClaimDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.PersistentVolumeClaimDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindPVCs,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindPVCs),
		capGroup:                  "",
		capResource:               "persistentvolumeclaims",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     pvcs.ListPersistentVolumeClaims,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.pvcsStore, desc)
}

// ConfigMapsSnapshot returns a raw snapshot for configmaps in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ConfigMapsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ConfigMapsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ConfigMapDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.ConfigMapDTO],
		kind:                 ResourceKindConfigMaps,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindConfigMaps),
		capGroup:             "",
		capResource:          "configmaps",
		capScope:             CapabilityScopeNamespace,
		fetch:                configmaps.ListConfigMaps,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.cmsStore, desc)
}

// SecretsSnapshot returns a raw snapshot for secrets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) SecretsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (SecretsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.SecretDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.SecretDTO],
		kind:                 ResourceKindSecrets,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindSecrets),
		capGroup:             "",
		capResource:          "secrets",
		capScope:             CapabilityScopeNamespace,
		fetch:                secrets.ListSecrets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.secsStore, desc)
}

// ServiceAccountsSnapshot returns a raw snapshot for serviceaccounts in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ServiceAccountsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ServiceAccountsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ServiceAccountListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.ServiceAccountListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindServiceAccounts,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindServiceAccounts),
		capGroup:                  "",
		capResource:               "serviceaccounts",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     serviceaccounts.ListServiceAccounts,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.saStore, desc)
}

// RolesSnapshot returns a raw snapshot for roles in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) RolesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (RolesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.RoleListItemDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.RoleListItemDTO],
		kind:                 ResourceKindRoles,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindRoles),
		capGroup:             "rbac.authorization.k8s.io",
		capResource:          "roles",
		capScope:             CapabilityScopeNamespace,
		fetch:                roles.ListRoles,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rolesStore, desc)
}

// RoleBindingsSnapshot returns a raw snapshot for rolebindings in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) RoleBindingsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (RoleBindingsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.RoleBindingListItemDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.RoleBindingListItemDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindRoleBindings,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindRoleBindings),
		capGroup:                  "rbac.authorization.k8s.io",
		capResource:               "rolebindings",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     rolebindings.ListRoleBindings,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.roleBindingsStore, desc)
}

// HelmReleasesSnapshot returns a raw snapshot for Helm releases in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) HelmReleasesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (HelmReleasesSnapshot, error) {
	// Helm releases are virtual projections over Secrets, not Kubernetes relationship carriers.
	desc := namespacedSnapshotDescriptor[dto.HelmReleaseDTO]{
		kind:        ResourceKindHelmReleases,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindHelmReleases),
		capGroup:    "",
		capResource: "secrets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kubehelm.ListHelmReleases,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.helmReleasesStore, desc)
}

// DaemonSetsSnapshot returns a raw snapshot for daemonsets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DaemonSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (DaemonSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.DaemonSetDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.DaemonSetDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindDaemonSets,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindDaemonSets),
		capGroup:                  "",
		capResource:               "daemonsets",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     daemonsets.ListDaemonSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.dsStore, desc)
}

// StatefulSetsSnapshot returns a raw snapshot for statefulsets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) StatefulSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (StatefulSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.StatefulSetDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.StatefulSetDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindStatefulSets,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindStatefulSets),
		capGroup:                  "",
		capResource:               "statefulsets",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     statefulsets.ListStatefulSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.stsStore, desc)
}

// ReplicaSetsSnapshot returns a raw snapshot for replicasets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ReplicaSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ReplicaSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ReplicaSetDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.ReplicaSetDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindReplicaSets,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindReplicaSets),
		capGroup:                  "",
		capResource:               "replicasets",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     replicasets.ListReplicaSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rsStore, desc)
}

// JobsSnapshot returns a raw snapshot for jobs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) JobsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (JobsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.JobDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.JobDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindJobs,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindJobs),
		capGroup:                  "batch",
		capResource:               "jobs",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     jobs.ListJobs,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.jobsStore, desc)
}

// CronJobsSnapshot returns a raw snapshot for cronjobs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) CronJobsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (CronJobsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.CronJobDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.CronJobDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindCronJobs,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindCronJobs),
		capGroup:                  "batch",
		capResource:               "cronjobs",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     cronjobs.ListCronJobs,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.cjStore, desc)
}

// HPAsSnapshot returns a raw snapshot for horizontal pod autoscalers in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) HPAsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (HPAsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.HorizontalPodAutoscalerDTO]{
		extractRelationships:      dto.ExtractResourceRelationships[dto.HorizontalPodAutoscalerDTO],
		extraRelationshipFamilies: []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyObjectReference},
		kind:                      ResourceKindHPAs,
		ttl:                       p.currentPolicy().SnapshotTTL(ResourceKindHPAs),
		capGroup:                  "autoscaling",
		capResource:               "horizontalpodautoscalers",
		capScope:                  CapabilityScopeNamespace,
		fetch:                     hpas.ListHorizontalPodAutoscalers,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.hpaStore, desc)
}

// ResourceQuotasSnapshot returns a raw snapshot for resource quotas in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ResourceQuotasSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ResourceQuotasSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ResourceQuotaDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.ResourceQuotaDTO],
		kind:                 ResourceKindResourceQuotas,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindResourceQuotas),
		capGroup:             "",
		capResource:          "resourcequotas",
		capScope:             CapabilityScopeNamespace,
		fetch:                rquotas.ListResourceQuotaItems,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rqStore, desc)
}

// LimitRangesSnapshot returns a raw snapshot for limit ranges in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) LimitRangesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (LimitRangesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.LimitRangeDTO]{
		extractRelationships: dto.ExtractResourceRelationships[dto.LimitRangeDTO],
		kind:                 ResourceKindLimitRanges,
		ttl:                  p.currentPolicy().SnapshotTTL(ResourceKindLimitRanges),
		capGroup:             "",
		capResource:          "limitranges",
		capScope:             CapabilityScopeNamespace,
		fetch:                limitranges.ListLimitRanges,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.lrStore, desc)
}

// NodeMetricsSnapshot returns a raw cluster-scoped node usage snapshot from
// metrics.k8s.io. The snapshot is intentionally not persisted because metric
// samples churn every ~15s and the data is not recoverable-by-design.
// The capability registry learns RBAC outcomes under group "metrics.k8s.io".
func (p *clusterPlane) NodeMetricsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NodeMetricsSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NodeMetricsDTO]{
		kind:            ResourceKindNodeMetrics,
		ttl:             p.currentPolicy().SnapshotTTL(ResourceKindNodeMetrics),
		capGroup:        kubemetrics.MetricsAPIGroup,
		capResource:     "nodes",
		capScope:        CapabilityScopeCluster,
		fetch:           kubemetrics.ListNodeMetrics,
		skipPersistence: true,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.nodeMetricsStore, desc)
}

// PodMetricsSnapshot returns a namespaced pod usage snapshot from
// metrics.k8s.io. Like NodeMetrics, this snapshot is not persisted.
func (p *clusterPlane) PodMetricsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (PodMetricsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.PodMetricsDTO]{
		kind:            ResourceKindPodMetrics,
		ttl:             p.currentPolicy().SnapshotTTL(ResourceKindPodMetrics),
		capGroup:        kubemetrics.MetricsAPIGroup,
		capResource:     "pods",
		capScope:        CapabilityScopeNamespace,
		fetch:           kubemetrics.ListPodMetrics,
		skipPersistence: true,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.podMetricsStore, desc)
}

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	if strings.TrimSpace(clusterName) == "" {
		return
	}
	if !m.EffectivePolicy(clusterName).Observers.Enabled {
		return
	}
	now := time.Now()
	m.observerEnsureMu.Lock()
	if last := m.observerEnsureLast[clusterName]; !last.IsZero() && now.Sub(last) < 30*time.Second {
		m.observerEnsureMu.Unlock()
		return
	}
	m.observerEnsureLast[clusterName] = now
	m.observerEnsureMu.Unlock()

	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	plane.EnsureObservers(context.WithoutCancel(ctx), m.scheduler, m.clients, m.rt)
}

func (m *manager) MergeCachedNamespaceRowProjection(ctx context.Context, clusterName string, items []dto.NamespaceListItemDTO) ([]dto.NamespaceListItemDTO, int) {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return items, 0
	}
	plane := planeAny.(*clusterPlane)
	out := make([]dto.NamespaceListItemDTO, 0, len(items))
	enriched := 0
	for _, item := range items {
		next := item
		if patch, ok := buildCachedNamespaceListRowProjection(plane, item.Name, m.EffectivePolicy(clusterName)); ok {
			mergeNamespaceRowInto(&next, patch)
			if next.RowEnriched {
				enriched++
			}
		}
		out = append(out, next)
	}
	return out, enriched
}

func (m *manager) SchedulerRunStats() SchedulerRunStatsSnapshot {
	return m.scheduler.StatsSnapshot()
}

func (m *manager) SchedulerLiveWork() SchedulerLiveWork {
	out := m.scheduler.LiveWorkSnapshot(time.Now())
	out.NamespaceSweep = m.NamespaceSweepCoverageSnapshot(time.Now().UTC())
	return out
}

func (m *manager) SearchCachedResources(_ context.Context, clusterName string, query string, limit int, offset int) (CachedResourceSearch, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return CachedResourceSearch{Active: clusterName, Query: q, Limit: limit, Offset: offset, Items: nil}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := m.cachedResourceSearchRows(clusterName, q, limit+1, offset)
	if err != nil {
		return CachedResourceSearch{}, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]CachedResourceSearchItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, CachedResourceSearchItem(row))
	}
	return CachedResourceSearch{Active: clusterName, Query: q, Limit: limit, Offset: offset, HasMore: hasMore, Items: items}, nil
}

func (m *manager) NoteUserActivity() {
	m.uiActivityUnix.Store(time.Now().UnixNano())
}

func (m *manager) activityReg() runtime.ActivityRegistry {
	if m.rt == nil {
		return nil
	}
	return m.rt.Registry()
}
