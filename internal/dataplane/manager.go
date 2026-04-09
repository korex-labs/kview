package dataplane

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"kview/internal/cluster"
	"kview/internal/kube"
	"kview/internal/kube/dto"
	"kview/internal/runtime"
)

// SchedulerWorkType is a marker for the type of work a scheduler might own.
type SchedulerWorkType string

const (
	SchedulerWorkTypeCapabilities SchedulerWorkType = "capabilities"
	SchedulerWorkTypeSnapshots    SchedulerWorkType = "snapshots"
	SchedulerWorkTypeProjections  SchedulerWorkType = "projections"
)

// Scheduler defines the minimal contract for future dataplane work scheduling.
// Stage 5A uses the concrete simple scheduler below for snapshot work and keeps
// this interface as an architectural boundary rather than an actively injected policy.
type Scheduler interface {
	// Enqueue signals that work of the given type should be performed for the provided scope.
	Enqueue(ctx context.Context, workType SchedulerWorkType, scope ObservationScope) error
}

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
	// MergeCachedNamespaceRowProjection overlays cached namespace row metrics onto list rows when available.
	MergeCachedNamespaceRowProjection(ctx context.Context, clusterName string, items []dto.NamespaceListItemDTO) ([]dto.NamespaceListItemDTO, int)
	// NodesSnapshot returns a raw snapshot for nodes in the given cluster.
	NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error)
	// PodsSnapshot returns a raw snapshot for pods in the given namespace.
	PodsSnapshot(ctx context.Context, clusterName, namespace string) (PodsSnapshot, error)
	// DeploymentsSnapshot returns a raw snapshot for deployments in the given namespace.
	DeploymentsSnapshot(ctx context.Context, clusterName, namespace string) (DeploymentsSnapshot, error)
	// ServicesSnapshot returns a raw snapshot for services in the given namespace.
	ServicesSnapshot(ctx context.Context, clusterName, namespace string) (ServicesSnapshot, error)
	// IngressesSnapshot returns a raw snapshot for ingresses in the given namespace.
	IngressesSnapshot(ctx context.Context, clusterName, namespace string) (IngressesSnapshot, error)
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
	// InvalidateHelmReleasesSnapshot drops the cached Helm release list for a namespace after a Helm mutation.
	InvalidateHelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) error
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
	// ResourceQuotasSnapshot returns a raw snapshot for resource quotas in the given namespace.
	ResourceQuotasSnapshot(ctx context.Context, clusterName, namespace string) (ResourceQuotasSnapshot, error)
	// LimitRangesSnapshot returns a raw snapshot for limit ranges in the given namespace.
	LimitRangesSnapshot(ctx context.Context, clusterName, namespace string) (LimitRangesSnapshot, error)

	// EnsureObservers makes sure observers are running for the given cluster.
	EnsureObservers(ctx context.Context, clusterName string)

	// DashboardSummary returns a minimal cluster dashboard backed by dataplane snapshots.
	DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary

	// ListSnapshotRevision returns revision metadata for a list cell without scheduling kube fetches.
	ListSnapshotRevision(ctx context.Context, clusterName string, kind ResourceKind, namespace string) (ListSnapshotRevisionEnvelope, error)

	// NamespaceSummaryProjection builds namespace summary from dataplane snapshots (projection-led).
	NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error)
	// NamespaceInsightsProjection builds a namespace observability view from dataplane snapshots.
	NamespaceInsightsProjection(ctx context.Context, clusterName, namespace string) (NamespaceInsightsProjection, error)

	// Policy returns the current dataplane behavior policy.
	Policy() DataplanePolicy
	// SetPolicy updates the current dataplane behavior policy for existing and future planes.
	SetPolicy(policy DataplanePolicy) DataplanePolicy

	// SchedulerRunStats returns cumulative snapshot-run durations by priority and resource kind.
	SchedulerRunStats() SchedulerRunStatsSnapshot

	// SchedulerLiveWork returns running and queued snapshot scheduler work (for operator visibility).
	SchedulerLiveWork() SchedulerLiveWork

	// SearchCachedResources returns persisted dataplane name-index matches without live Kubernetes reads.
	SearchCachedResources(ctx context.Context, clusterName string, query string, limit int, offset int) (CachedResourceSearch, error)
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

	policyMu sync.RWMutex
	policy   DataplanePolicy

	persistenceMu sync.RWMutex
	persistence   snapshotPersistence

	nsEnrich *nsEnrichmentCoordinator

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

	policy := ValidateDataplanePolicy(cfg.Policy)

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
		policy:               policy,
		nsEnrich:             newNsEnrichmentCoordinator(),
		nsSweepLast:          map[string]map[string]time.Time{},
		nsSweepHourStart:     map[string]time.Time{},
		nsSweepHourCount:     map[string]int{},
	}
	if err := m.configurePersistence(policy); err != nil {
		m.policy.Persistence.Enabled = false
	}
	return m
}

