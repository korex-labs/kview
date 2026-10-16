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
	Cluster        string `json:"cluster"`
	Kind           string `json:"kind"`
	Namespace      string `json:"namespace,omitempty"`
	Name           string `json:"name"`
	ObservedAt     string `json:"observedAt,omitempty"`
	HealthBucket   string `json:"healthBucket,omitempty"`
	ListStatus     string `json:"listStatus,omitempty"`
	SignalSeverity string `json:"signalSeverity,omitempty"`
	SignalCount    int    `json:"signalCount,omitempty"`
	NeedsAttention bool   `json:"needsAttention,omitempty"`
	MatchReason    string `json:"matchReason,omitempty"`
}

func (m *manager) cachedResourceSearchRows(clusterName, query string, limit, offset int, scopes ...SearchScope) ([]dataplaneSearchRow, error) {
	scope := effectiveSearchScope(query, scopes)
	// Keep every RAM identity until after deduplication: a newer nonmatching
	// row must still shadow a stale matching persisted row.
	rows := m.inMemorySearchRows(clusterName, scope)

	if sp := m.currentPersistence(); sp != nil {
		// At most len(rows) persisted matches can be shadowed by RAM;
		// overfetch those slots so filtering cannot leave a short page.
		persistedRows, err := sp.SearchName(clusterName, query, limit+offset+1+len(rows), 0, scope)
		if err != nil {
			return nil, err
		}
		rows = appendUniqueSearchRows(rows, persistedRows)
	}

	rows = searchRowsMatching(rows, clusterName, query)
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

func (m *manager) inMemorySearchRows(clusterName string, scopes ...SearchScope) []dataplaneSearchRow {
	var scope SearchScope
	if len(scopes) > 0 {
		scope = scopes[0]
	}
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
		rows = append(rows, plane.inMemorySearchRows(scope)...)
	}
	return rows
}

func (p *clusterPlane) inMemorySearchRows(scopes ...SearchScope) []dataplaneSearchRow {
	var scope SearchScope
	if len(scopes) > 0 {
		scope = scopes[0]
	}
	if p == nil {
		return nil
	}
	var rows []dataplaneSearchRow
	appendClusterSnapshotSearchRows(&rows, p.name, ResourceKindNamespaces, &p.nsStore, scope)
	appendClusterSnapshotSearchRows(&rows, p.name, ResourceKindNodes, &p.nodesStore, scope)
	appendClusterSnapshotSearchRows(&rows, p.name, ResourceKindClusterCustomResources, &p.clusterCustomResourcesStore, scope)

	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindPods, &p.podsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindCustomResources, &p.customResourcesStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindDeployments, &p.depsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindServices, &p.svcsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindIngresses, &p.ingStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindNetworkPolicies, &p.networkPoliciesStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindPVCs, &p.pvcsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindConfigMaps, &p.cmsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindSecrets, &p.secsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindServiceAccounts, &p.saStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindRoles, &p.rolesStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindRoleBindings, &p.roleBindingsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindHelmReleases, &p.helmReleasesStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindDaemonSets, &p.dsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindStatefulSets, &p.stsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindReplicaSets, &p.rsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindJobs, &p.jobsStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindCronJobs, &p.cjStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindHPAs, &p.hpaStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindResourceQuotas, &p.rqStore, scope)
	appendNamespacedSnapshotSearchRows(&rows, p.name, ResourceKindLimitRanges, &p.lrStore, scope)
	return rows
}

func appendClusterSnapshotSearchRows[I any](rows *[]dataplaneSearchRow, cluster string, kind ResourceKind, store *snapshotStore[Snapshot[I]], scope SearchScope) {
	if scope.Namespace != "" || !scope.matchesKind(kind) {
		return
	}
	snap, ok := peekClusterSnapshot(store)
	if !ok {
		return
	}
	*rows = append(*rows, searchRowsFromSnapshot(cluster, kind, "", snap)...)
}

func appendNamespacedSnapshotSearchRows[I any](rows *[]dataplaneSearchRow, cluster string, kind ResourceKind, store *namespacedSnapshotStore[Snapshot[I]], scope SearchScope) {
	if !scope.matchesKind(kind) {
		return
	}
	appendSnapshot := func(namespace string, snap Snapshot[I]) {
		for _, row := range searchRowsFromSnapshot(cluster, kind, namespace, snap) {
			if scope.matchesNamespace(row.Namespace) {
				*rows = append(*rows, row)
			}
		}
	}
	if scope.Namespace != "" {
		if scope.matchesNamespace(scope.Namespace) {
			if snap, ok := peekNamespacedSnapshot(store, scope.Namespace); ok {
				appendSnapshot(scope.Namespace, snap)
			}
		}
		return
	}
	for namespace, snap := range peekAllNamespacedSnapshots(store) {
		if scope.matchesNamespace(namespace) {
			appendSnapshot(namespace, snap)
		}
	}
}

func searchRowsMatching(rows []dataplaneSearchRow, clusterName, query string) []dataplaneSearchRow {
	terms := searchQueryTerms(query)
	if len(terms) == 0 {
		return nil
	}
	out := make([]dataplaneSearchRow, 0, len(rows))
	for _, row := range rows {
		if clusterName != "" && row.Cluster != clusterName {
			continue
		}
		matchReason, ok := searchRowMatchReason(row, terms)
		if !ok {
			continue
		}
		row.MatchReason = matchReason
		out = append(out, row)
	}
	return out
}

func searchRowMatchReason(row dataplaneSearchRow, terms []searchTerm) (string, bool) {
	fields := []struct {
		label string
		value string
	}{
		{label: "name", value: row.Name},
		{label: "namespace", value: row.Namespace},
		{label: "kind", value: row.Kind},
		{label: "cluster", value: row.Cluster},
		{label: "health", value: row.HealthBucket},
		{label: "status", value: row.ListStatus},
		{label: "signal", value: row.SignalSeverity},
	}
	firstReason := ""
	for _, term := range terms {
		if term.key == "attention" {
			if row.NeedsAttention != (term.value == "true") {
				return "", false
			}
			if firstReason == "" {
				firstReason = "attention"
			}
			continue
		}
		matched := false
		for _, field := range fields {
			if term.key != "" && term.key != field.label {
				continue
			}
			value := strings.ToLower(field.value)
			if value == "" {
				continue
			}
			if term.key == "" || term.key == "name" {
				if !strings.Contains(value, term.value) {
					continue
				}
			} else if value != term.value {
				continue
			}
			if firstReason == "" {
				firstReason = field.label
			}
			matched = true
			break
		}
		if !matched {
			return "", false
		}
	}
	if firstReason == "" {
		firstReason = "name"
	}
	return firstReason, true
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

func searchRowLess(a, b dataplaneSearchRow) bool {
	if pi, pj := searchKindPriority(a.Kind), searchKindPriority(b.Kind); pi != pj {
		return pi < pj
	}
	if ni, nj := strings.ToLower(a.Name), strings.ToLower(b.Name); ni != nj {
		return ni < nj
	}
	if a.Namespace != b.Namespace {
		return a.Namespace < b.Namespace
	}
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.Cluster < b.Cluster
}

func sortSearchRows(rows []dataplaneSearchRow) {
	sort.SliceStable(rows, func(i, j int) bool { return searchRowLess(rows[i], rows[j]) })
}
