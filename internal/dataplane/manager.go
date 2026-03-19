package dataplane

import (
	"context"
	"sync"
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

	// EnsureObservers makes sure observers are running for the given cluster.
	EnsureObservers(ctx context.Context, clusterName string)

	// DashboardSummary returns a minimal cluster dashboard backed by dataplane snapshots.
	DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary
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

// manager is the foundational implementation of DataPlaneManager.
// Stage 5A keeps it intentionally narrow: per-cluster planes, scheduler-mediated
// snapshot reads, namespace summary projection, and observer lifecycle tracking.
type manager struct {
	rt runtime.RuntimeManager

	defaultProfile       Profile
	defaultDiscoveryMode DiscoveryMode

	mu     sync.RWMutex
	planes map[string]*clusterPlane

	scheduler *simpleScheduler
	clients   ClientsProvider
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

	return &manager{
		rt:                   cfg.Runtime,
		defaultProfile:       profile,
		defaultDiscoveryMode: mode,
		planes:               map[string]*clusterPlane{},
		scheduler:            newSimpleScheduler(4),
		clients:              cp,
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
	nsMu sync.RWMutex
	ns   NamespaceSnapshot

	nodesMu sync.RWMutex
	nodes   NodesSnapshot

	// Namespace-scoped snapshots for first-wave resources.
	podsMu sync.RWMutex
	pods   map[string]PodsSnapshot

	depsMu sync.RWMutex
	deps   map[string]DeploymentsSnapshot

	svcsMu sync.RWMutex
	svcs   map[string]ServicesSnapshot

	ingMu sync.RWMutex
	ing   map[string]IngressesSnapshot

	pvcsMu sync.RWMutex
	pvcs   map[string]PVCsSnapshot

	cmsMu sync.RWMutex
	cms   map[string]ConfigMapsSnapshot

	secMu sync.RWMutex
	secs  map[string]SecretsSnapshot

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
		pods:          make(map[string]PodsSnapshot),
		deps:          make(map[string]DeploymentsSnapshot),
		svcs:          make(map[string]ServicesSnapshot),
		ing:           make(map[string]IngressesSnapshot),
		pvcs:          make(map[string]PVCsSnapshot),
		cms:           make(map[string]ConfigMapsSnapshot),
		secs:          make(map[string]SecretsSnapshot),
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

// NamespaceSnapshot is a raw snapshot of namespaces plus metadata and any normalized error.
type NamespaceSnapshot struct {
	Items []dto.NamespaceListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// NodesSnapshot is a raw snapshot of nodes plus metadata and any normalized error.
type NodesSnapshot struct {
	Items []dto.NodeListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// PodsSnapshot is a raw snapshot of pods in a namespace plus metadata and any normalized error.
type PodsSnapshot struct {
	Items []dto.PodListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// DeploymentsSnapshot is a raw snapshot of deployments in a namespace plus metadata and any normalized error.
type DeploymentsSnapshot struct {
	Items []dto.DeploymentListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// ServicesSnapshot is a raw snapshot of services in a namespace plus metadata and any normalized error.
type ServicesSnapshot struct {
	Items []dto.ServiceListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// IngressesSnapshot is a raw snapshot of ingresses in a namespace plus metadata and any normalized error.
type IngressesSnapshot struct {
	Items []dto.IngressListItemDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// PVCsSnapshot is a raw snapshot of persistent volume claims in a namespace plus metadata and any normalized error.
type PVCsSnapshot struct {
	Items []dto.PersistentVolumeClaimDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// ConfigMapsSnapshot is a raw snapshot of configmaps in a namespace plus metadata and any normalized error.
type ConfigMapsSnapshot struct {
	Items []dto.ConfigMapDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// SecretsSnapshot is a raw snapshot of secrets in a namespace plus metadata and any normalized error.
type SecretsSnapshot struct {
	Items []dto.SecretDTO
	Meta  SnapshotMetadata
	Err   *NormalizedError
}

// NamespacesSnapshot returns a raw snapshot for namespaces plus metadata and any normalized error.
func (p *clusterPlane) NamespacesSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider) (NamespaceSnapshot, error) {
	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindNamespaces,
		Namespace: "",
	}

	p.nsMu.RLock()
	if time.Since(p.ns.Meta.ObservedAt) < 15*time.Second && !p.ns.Meta.ObservedAt.IsZero() {
		snap := p.ns
		p.nsMu.RUnlock()
		return snap, nil
	}
	p.nsMu.RUnlock()

	var out NamespaceSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		items, err := kube.ListNamespaces(runCtx, c)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "namespaces", "", "list", CapabilityScopeCluster, err)
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassCold,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "namespaces", "", "list", CapabilityScopeCluster, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		}
		return nil
	})

	p.nsMu.Lock()
	p.ns = out
	p.nsMu.Unlock()

	return out, runErr
}

// NodesSnapshot returns a raw snapshot for nodes plus metadata and any normalized error.
func (p *clusterPlane) NodesSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider) (NodesSnapshot, error) {
	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindNodes,
		Namespace: "",
	}

	p.nodesMu.RLock()
	if time.Since(p.nodes.Meta.ObservedAt) < 30*time.Second && !p.nodes.Meta.ObservedAt.IsZero() {
		snap := p.nodes
		p.nodesMu.RUnlock()
		return snap, nil
	}
	p.nodesMu.RUnlock()

	var out NodesSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		items, err := kube.ListNodes(runCtx, c)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "nodes", "", "list", CapabilityScopeCluster, err)
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassCold,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "nodes", "", "list", CapabilityScopeCluster, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		}
		return nil
	})

	p.nodesMu.Lock()
	p.nodes = out
	p.nodesMu.Unlock()

	return out, runErr
}