func (m *manager) Policy() DataplanePolicy {
	m.policyMu.RLock()
	policy := CloneDataplanePolicy(m.policy)
	m.policyMu.RUnlock()
	return ValidateDataplanePolicy(policy)
}

func (m *manager) SetPolicy(policy DataplanePolicy) DataplanePolicy {
	next := ValidateDataplanePolicy(policy)
	m.policyMu.Lock()
	m.policy = next
	m.policyMu.Unlock()
	if m.scheduler != nil {
		m.scheduler.setMaxPerCluster(next.BackgroundBudget.MaxConcurrentPerCluster)
		m.scheduler.configureRetries(next.BackgroundBudget.TransientRetries, 100*time.Millisecond, 1500*time.Millisecond)
		m.scheduler.configureLongRun(time.Duration(next.BackgroundBudget.LongRunNoticeSec)*time.Second, newDataplaneLongRunRecorder(m.activityReg()))
	}
	if err := m.configurePersistence(next); err != nil {
		next.Persistence.Enabled = false
		m.policyMu.Lock()
		m.policy = next
		m.policyMu.Unlock()
	}
	return next
}

func (m *manager) configurePersistence(policy DataplanePolicy) error {
	m.persistenceMu.Lock()
	if !policy.Persistence.Enabled {
		if m.persistence != nil {
			_ = m.persistence.Close()
			m.persistence = nil
		}
		m.persistenceMu.Unlock()
		return nil
	}
	if m.persistence != nil {
		m.persistenceMu.Unlock()
		m.hydratePersistedPlanes(policy)
		return nil
	}
	p, err := openBoltSnapshotPersistence("")
	if err != nil {
		m.persistenceMu.Unlock()
		return persistenceOpenError(err)
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

func (m *manager) hydratePersistedPlanes(policy DataplanePolicy) {
	sp := m.currentPersistence()
	if sp == nil {
		return
	}
	maxAge := policy.PersistenceMaxAge()
	m.mu.RLock()
	planes := make([]*clusterPlane, 0, len(m.planes))
	for _, plane := range m.planes {
		planes = append(planes, plane)
	}
	m.mu.RUnlock()
	for _, plane := range planes {
		_ = plane.hydratePersistedSnapshots(maxAge)
	}
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
	p := newClusterPlane(clusterName, m.defaultProfile, m.defaultDiscoveryMode, scope, m.Policy, m.currentPersistence)
	m.planes[clusterName] = p
	policy := m.Policy()
	if policy.Persistence.Enabled {
		_ = p.hydratePersistedSnapshots(policy.PersistenceMaxAge())
	}
	return p, nil
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
	nsStore    snapshotStore[NamespaceSnapshot]
	nodesStore snapshotStore[NodesSnapshot]

	// Namespace-scoped snapshots for first-wave resources.
	podsStore         namespacedSnapshotStore[PodsSnapshot]
	depsStore         namespacedSnapshotStore[DeploymentsSnapshot]
	svcsStore         namespacedSnapshotStore[ServicesSnapshot]
	ingStore          namespacedSnapshotStore[IngressesSnapshot]
	pvcsStore         namespacedSnapshotStore[PVCsSnapshot]
	cmsStore          namespacedSnapshotStore[ConfigMapsSnapshot]
	secsStore         namespacedSnapshotStore[SecretsSnapshot]
	saStore           namespacedSnapshotStore[ServiceAccountsSnapshot]
	rolesStore        namespacedSnapshotStore[RolesSnapshot]
	roleBindingsStore namespacedSnapshotStore[RoleBindingsSnapshot]
	helmReleasesStore namespacedSnapshotStore[HelmReleasesSnapshot]
	dsStore           namespacedSnapshotStore[DaemonSetsSnapshot]
	stsStore          namespacedSnapshotStore[StatefulSetsSnapshot]
	rsStore           namespacedSnapshotStore[ReplicaSetsSnapshot]
	jobsStore         namespacedSnapshotStore[JobsSnapshot]
	cjStore           namespacedSnapshotStore[CronJobsSnapshot]
	rqStore           namespacedSnapshotStore[ResourceQuotasSnapshot]
	lrStore           namespacedSnapshotStore[LimitRangesSnapshot]

	// Observers state for this cluster.
	obsMu     sync.Mutex
	observers *clusterObservers

	policy      func() DataplanePolicy
	persistence func() snapshotPersistence
}

func newClusterPlane(name string, profile Profile, mode DiscoveryMode, scope ObservationScope, policy func() DataplanePolicy, persistence func() snapshotPersistence) *clusterPlane {
	if policy == nil {
		policy = func() DataplanePolicy { return DefaultDataplanePolicy() }
	}
	if persistence == nil {
		persistence = func() snapshotPersistence { return nil }
	}
	return &clusterPlane{
		name:              name,
		profile:           profile,
		discoveryMode:     mode,
		scope:             scope,
		health:            PlaneHealthUnknown,
		capRegistry:       NewCapabilityRegistry(),
		podsStore:         newNamespacedSnapshotStore[PodsSnapshot](),
		depsStore:         newNamespacedSnapshotStore[DeploymentsSnapshot](),
		svcsStore:         newNamespacedSnapshotStore[ServicesSnapshot](),
		ingStore:          newNamespacedSnapshotStore[IngressesSnapshot](),
		pvcsStore:         newNamespacedSnapshotStore[PVCsSnapshot](),
		cmsStore:          newNamespacedSnapshotStore[ConfigMapsSnapshot](),
		secsStore:         newNamespacedSnapshotStore[SecretsSnapshot](),
		saStore:           newNamespacedSnapshotStore[ServiceAccountsSnapshot](),
		rolesStore:        newNamespacedSnapshotStore[RolesSnapshot](),
		roleBindingsStore: newNamespacedSnapshotStore[RoleBindingsSnapshot](),
		helmReleasesStore: newNamespacedSnapshotStore[HelmReleasesSnapshot](),
		dsStore:           newNamespacedSnapshotStore[DaemonSetsSnapshot](),
		stsStore:          newNamespacedSnapshotStore[StatefulSetsSnapshot](),
		rsStore:           newNamespacedSnapshotStore[ReplicaSetsSnapshot](),
		jobsStore:         newNamespacedSnapshotStore[JobsSnapshot](),
		cjStore:           newNamespacedSnapshotStore[CronJobsSnapshot](),
		rqStore:           newNamespacedSnapshotStore[ResourceQuotasSnapshot](),
		lrStore:           newNamespacedSnapshotStore[LimitRangesSnapshot](),
		policy:            policy,
		persistence:       persistence,
	}
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
	sp := p.currentPersistence()
	if sp == nil {
		return nil
	}
	cells, err := sp.ListSnapshots(p.name)
	if err != nil {
		return err
	}
	for _, cell := range cells {
		if cell.Namespace == "" {
			if err := p.hydratePersistedClusterSnapshot(cell.Kind, cell.Payload, maxAge); err != nil {
				return err
			}
			continue
		}
		if err := p.hydratePersistedNamespacedSnapshot(cell.Kind, cell.Namespace, cell.Payload, maxAge); err != nil {
			return err
		}
	}
	return nil
}

func (p *clusterPlane) hydratePersistedClusterSnapshot(kind ResourceKind, payload []byte, maxAge time.Duration) error {
	switch kind {
	case ResourceKindNamespaces:
		return hydratePersistedClusterSnapshotInto(&p.nsStore, payload, maxAge)
	case ResourceKindNodes:
		return hydratePersistedClusterSnapshotInto(&p.nodesStore, payload, maxAge)
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
	case ResourceKindResourceQuotas:
		return hydratePersistedNamespacedSnapshotInto(&p.rqStore, namespace, payload, maxAge)
	case ResourceKindLimitRanges:
		return hydratePersistedNamespacedSnapshotInto(&p.lrStore, namespace, payload, maxAge)
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
		setNamespacedSnapshot(store, namespace, snap)
	}
	return nil
}

// Snapshot is the shared raw snapshot container across dataplane-owned resources.
// It keeps items, truthful metadata, and an optional normalized error.
type Snapshot[I any] struct {
	Items []I
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

func (s Snapshot[I]) ObservedAt() time.Time { return s.Meta.ObservedAt }

type NamespaceSnapshot = Snapshot[dto.NamespaceListItemDTO]
type NodesSnapshot = Snapshot[dto.NodeListItemDTO]
type PodsSnapshot = Snapshot[dto.PodListItemDTO]
type DeploymentsSnapshot = Snapshot[dto.DeploymentListItemDTO]
type ServicesSnapshot = Snapshot[dto.ServiceListItemDTO]
type IngressesSnapshot = Snapshot[dto.IngressListItemDTO]
type PVCsSnapshot = Snapshot[dto.PersistentVolumeClaimDTO]
type ConfigMapsSnapshot = Snapshot[dto.ConfigMapDTO]
type SecretsSnapshot = Snapshot[dto.SecretDTO]
type ServiceAccountsSnapshot = Snapshot[dto.ServiceAccountListItemDTO]
type RolesSnapshot = Snapshot[dto.RoleListItemDTO]
type RoleBindingsSnapshot = Snapshot[dto.RoleBindingListItemDTO]
type HelmReleasesSnapshot = Snapshot[dto.HelmReleaseDTO]
type DaemonSetsSnapshot = Snapshot[dto.DaemonSetDTO]
type StatefulSetsSnapshot = Snapshot[dto.StatefulSetDTO]
type ReplicaSetsSnapshot = Snapshot[dto.ReplicaSetDTO]
type JobsSnapshot = Snapshot[dto.JobDTO]
type CronJobsSnapshot = Snapshot[dto.CronJobDTO]
type ResourceQuotasSnapshot = Snapshot[dto.ResourceQuotaDTO]
type LimitRangesSnapshot = Snapshot[dto.LimitRangeDTO]

// NamespacesSnapshot returns a raw snapshot for namespaces plus metadata and any normalized error.
func (p *clusterPlane) NamespacesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NamespaceSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NamespaceListItemDTO]{
		kind:        ResourceKindNamespaces,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindNamespaces),
		capGroup:    "",
		capResource: "namespaces",
		capScope:    CapabilityScopeCluster,
		fetch:       kube.ListNamespaces,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.nsStore, desc)
}

