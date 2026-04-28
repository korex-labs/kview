package dataplane

import (
	"context"
	"sync"
	"time"

	kubemetrics "github.com/korex-labs/kview/v5/internal/kube/resource/metrics"
)

// MetricsCapability describes whether metrics.k8s.io is usable for a cluster.
// It merges two independent observations:
//   - Installed: discovery-level evidence that metrics-server registered the
//     API group. False here means the UI can skip metric-related widgets
//     without implying any RBAC problem.
//   - Allowed: a learned result from a previous list call, recorded in the
//     capability registry under capGroup=metrics.k8s.io. Only meaningful when
//     Installed is true; absent otherwise.
type MetricsCapability struct {
	Installed    bool      `json:"installed"`
	Allowed      bool      `json:"allowed"`
	Reason       string    `json:"reason,omitempty"`
	LastProbedAt time.Time `json:"lastProbedAt,omitempty"`
}

// metricsCapabilityCache caches discovery probes per cluster for a short
// window to keep the status endpoint cheap without hiding genuine
// installation changes for long.
type metricsCapabilityCache struct {
	mu    sync.Mutex
	store map[string]metricsCapabilityEntry
}

type metricsCapabilityEntry struct {
	installed bool
	err       error
	probedAt  time.Time
}

const metricsCapabilityTTL = 30 * time.Second

var globalMetricsCapabilityCache = &metricsCapabilityCache{
	store: make(map[string]metricsCapabilityEntry),
}

func (c *metricsCapabilityCache) get(cluster string) (metricsCapabilityEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.store[cluster]
	if !ok {
		return metricsCapabilityEntry{}, false
	}
	if time.Since(entry.probedAt) > metricsCapabilityTTL {
		return metricsCapabilityEntry{}, false
	}
	return entry, true
}

func (c *metricsCapabilityCache) put(cluster string, entry metricsCapabilityEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[cluster] = entry
}

// MetricsCapability reports whether metrics.k8s.io is installed and whether
// the current identity is allowed to list podmetrics on the cluster. This is
// designed to be cheap for the UI: a ~30s cache on discovery reuses the same
// result across tabs and avoids a fan-out of probes.
func (m *manager) MetricsCapability(ctx context.Context, clusterName string) MetricsCapability {
	out := MetricsCapability{}
	if m == nil || m.clients == nil {
		out.Reason = "dataplane unavailable"
		return out
	}

	if entry, ok := globalMetricsCapabilityCache.get(clusterName); ok {
		out.Installed = entry.installed
		out.LastProbedAt = entry.probedAt
		if entry.err != nil {
			out.Reason = entry.err.Error()
		}
	} else {
		c, _, err := m.clients.GetClientsForContext(ctx, clusterName)
		if err != nil {
			globalMetricsCapabilityCache.put(clusterName, metricsCapabilityEntry{probedAt: time.Now(), err: err})
			out.Reason = err.Error()
			out.LastProbedAt = time.Now()
			return out
		}
		probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		installed, err := kubemetrics.DetectMetricsAPI(probeCtx, c)
		cancel()
		entry := metricsCapabilityEntry{installed: installed, err: err, probedAt: time.Now()}
		globalMetricsCapabilityCache.put(clusterName, entry)
		out.Installed = installed
		out.LastProbedAt = entry.probedAt
		if err != nil {
			out.Reason = err.Error()
		}
	}

	if !out.Installed {
		if out.Reason == "" {
			out.Reason = "metrics-server not installed"
		}
		return out
	}

	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil || planeAny == nil {
		out.Reason = "plane unavailable"
		return out
	}
	plane := planeAny.(*clusterPlane)

	rec, ok := plane.capRegistry.Get(CapabilityKey{
		Cluster:       clusterName,
		ResourceGroup: kubemetrics.MetricsAPIGroup,
		Resource:      "pods",
		Verb:          "list",
		Scope:         CapabilityScopeNamespace,
		Namespace:     "",
	})
	if !ok {
		rec, ok = plane.capRegistry.Get(CapabilityKey{
			Cluster:       clusterName,
			ResourceGroup: kubemetrics.MetricsAPIGroup,
			Resource:      "nodes",
			Verb:          "list",
			Scope:         CapabilityScopeCluster,
			Namespace:     "",
		})
	}
	if !ok {
		out.Allowed = true
		out.Reason = "not probed yet"
		return out
	}

	switch rec.State {
	case CapabilityStateAllowed:
		out.Allowed = true
	case CapabilityStateDenied:
		out.Allowed = false
		out.Reason = "list denied on metrics.k8s.io"
	case CapabilityStateDegraded, CapabilityStateUnknown:
		out.Allowed = true
		out.Reason = "degraded"
	default:
		out.Allowed = true
	}
	return out
}