// PodsSnapshot returns a raw snapshot for pods in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PodsSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (PodsSnapshot, error) {
	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindPods,
		Namespace: namespace,
	}

	p.podsMu.RLock()
	if snap, ok := p.pods[namespace]; ok && !snap.Meta.ObservedAt.IsZero() &&
		time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.podsMu.RUnlock()
		return snap, nil
	}
	p.podsMu.RUnlock()

	var out PodsSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		items, err := kube.ListPods(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "pods", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassCold,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "pods", namespace, "list", CapabilityScopeNamespace, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		}
		return nil
	})

	p.podsMu.Lock()
	p.pods[namespace] = out
	p.podsMu.Unlock()

	return out, runErr
}

// DeploymentsSnapshot returns a raw snapshot for deployments in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) DeploymentsSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (DeploymentsSnapshot, error) {
	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindDeployments,
		Namespace: namespace,
	}

	p.depsMu.RLock()
	if snap, ok := p.deps[namespace]; ok && !snap.Meta.ObservedAt.IsZero() &&
		time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.depsMu.RUnlock()
		return snap, nil
	}
	p.depsMu.RUnlock()

	var out DeploymentsSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassUnknown,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		items, err := kube.ListDeployments(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "deployments", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{
				ObservedAt:   time.Now().UTC(),
				Freshness:    FreshnessClassCold,
				Coverage:     CoverageClassUnknown,
				Degradation:  DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "deployments", namespace, "list", CapabilityScopeNamespace, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:   time.Now().UTC(),
			Freshness:    FreshnessClassHot,
			Coverage:     CoverageClassFull,
			Degradation:  DegradationClassNone,
			Completeness: CompletenessClassComplete,
		}
		return nil
	})

	p.depsMu.Lock()
	p.deps[namespace] = out
	p.depsMu.Unlock()

	return out, runErr
}

// ServicesSnapshot returns a raw snapshot for services in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ServicesSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (ServicesSnapshot, error) {
	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: ResourceKindServices, Namespace: namespace}
	p.svcsMu.RLock()
	if snap, ok := p.svcs[namespace]; ok && !snap.Meta.ObservedAt.IsZero() && time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.svcsMu.RUnlock()
		return snap, nil
	}
	p.svcsMu.RUnlock()

	var out ServicesSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return nil
		}
		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return err
		}
		items, err := kube.ListServices(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "services", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassCold, Coverage: CoverageClassUnknown, Degradation: DegradationClassMinor, Completeness: CompletenessClassUnknown}
			return err
		}
		p.capRegistry.LearnReadResult(p.name, "", "services", namespace, "list", CapabilityScopeNamespace, nil)
		out.Items = items
		out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Degradation: DegradationClassNone, Completeness: CompletenessClassComplete}
		return nil
	})

	p.svcsMu.Lock()
	p.svcs[namespace] = out
	p.svcsMu.Unlock()
	return out, runErr
}

// IngressesSnapshot returns a raw snapshot for ingresses in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) IngressesSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (IngressesSnapshot, error) {
	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: ResourceKindIngresses, Namespace: namespace}
	p.ingMu.RLock()
	if snap, ok := p.ing[namespace]; ok && !snap.Meta.ObservedAt.IsZero() && time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.ingMu.RUnlock()
		return snap, nil
	}
	p.ingMu.RUnlock()

	var out IngressesSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return nil
		}
		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return err
		}
		items, err := kube.ListIngresses(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "networking.k8s.io", "ingresses", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassCold, Coverage: CoverageClassUnknown, Degradation: DegradationClassMinor, Completeness: CompletenessClassUnknown}
			return err
		}
		p.capRegistry.LearnReadResult(p.name, "networking.k8s.io", "ingresses", namespace, "list", CapabilityScopeNamespace, nil)
		out.Items = items
		out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Degradation: DegradationClassNone, Completeness: CompletenessClassComplete}
		return nil
	})

	p.ingMu.Lock()
	p.ing[namespace] = out
	p.ingMu.Unlock()
	return out, runErr
}

