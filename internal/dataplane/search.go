package dataplane

import (
	"sort"
	"strings"
)

type CachedResourceSearch struct {
	Active  string                     `json:"active"`
	Query   string                     `json:"query"`
	Limit   int                        `json:"limit"`
	Offset  int                        `json:"offset"`
	HasMore bool                       `json:"hasMore"`
	Items   []CachedResourceSearchItem `json:"items"`
}

type CachedResourceSearchItem struct {
	Cluster    string `json:"cluster"`
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	ObservedAt string `json:"observedAt,omitempty"`
}

func (m *manager) cachedResourceSearchRows(clusterName, query string, limit, offset int) ([]dataplaneSearchRow, error) {
	rows := searchRowsMatching(m.inMemorySearchRows(clusterName), clusterName, query)

	if sp := m.currentPersistence(); sp != nil {
		persistedRows, err := sp.SearchName(clusterName, query, limit+offset+1, 0)
		if err != nil {
			return nil, err
		}
		rows = appendUniqueSearchRows(rows, persistedRows)
	}

	sortSearchRows(rows)
	if offset >= len(rows) {
		return nil, nil
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[offset:end], nil
}

func (m *manager) inMemorySearchRows(clusterName string) []dataplaneSearchRow {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	planes := make([]*clusterPlane, 0, len(m.planes))
	if clusterName != "" {
		if plane := m.planes[clusterName]; plane != nil {
			planes = append(planes, plane)
		}
	} else {
		for _, plane := range m.planes {
			planes = append(planes, plane)
		}
	}
	m.mu.RUnlock()

	var rows []dataplaneSearchRow
	for _, plane := range planes {
		rows = append(rows, plane.inMemorySearchRows()...)
	}
	return rows
}

func (p *clusterPlane) inMemorySearchRows() []dataplaneSearchRow {
	if p == nil {
		return nil
	}
	var rows []dataplaneSearchRow
	appendClusterSnapshotSearchRows(&rows, p.name, ResourceKindNamespaces, &p.nsStore)
	appendClusterSnapshotSearchRows(&rows, p.name, ResourceKindNodes, &p.nodesStore)

	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindPods, &p.podsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindDeployments, &p.depsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindServices, &p.svcsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindIngresses, &p.ingStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindPVCs, &p.pvcsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindConfigMaps, &p.cmsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindSecrets, &p.secsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindServiceAccounts, &p.saStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindRoles, &p.rolesStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindRoleBindings, &p.roleBindingsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindHelmReleases, &p.helmReleasesStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindDaemonSets, &p.dsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindStatefulSets, &p.stsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindReplicaSets, &p.rsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindJobs, &p.jobsStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindCronJobs, &p.cjStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindResourceQuotas, &p.rqStore)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindLimitRanges, &p.lrStore)
	return rows
}

func appendClusterSnapshotSearchRows[I any](rows *[]dataplaneSearchRow, cluster string, kind ResourceKind, store *snapshotStore[Snapshot[I]]) {
	snap, ok := peekClusterSnapshot(store)
	if !ok {
		return
	}
	*rows = append(*rows, searchRowsFromSnapshot(cluster, kind, "", snap)...)
}

func appendNamespacedSnapshotSearchRows[I any](rows *[]dataplaneSearchRow, cluster string, kind ResourceKind, store *namespacedSnapshotStore[Snapshot[I]]) {
	for namespace, snap := range peekAllNamespacedSnapshots(store) {
		*rows = append(*rows, searchRowsFromSnapshot(cluster, kind, namespace, snap)...)
	}
}

func searchRowsMatching(rows []dataplaneSearchRow, clusterName, query string) []dataplaneSearchRow {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return nil
	}
	out := make([]dataplaneSearchRow, 0, len(rows))
	for _, row := range rows {
		if clusterName != "" && row.Cluster != clusterName {
			continue
		}
		if !strings.Contains(strings.ToLower(row.Name), needle) {
			continue
		}
		out = append(out, row)
	}
	return out
}

func appendUniqueSearchRows(rows []dataplaneSearchRow, extra []dataplaneSearchRow) []dataplaneSearchRow {
	seen := make(map[string]struct{}, len(rows)+len(extra))
	for _, row := range rows {
		seen[searchRowDedupeKey(row)] = struct{}{}
	}
	for _, row := range extra {
		key := searchRowDedupeKey(row)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		rows = append(rows, row)
	}
	return rows
}

func searchRowDedupeKey(row dataplaneSearchRow) string {
	return strings.Join([]string{row.Cluster, row.Kind, row.Namespace, row.Name}, "\x00")
}

func sortSearchRows(rows []dataplaneSearchRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		if pi, pj := searchKindPriority(rows[i].Kind), searchKindPriority(rows[j].Kind); pi != pj {
			return pi < pj
		}
		if ni, nj := strings.ToLower(rows[i].Name), strings.ToLower(rows[j].Name); ni != nj {
			return ni < nj
		}
		if rows[i].Namespace != rows[j].Namespace {
			return rows[i].Namespace < rows[j].Namespace
		}
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].Cluster < rows[j].Cluster
	})
}
