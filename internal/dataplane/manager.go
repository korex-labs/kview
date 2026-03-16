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

// manager is the foundational implementation of DataPlaneManager.
// Stage 5B keeps this intentionally narrow and synchronous.
type manager struct {
	clusterMgr *cluster.Manager
	rt         runtime.RuntimeManager

	defaultProfile       Profile
	defaultDiscoveryMode DiscoveryMode

	mu     sync.RWMutex
	planes map[string]*clusterPlane

	scheduler   *simpleScheduler
	capRegistry *CapabilityRegistry

	// First-wave raw snapshots.
	nsMu            sync.RWMutex
	namespaceCaches map[string]NamespaceSnapshot

	nodesMu      sync.RWMutex
	nodesCaches  map[string]NodesSnapshot

	obsMu      sync.Mutex
	observers  map[string]*clusterObservers
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

	return &manager{
		clusterMgr:           cfg.ClusterManager,
		rt:                   cfg.Runtime,
		defaultProfile:       profile,
		defaultDiscoveryMode: mode,
		planes:               map[string]*clusterPlane{},
		scheduler:            newSimpleScheduler(4),
		capRegistry:          NewCapabilityRegistry(),
		namespaceCaches:      make(map[string]NamespaceSnapshot),
		nodesCaches:          make(map[string]NodesSnapshot),
		observers:            make(map[string]*clusterObservers),
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
	p := &clusterPlane{
		clusterName:   clusterName,
		profile:       m.defaultProfile,
		discoveryMode: m.defaultDiscoveryMode,
		scope:         scope,
		health:        PlaneHealthUnknown,
	}
	m.planes[clusterName] = p
	return p, nil
}

// clusterPlane is a simple, metadata-only implementation of ClusterPlane for Stage 5B.
type clusterPlane struct {
	clusterName   string
	profile       Profile
	discoveryMode DiscoveryMode
	scope         ObservationScope
	health        PlaneHealth
}

func (p *clusterPlane) ClusterName() string {
	return p.clusterName
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

func (m *manager) NamespacesSnapshot(ctx context.Context, clusterName string) (NamespaceSnapshot, error) {
	key := workKey{
		Cluster:   clusterName,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindNamespaces,
		Namespace: "",
	}

	// Fast path: return cached snapshot if still warm.
	m.nsMu.RLock()
	if snap, ok := m.namespaceCaches[clusterName]; ok {
		if time.Since(snap.Meta.ObservedAt) < 15*time.Second {
			m.nsMu.RUnlock()
			return snap, nil
		}
	}
	m.nsMu.RUnlock()

	var out NamespaceSnapshot
	runErr := m.scheduler.Run(ctx, key, func(runCtx context.Context) error {
		clients, active, err := m.clusterMgr.GetClients(runCtx)
		_ = active
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

		items, err := kube.ListNamespaces(runCtx, clients)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			// Learn capabilities from this attempt.
			m.capRegistry.LearnReadResult(clusterName, "", "namespaces", "", "list", CapabilityScopeCluster, err)

			out.Meta = SnapshotMetadata{
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassCold,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		// Successful read: learn as allowed.
		m.capRegistry.LearnReadResult(clusterName, "", "namespaces", "", "list", CapabilityScopeCluster, nil)

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

	// Cache outcome (including errors) for a short period to dedupe repeated callers.
	m.nsMu.Lock()
	m.namespaceCaches[clusterName] = out
	m.nsMu.Unlock()

	return out, runErr
}

func (m *manager) NodesSnapshot(ctx context.Context, clusterName string) (NodesSnapshot, error) {
	key := workKey{
		Cluster:   clusterName,
		Class:     WorkClassSnapshot,
		Kind:      ResourceKindNodes,
		Namespace: "",
	}

	m.nodesMu.RLock()
	if snap, ok := m.nodesCaches[clusterName]; ok {
		if time.Since(snap.Meta.ObservedAt) < 30*time.Second {
			m.nodesMu.RUnlock()
			return snap, nil
		}
	}
	m.nodesMu.RUnlock()

	var out NodesSnapshot
	runErr := m.scheduler.Run(ctx, key, func(runCtx context.Context) error {
		clients, active, err := m.clusterMgr.GetClients(runCtx)
		_ = active
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

		items, err := kube.ListNodes(runCtx, clients)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			m.capRegistry.LearnReadResult(clusterName, "", "nodes", "", "list", CapabilityScopeCluster, err)

			out.Meta = SnapshotMetadata{
				ObservedAt:  time.Now().UTC(),
				Freshness:   FreshnessClassCold,
				Coverage:    CoverageClassUnknown,
				Degradation: DegradationClassMinor,
				Completeness: CompletenessClassUnknown,
			}
			return err
		}

		m.capRegistry.LearnReadResult(clusterName, "", "nodes", "", "list", CapabilityScopeCluster, nil)

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

	m.nodesMu.Lock()
	m.nodesCaches[clusterName] = out
	m.nodesMu.Unlock()

	return out, runErr
}


