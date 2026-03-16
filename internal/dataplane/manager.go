package dataplane

import (
	"context"
	"sync"

	"kview/internal/cluster"
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
}

// ManagerConfig describes construction-time parameters for the data plane manager.
type ManagerConfig struct {
	ClusterManager *cluster.Manager

	// Profile is the system-wide default profile. If empty, ProfileFocused is used.
	Profile Profile
	// DiscoveryMode is the system-wide default discovery mode. If empty, DiscoveryModeTargeted is used.
	DiscoveryMode DiscoveryMode
}

// manager is the foundational implementation of DataPlaneManager.
// Stage 5B keeps this intentionally narrow and synchronous.
type manager struct {
	clusterMgr *cluster.Manager

	defaultProfile       Profile
	defaultDiscoveryMode DiscoveryMode

	mu     sync.RWMutex
	planes map[string]*clusterPlane
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
		clusterMgr:          cfg.ClusterManager,
		defaultProfile:      profile,
		defaultDiscoveryMode: mode,
		planes:              map[string]*clusterPlane{},
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

