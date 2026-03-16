package dataplane

import "context"

// ClusterDashboardSummary is a minimal, operator-focused dashboard view.
// It is intentionally small and derived from existing snapshots.
type ClusterDashboardSummary struct {
	Namespaces ClusterDashboardNamespaces `json:"namespaces"`
	Nodes      ClusterDashboardNodes      `json:"nodes"`
}

type ClusterDashboardNamespaces struct {
	Total            int    `json:"total"`
	Unhealthy        int    `json:"unhealthy"`
	Freshness        string `json:"freshness"`
	Coverage         string `json:"coverage"`
	Degradation      string `json:"degradation"`
	Completeness     string `json:"completeness"`
	State            string `json:"state"`
	ObserverState    string `json:"observerState"`
}

type ClusterDashboardNodes struct {
	Total        int    `json:"total"`
	Freshness    string `json:"freshness"`
	Coverage     string `json:"coverage"`
	Degradation  string `json:"degradation"`
	Completeness string `json:"completeness"`
	State        string `json:"state"`
	ObserverState string `json:"observerState"`
}

// DashboardSummary builds a minimal dashboard summary from cached snapshots.
func (m *manager) DashboardSummary(ctx context.Context, clusterName string) ClusterDashboardSummary {
	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)

	nsSnap, _ := plane.NamespacesSnapshot(ctx, m.scheduler, m.clients)
	nodesSnap, _ := plane.NodesSnapshot(ctx, m.scheduler, m.clients)

	// Observer states default to not_loaded when observers haven't started yet.
	nsObs := "not_loaded"
	nodeObs := "not_loaded"
	plane.obsMu.Lock()
	if plane.observers != nil {
		if plane.observers.namespacesState != "" {
			nsObs = string(plane.observers.namespacesState)
		}
		if plane.observers.nodesState != "" {
			nodeObs = string(plane.observers.nodesState)
		}
	}
	plane.obsMu.Unlock()

	var nsTotal, nsUnhealthy int
	for _, ns := range nsSnap.Items {
		nsTotal++
		if ns.HasUnhealthyConditions {
			nsUnhealthy++
		}
	}

	nsState := "unknown"
	if nsSnap.Err != nil {
		switch nsSnap.Err.Class {
		case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
			nsState = "denied"
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			nsState = "degraded"
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			nsState = "partial_proxy"
		default:
			nsState = "degraded"
		}
	} else if nsTotal == 0 {
		nsState = "empty"
	} else {
		nsState = "ok"
	}

	nodeTotal := len(nodesSnap.Items)
	nodeState := "unknown"
	if nodesSnap.Err != nil {
		switch nodesSnap.Err.Class {
		case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
			nodeState = "denied"
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			nodeState = "degraded"
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			nodeState = "partial_proxy"
		default:
			nodeState = "degraded"
		}
	} else if nodeTotal == 0 {
		nodeState = "empty"
	} else {
		nodeState = "ok"
	}

	return ClusterDashboardSummary{
		Namespaces: ClusterDashboardNamespaces{
			Total:        nsTotal,
			Unhealthy:    nsUnhealthy,
			Freshness:    string(nsSnap.Meta.Freshness),
			Coverage:     string(nsSnap.Meta.Coverage),
			Degradation:  string(nsSnap.Meta.Degradation),
			Completeness: string(nsSnap.Meta.Completeness),
			State:        nsState,
			ObserverState: nsObs,
		},
		Nodes: ClusterDashboardNodes{
			Total:        nodeTotal,
			Freshness:    string(nodesSnap.Meta.Freshness),
			Coverage:     string(nodesSnap.Meta.Coverage),
			Degradation:  string(nodesSnap.Meta.Degradation),
			Completeness: string(nodesSnap.Meta.Completeness),
			State:        nodeState,
			ObserverState: nodeObs,
		},
	}
}

