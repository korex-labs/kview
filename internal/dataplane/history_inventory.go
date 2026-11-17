package dataplane

import (
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// HistoryInventory reads already-published snapshots only. It must never create
// a plane, hydrate persistence, resolve a client, or schedule a Kubernetes read.
func (m *manager) HistoryInventory(name string) localhistory.TrendCatalog {
	out := localhistory.NewTrendCatalog()
	m.mu.RLock()
	p := m.planes[name]
	m.mu.RUnlock()
	if p == nil || p.persistHydrating.Load() {
		return out
	}
	nodes, _ := peekClusterSnapshot(&p.nodesStore)
	namespaces, _ := peekClusterSnapshot(&p.nsStore)
	for _, n := range nodes.Items {
		if n.Name != "" && n.UID != "" && !n.Derived {
			if localhistory.AddTrendOption(&out.Nodes, localhistory.TrendOption{Key: localhistory.TrendNodeKey(n.Name, n.UID), Label: n.Name}) {
				out.Truncated = true
			}
		}
	}
	for _, n := range namespaces.Items {
		if n.Name != "" {
			if localhistory.AddTrendOption(&out.Namespaces, localhistory.TrendOption{Key: n.Name, Label: n.Name}) {
				out.Truncated = true
			}
		}
	}
	for rule := range dashboardSignalDefinitions {
		if localhistory.AddTrendOption(&out.Rules, localhistory.TrendOption{Key: rule, Label: rule}) {
			out.Truncated = true
		}
	}
	return out
}