// PVCsSnapshot returns a raw snapshot for PVCs in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) PVCsSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (PVCsSnapshot, error) {
	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: ResourceKindPVCs, Namespace: namespace}
	p.pvcsMu.RLock()
	if snap, ok := p.pvcs[namespace]; ok && !snap.Meta.ObservedAt.IsZero() && time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.pvcsMu.RUnlock()
		return snap, nil
	}
	p.pvcsMu.RUnlock()

	var out PVCsSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return nil
		}
		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return err
		}
		items, err := kube.ListPersistentVolumeClaims(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "persistentvolumeclaims", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassCold, Coverage: CoverageClassUnknown, Degradation: DegradationClassMinor, Completeness: CompletenessClassUnknown}
			return err
		}
		p.capRegistry.LearnReadResult(p.name, "", "persistentvolumeclaims", namespace, "list", CapabilityScopeNamespace, nil)
		out.Items = items
		out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Degradation: DegradationClassNone, Completeness: CompletenessClassComplete}
		return nil
	})

	p.pvcsMu.Lock()
	p.pvcs[namespace] = out
	p.pvcsMu.Unlock()
	return out, runErr
}

// ConfigMapsSnapshot returns a raw snapshot for configmaps in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) ConfigMapsSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (ConfigMapsSnapshot, error) {
	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: ResourceKindConfigMaps, Namespace: namespace}
	p.cmsMu.RLock()
	if snap, ok := p.cms[namespace]; ok && !snap.Meta.ObservedAt.IsZero() && time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.cmsMu.RUnlock()
		return snap, nil
	}
	p.cmsMu.RUnlock()

	var out ConfigMapsSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return nil
		}
		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return err
		}
		items, err := kube.ListConfigMaps(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "configmaps", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassCold, Coverage: CoverageClassUnknown, Degradation: DegradationClassMinor, Completeness: CompletenessClassUnknown}
			return err
		}
		p.capRegistry.LearnReadResult(p.name, "", "configmaps", namespace, "list", CapabilityScopeNamespace, nil)
		out.Items = items
		out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Degradation: DegradationClassNone, Completeness: CompletenessClassComplete}
		return nil
	})

	p.cmsMu.Lock()
	p.cms[namespace] = out
	p.cmsMu.Unlock()
	return out, runErr
}

// SecretsSnapshot returns a raw snapshot for secrets in the given namespace plus metadata and any normalized error.
func (p *clusterPlane) SecretsSnapshot(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, namespace string) (SecretsSnapshot, error) {
	key := workKey{Cluster: p.name, Class: WorkClassSnapshot, Kind: ResourceKindSecrets, Namespace: namespace}
	p.secMu.RLock()
	if snap, ok := p.secs[namespace]; ok && !snap.Meta.ObservedAt.IsZero() && time.Since(snap.Meta.ObservedAt) < 15*time.Second {
		p.secMu.RUnlock()
		return snap, nil
	}
	p.secMu.RUnlock()

	var out SecretsSnapshot
	runErr := sched.Run(ctx, key, func(runCtx context.Context) error {
		if clients == nil {
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return nil
		}
		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassUnknown, Coverage: CoverageClassUnknown, Degradation: DegradationClassSevere, Completeness: CompletenessClassUnknown}
			return err
		}
		items, err := kube.ListSecrets(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			p.capRegistry.LearnReadResult(p.name, "", "secrets", namespace, "list", CapabilityScopeNamespace, err)
			out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassCold, Coverage: CoverageClassUnknown, Degradation: DegradationClassMinor, Completeness: CompletenessClassUnknown}
			return err
		}
		p.capRegistry.LearnReadResult(p.name, "", "secrets", namespace, "list", CapabilityScopeNamespace, nil)
		out.Items = items
		out.Meta = SnapshotMetadata{ObservedAt: time.Now().UTC(), Freshness: FreshnessClassHot, Coverage: CoverageClassFull, Degradation: DegradationClassNone, Completeness: CompletenessClassComplete}
		return nil
	})

	p.secMu.Lock()
	p.secs[namespace] = out
	p.secMu.Unlock()
	return out, runErr
}

func (m *manager) NamespacesSnapshot(ctx context.Context, clusterName string) (NamespaceSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NamespacesSnapshot(ctx, m.scheduler, m.clients)
}

func (m *manager) NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.NodesSnapshot(ctx, m.scheduler, m.clients)
}

func (m *manager) PodsSnapshot(ctx context.Context, clusterName, namespace string) (PodsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) DeploymentsSnapshot(ctx context.Context, clusterName, namespace string) (DeploymentsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) ServicesSnapshot(ctx context.Context, clusterName, namespace string) (ServicesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) IngressesSnapshot(ctx context.Context, clusterName, namespace string) (IngressesSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) PVCsSnapshot(ctx context.Context, clusterName, namespace string) (PVCsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) ConfigMapsSnapshot(ctx context.Context, clusterName, namespace string) (ConfigMapsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) SecretsSnapshot(ctx context.Context, clusterName, namespace string) (SecretsSnapshot, error) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	return plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace)
}

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	plane.EnsureObservers(ctx, m.scheduler, m.clients, m.rt)
}
