package dataplane

import (
	"context"
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

	// EnsureObservers makes sure observers are running for the given cluster.
	EnsureObservers(ctx context.Context, clusterName string)

	// DashboardSummary returns a minimal cluster dashboard backed by dataplane snapshots.
	DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary

	// ListSnapshotRevision returns revision metadata for a list cell without scheduling kube fetches.
	ListSnapshotRevision(ctx context.Context, clusterName string, kind ResourceKind, namespace string) (ListSnapshotRevisionEnvelope, error)

	// NamespaceSummaryProjection builds namespace summary from dataplane snapshots (projection-led).
	NamespaceSummaryProjection(ctx context.Context, clusterName, namespace string) (NamespaceSummaryProjection, error)

	// SchedulerRunStats returns cumulative snapshot-run durations by priority and resource kind.
	SchedulerRunStats() SchedulerRunStatsSnapshot

	// SchedulerLiveWork returns running and queued snapshot scheduler work (for operator visibility).
	SchedulerLiveWork() SchedulerLiveWork
}

// ManagerConfig describes construction-time parameters for the data plane manager.
type ManagerConfig struct {
	ClusterManager *cluster.Manager

	Runtime runtime.RuntimeManager

	// Profile is the system-wide default profile. If empty, ProfileFocused is used.
	Profile Profile
	// DiscoveryMode is the system-wide default discovery mode. If empty, DiscoveryModeTargeted is used.
	DiscoveryMode DiscoveryMode
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

	nsEnrich *nsEnrichmentCoordinator

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

	sched := newWorkScheduler(4)
	if cfg.Runtime != nil {
		reg := cfg.Runtime.Registry()
		sched.configureLongRun(2*time.Second, newDataplaneLongRunRecorder(reg))
	}
	return &manager{
		rt:                   cfg.Runtime,
		defaultProfile:       profile,
		defaultDiscoveryMode: mode,
		planes:               map[string]*clusterPlane{},
		scheduler:            sched,
		clients:              cp,
		nsEnrich:             newNsEnrichmentCoordinator(),
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
	p := newClusterPlane(clusterName, m.defaultProfile, m.defaultDiscoveryMode, scope)
	m.planes[clusterName] = p
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
	podsStore namespacedSnapshotStore[PodsSnapshot]
	depsStore namespacedSnapshotStore[DeploymentsSnapshot]
	svcsStore namespacedSnapshotStore[ServicesSnapshot]
	ingStore  namespacedSnapshotStore[IngressesSnapshot]
	pvcsStore namespacedSnapshotStore[PVCsSnapshot]
	cmsStore  namespacedSnapshotStore[ConfigMapsSnapshot]
	secsStore namespacedSnapshotStore[SecretsSnapshot]
	saStore   namespacedSnapshotStore[ServiceAccountsSnapshot]
	dsStore   namespacedSnapshotStore[DaemonSetsSnapshot]
	stsStore  namespacedSnapshotStore[StatefulSetsSnapshot]
	rsStore   namespacedSnapshotStore[ReplicaSetsSnapshot]
	jobsStore namespacedSnapshotStore[JobsSnapshot]
	cjStore   namespacedSnapshotStore[CronJobsSnapshot]

	// Observers state for this cluster.
	obsMu     sync.Mutex
	observers *clusterObservers
}

func newClusterPlane(name string, profile Profile, mode DiscoveryMode, scope ObservationScope) *clusterPlane {
	return &clusterPlane{
		name:          name,
		profile:       profile,
		discoveryMode: mode,
		scope:         scope,
		health:        PlaneHealthUnknown,
		capRegistry:   NewCapabilityRegistry(),
		podsStore:     newNamespacedSnapshotStore[PodsSnapshot](),
		depsStore:     newNamespacedSnapshotStore[DeploymentsSnapshot](),
		svcsStore:     newNamespacedSnapshotStore[ServicesSnapshot](),
		ingStore:      newNamespacedSnapshotStore[IngressesSnapshot](),
		pvcsStore:     newNamespacedSnapshotStore[PVCsSnapshot](),
		cmsStore:      newNamespacedSnapshotStore[ConfigMapsSnapshot](),
		secsStore:     newNamespacedSnapshotStore[SecretsSnapshot](),
		saStore:       newNamespacedSnapshotStore[ServiceAccountsSnapshot](),
		dsStore:       newNamespacedSnapshotStore[DaemonSetsSnapshot](),
		stsStore:      newNamespacedSnapshotStore[StatefulSetsSnapshot](),
		rsStore:       newNamespacedSnapshotStore[ReplicaSetsSnapshot](),
		jobsStore:     newNamespacedSnapshotStore[JobsSnapshot](),
		cjStore:       newNamespacedSnapshotStore[CronJobsSnapshot](),
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
type DaemonSetsSnapshot = Snapshot[dto.DaemonSetDTO]
type StatefulSetsSnapshot = Snapshot[dto.StatefulSetDTO]
type ReplicaSetsSnapshot = Snapshot[dto.ReplicaSetDTO]
type JobsSnapshot = Snapshot[dto.JobDTO]
type CronJobsSnapshot = Snapshot[dto.CronJobDTO]

// NamespacesSnapshot returns a raw snapshot for namespaces plus metadata and any normalized error.
func (p *clusterPlane) NamespacesSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, prio WorkPriority) (NamespaceSnapshot, error) {
	desc := clusterSnapshotDescriptor[dto.NamespaceListItemDTO]{
		kind:        ResourceKindNamespaces,
		ttl:         15 * time.Second,
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
		ttl:         30 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
		capGroup:    "",
		capResource: "serviceaccounts",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListServiceAccounts,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.saStore, desc)
}

// DaemonSetsSnapshot returns a raw snapshot for daemonsets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DaemonSetsSnapshot(ctx context.Context, sched *workScheduler, clients ClientsProvider, namespace string, prio WorkPriority) (DaemonSetsSnapshot, error) {
	desc := namespacedSnapshotDescriptor[dto.DaemonSetDTO]{
		kind:        ResourceKindDaemonSets,
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
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
		ttl:         15 * time.Second,
		capGroup:    "batch",
		capResource: "cronjobs",
		capScope:    CapabilityScopeNamespace,
		fetch:       kube.ListCronJobs,
	}
	return executeNamespacedSnapshot(p, ctx, sched, prio, clients, namespace, &p.cjStore, desc)
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

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	plane.EnsureObservers(ctx, m.scheduler, m.clients, m.rt)
}

func (m *manager) SchedulerRunStats() SchedulerRunStatsSnapshot {
	return m.scheduler.StatsSnapshot()
}

func (m *manager) SchedulerLiveWork() SchedulerLiveWork {
	return m.scheduler.LiveWorkSnapshot(time.Now())
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