// NodesSnapshot returns a raw snapshot for nodes plus metadata and any normalized error.
func (p *clusterPlane) NodesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NodesSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NodeListItemDTO]{
		kind:        ResourceKindNodes,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindNodes),
		capGroup:    "",
		capResource: "nodes",
		capScope:    CapabilityScopeCluster,
		fetch:       kube.ListNodes,
	}
	return executeClusterSnapshot(p, ctx, sched, prio, clients, &p.nodesStore, desc)
}

// PodsSnapshot returns a raw snapshot for pods in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PodsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (PodsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.PodListItemDTO]{
		kind:        ResourceKindPods,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindPods),
		capGroup:    "",
		capResource: "pods",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListPods,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.podsStore, desc)
}

// DeploymentsSnapshot returns a raw snapshot for deployments in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DeploymentsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (DeploymentsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.DeploymentListItemDTO]{
		kind:        ResourceKindDeployments,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindDeployments),
		capGroup:    "",
		capResource: "deployments",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListDeployments,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.depsStore, desc)
}

// ServicesSnapshot returns a raw snapshot for services in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ServicesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ServicesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ServiceListItemDTO]{
		kind:        ResourceKindServices,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindServices),
		capGroup:    "",
		capResource: "services",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListServices,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.svcsStore, desc)
}

