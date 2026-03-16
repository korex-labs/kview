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

// Scheduler defines the minimal contract for a future work scheduler.
// Stage 5B only defines the interface without starting background work.
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
// Stage 5B keeps this intentionally narrow and synchronous.
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

	// Observers state for this cluster.
	obsMu     sync.Mutex
	observers *clusterObservers
}

func newClusterPlane(name string, profile Profile, mode DiscoveryMode, scope ObservationScope) *clusterPlane {
	return &clusterPlane{
		name:        name,
		profile:     profile,
		discoveryMode: mode,
		scope:       scope,
		health:      PlaneHealthUnknown,
		capRegistry: NewCapabilityRegistry(),
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
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassUnknown,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassUnknown,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassSevere,
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
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassCold,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "namespaces", "", "list", CapabilityScopeCluster, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:  time.Now().UTC(),
			Freshness:   FreshnessClassHot,
			Coverage:    CoverageClassFull,
			Degradation: DegradationClassNone,
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
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassUnknown,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassSevere,
				Completeness: CompletenessClassUnknown,
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = SnapshotMetadata{
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassUnknown,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassSevere,
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
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassCold,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		p.capRegistry.LearnReadResult(p.name, "", "nodes", "", "list", CapabilityScopeCluster, nil)

		out.Items = items
		out.Meta = SnapshotMetadata{
			ObservedAt:  time.Now().UTC(),
			Freshness:   FreshnessClassHot,
			Coverage:    CoverageClassFull,
			Degradation: DegradationClassNone,
			Completeness: CompletenessClassComplete,
		}
		return nil
	})

	p.nodesMu.Lock()
	p.nodes = out
	p.nodesMu.Unlock()

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

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	plane.EnsureObservers(ctx, m.scheduler, m.clients, m.rt)
}