// IngressesSnapshot returns a raw snapshot for ingresses in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) IngressesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (IngressesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.IngressListItemDTO]{
		kind:        ResourceKindIngresses,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindIngresses),
		capGroup:    "networking.k8s.io",
		capResource: "ingresses",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListIngresses,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.ingStore, desc)
}

// PVCsSnapshot returns a raw snapshot for PVCs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PVCsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (PVCsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.PersistentVolumeClaimDTO]{
		kind:        ResourceKindPVCs,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindPVCs),
		capGroup:    "",
		capResource: "persistentvolumeclaims",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListPersistentVolumeClaims,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.pvcsStore, desc)
}

// ConfigMapsSnapshot returns a raw snapshot for configmaps in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ConfigMapsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ConfigMapsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ConfigMapDTO]{
		kind:        ResourceKindConfigMaps,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindConfigMaps),
		capGroup:    "",
		capResource: "configmaps",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListConfigMaps,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.cmsStore, desc)
}

// SecretsSnapshot returns a raw snapshot for secrets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) SecretsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (SecretsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.SecretDTO]{
		kind:        ResourceKindSecrets,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindSecrets),
		capGroup:    "",
		capResource: "secrets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListSecrets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.secsStore, desc)
}

// ServiceAccountsSnapshot returns a raw snapshot for serviceaccounts in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ServiceAccountsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ServiceAccountsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ServiceAccountListItemDTO]{
		kind:        ResourceKindServiceAccounts,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindServiceAccounts),
		capGroup:    "",
		capResource: "serviceaccounts",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListServiceAccounts,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.saStore, desc)
}

// RolesSnapshot returns a raw snapshot for roles in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) RolesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (RolesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.RoleListItemDTO]{
		kind:        ResourceKindRoles,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindRoles),
		capGroup:    "rbac.authorization.k8s.io",
		capResource: "roles",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListRoles,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rolesStore, desc)
}

// RoleBindingsSnapshot returns a raw snapshot for rolebindings in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) RoleBindingsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (RoleBindingsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.RoleBindingListItemDTO]{
		kind:        ResourceKindRoleBindings,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindRoleBindings),
		capGroup:    "rbac.authorization.k8s.io",
		capResource: "rolebindings",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListRoleBindings,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.roleBindingsStore, desc)
}

// HelmReleasesSnapshot returns a raw snapshot for Helm releases in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) HelmReleasesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (HelmReleasesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.HelmReleaseDTO]{
		kind:        ResourceKindHelmReleases,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindHelmReleases),
		capGroup:    "",
		capResource: "secrets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListHelmReleases,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.helmReleasesStore, desc)
}

// DaemonSetsSnapshot returns a raw snapshot for daemonsets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DaemonSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (DaemonSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.DaemonSetDTO]{
		kind:        ResourceKindDaemonSets,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindDaemonSets),
		capGroup:    "",
		capResource: "daemonsets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListDaemonSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.dsStore, desc)
}

// StatefulSetsSnapshot returns a raw snapshot for statefulsets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) StatefulSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (StatefulSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.StatefulSetDTO]{
		kind:        ResourceKindStatefulSets,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindStatefulSets),
		capGroup:    "",
		capResource: "statefulsets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListStatefulSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.stsStore, desc)
}

// ReplicaSetsSnapshot returns a raw snapshot for replicasets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ReplicaSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ReplicaSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ReplicaSetDTO]{
		kind:        ResourceKindReplicaSets,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindReplicaSets),
		capGroup:    "",
		capResource: "replicasets",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListReplicaSets,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rsStore, desc)
}

// JobsSnapshot returns a raw snapshot for jobs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) JobsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (JobsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.JobDTO]{
		kind:        ResourceKindJobs,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindJobs),
		capGroup:    "batch",
		capResource: "jobs",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListJobs,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.jobsStore, desc)
}

// CronJobsSnapshot returns a raw snapshot for cronjobs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) CronJobsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (CronJobsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.CronJobDTO]{
		kind:        ResourceKindCronJobs,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindCronJobs),
		capGroup:    "batch",
		capResource: "cronjobs",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListCronJobs,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.cjStore, desc)
}

// ResourceQuotasSnapshot returns a raw snapshot for resource quotas in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ResourceQuotasSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (ResourceQuotasSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.ResourceQuotaDTO]{
		kind:        ResourceKindResourceQuotas,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindResourceQuotas),
		capGroup:    "",
		capResource: "resourcequotas",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListResourceQuotaItems,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.rqStore, desc)
}

// LimitRangesSnapshot returns a raw snapshot for limit ranges in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) LimitRangesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (LimitRangesSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.LimitRangeDTO]{
		kind:        ResourceKindLimitRanges,
		ttl:         p.currentPolicy().SnapshotTTL(ResourceKindLimitRanges),
		capGroup:    "",
		capResource: "limitranges",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListLimitRanges,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.lrStore, desc)
}

func (m *manager) NamespacesSnapshot(ctx context.Context, clusterName string) (NamespaceSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NamespacesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NodesSnapshot(ctx, m.scheduler, m.clients, WorkPriorityCritical)
}

func (m *manager) PodsSnapshot(ctx context.Context, clusterName, namespace string) (PodsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) DeploymentsSnapshot(ctx context.Context, clusterName, namespace string) (DeploymentsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ServicesSnapshot(ctx context.Context, clusterName, namespace string) (ServicesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) IngressesSnapshot(ctx context.Context, clusterName, namespace string) (IngressesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) PVCsSnapshot(ctx context.Context, clusterName, namespace string) (PVCsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) (ConfigMapsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) SecretsSnapshot(ctx context.Context, clusterName, namespace string) (SecretsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ServiceAccountsSnapshot(ctx context.Context, clusterName, namespace string) (ServiceAccountsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ServiceAccountsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) RolesSnapshot(ctx context.Context, clusterName, namespace string) (RolesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.RolesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) RoleBindingsSnapshot(ctx context.Context, clusterName, namespace string) (RoleBindingsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.RoleBindingsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) HelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) (HelmReleasesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.HelmReleasesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) InvalidateHelmReleasesSnapshot(ctx context.Context, clusterName, namespace string) error {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return err
	}
	plane := planeAny.(*clusterPlane)
	clearNamespacedSnapshot(&plane.helmReleasesStore, namespace)
	if sp := plane.currentPersistence(); sp != nil {
		_ = sp.Delete(clusterName, ResourceKindHelmReleases, namespace)
	}
	return nil
}

func (m *manager) DaemonSetsSnapshot(ctx context.Context, clusterName, namespace string) (DaemonSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) StatefulSetsSnapshot(ctx context.Context, clusterName, namespace string) (StatefulSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ReplicaSetsSnapshot(ctx context.Context, clusterName, namespace string) (ReplicaSetsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) JobsSnapshot(ctx context.Context, clusterName, namespace string) (JobsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) CronJobsSnapshot(ctx context.Context, clusterName, namespace string) (CronJobsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) ResourceQuotasSnapshot(ctx context.Context, clusterName, namespace string) (ResourceQuotasSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ResourceQuotasSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) LimitRangesSnapshot(ctx context.Context, clusterName, namespace string) (LimitRangesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.LimitRangesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityCritical)
}

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	plane.EnsureObservers(ctx, m.scheduler, m.clients, m.rt)
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
		if cached, ok := buildCachedNamespaceListRowProjection(plane, item.Name); ok {
			mergeNamespaceRowInto(&next, cached)
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
	return m.scheduler.LiveWorkSnapshot(time.Now())
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
		items = append(items, CachedResourceSearchItem{
			Cluster:    row.Cluster,
			Kind:       row.Kind,
			Namespace:  row.Namespace,
			Name:       row.Name,
			ObservedAt: row.ObservedAt,
		})
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
