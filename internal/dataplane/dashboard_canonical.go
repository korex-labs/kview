package dataplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// canonicalDashboardProjection owns fresh slices, never cache DTOs. Its population
// is the Dashboard population BEFORE presentation limits, not history admission.
// No recurrence mutation, plane creation, scheduler, hydration or client reads.
type canonicalDashboardProjection struct {
	at                time.Time
	items, suppressed []ClusterDashboardSignal
	suppression       SignalSuppressionSummary
	namespaces        []string
	policy, revision  string
	sourceAt          time.Time
	coverage          string
	sources           map[string]canonicalSourceEvidence
	identities        map[string]string
	nodes             map[string]string
	placement         map[string]string
}

func (projection canonicalDashboardProjection) dashboardSummary(limit int, opts ClusterDashboardListOptions) ClusterDashboardSignalsPanel {
	signals := newDashboardSignalStore()
	signals.Add(projection.items...)
	panel := signals.Summary(limit, opts)
	panel.Suppressed = projection.suppression
	panel.SuppressedItems = suppressionProjectionSample(projection.suppressed)
	return panel
}

func canonicalKey(parts ...string) string { b, _ := json.Marshal(parts); return string(b) }
func canonicalHash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type canonicalSourceEvidence struct {
	at         time.Time
	generation string
	known      bool
	status     string
}

// Transition confidence follows consulted sources, never unrelated caches or
// node placement. Active population continues to use the Dashboard unchanged.
var canonicalDependencyKinds = map[string]string{
	"pods": "Pod", "deps": "Deployment", "ds": "DaemonSet", "sts": "StatefulSet", "rs": "ReplicaSet", "jobs": "Job", "cjs": "CronJob", "hpas": "HorizontalPodAutoscaler", "svcs": "Service", "ings": "Ingress", "pvcs": "PersistentVolumeClaim", "pvs": "PersistentVolume", "cms": "ConfigMap", "secs": "Secret", "sas": "ServiceAccount", "roles": "Role", "roleBindings": "RoleBinding", "helm": "HelmRelease", "quotas": "ResourceQuota", "podMetrics": "PodMetrics",
}

func (projection canonicalDashboardProjection) domainEvidence(ns, rule string) canonicalSourceEvidence {
	deps := trendDependencies[rule]
	if len(deps) == 0 {
		for _, detector := range dashboardSignalDetectors {
			for _, additional := range detector.AdditionalTypes {
				if additional == rule {
					deps = trendDependencies[detector.Type]
				}
			}
		}
	}
	kinds := make([]string, 0, len(deps))
	for _, dep := range deps {
		kinds = append(kinds, canonicalDependencyKinds[dep])
	}
	if rule == "node_resource_pressure" {
		kinds = []string{"Node", "NodeMetrics"}
	}
	e := canonicalSourceEvidence{known: len(kinds) > 0, status: "available"}
	if len(kinds) == 0 {
		e.status = "source-unknown"
	}
	for _, kind := range kinds {
		scope := ns
		if kind == "PersistentVolume" || kind == "Node" || kind == "NodeMetrics" {
			scope = ""
		}
		s := projection.sources[canonicalKey(scope, kind)]
		e.known = e.known && s.known
		if !s.known && e.status == "available" {
			e.status = s.status
			if e.status == "" {
				e.status = "source-missing"
			}
		}
		if e.at.IsZero() || (!s.at.IsZero() && s.at.Before(e.at)) {
			e.at = s.at
		}
		e.generation = canonicalHash([]string{e.generation, s.generation})
	}
	return e
}

func canonicalSnapshotIdentity[I any](out *canonicalDashboardProjection, s Snapshot[I], ok bool, ns, kind string) {
	if out.sources == nil {
		out.sources = map[string]canonicalSourceEvidence{}
	}
	_, valid := historyPublishedMetadata(s)
	status := "available"
	switch {
	case s.Meta.ObservedAt.IsZero():
		status = "source-missing"
	case s.restored:
		status = "source-restored"
	case s.Err != nil:
		status = "source-error"
	case !ok:
		status = "source-missing"
	case s.Meta.ObservedAt.After(out.at):
		status = "source-clock"
	case out.at.Sub(s.Meta.ObservedAt) > 15*time.Minute || s.Meta.Freshness != FreshnessClassHot:
		status = "source-stale"
	case !valid:
		status = "source-partial"
	}
	out.sources[canonicalKey(ns, kind)] = canonicalSourceEvidence{at: s.Meta.ObservedAt, generation: canonicalHash([]any{s.Meta.Revision, s.Meta.ObservedAt}), known: status == "available", status: status}
	if !ok {
		return
	}
	if !s.Meta.ObservedAt.IsZero() && (out.sourceAt.IsZero() || s.Meta.ObservedAt.Before(out.sourceAt)) {
		out.sourceAt = s.Meta.ObservedAt
	}
	out.revision = canonicalHash([]string{out.revision, ns, kind, strconv.FormatUint(s.Meta.Revision, 10), formatSnapshotTime(s.Meta.ObservedAt)})
	// Identity evidence can improve transition confidence, never remove active rows.
	uids := map[string]string{}
	meta := s.RelationshipMetadata
	validSidecar := meta != nil && meta.Version == dto.ResourceRelationshipSnapshotMetadataVersion && meta.SourceItems == len(s.Items) && meta.EvidenceRecords == len(s.Relationships)
	for _, r := range s.Relationships {
		if validSidecar && r.Version == dto.ResourceRelationshipRecordVersion && r.Resource.Validate() == nil && r.Resource.Namespace == ns && trendSidecarKind(r.Resource, kind) && r.Resource.UID != "" && len(r.Resource.UID) <= 512 {
			key := r.Resource.Name
			if prior, exists := uids[key]; exists && prior != r.Resource.UID {
				uids[key] = ""
			} else if !exists {
				uids[key] = r.Resource.UID
			}
		}
	}
	for _, item := range s.Items {
		v := reflect.ValueOf(item)
		if v.Kind() != reflect.Struct {
			continue
		}
		n := v.FieldByName("Name")
		if !n.IsValid() || n.Kind() != reflect.String {
			continue
		}
		uid := uids[n.String()]
		if f := v.FieldByName("UID"); f.IsValid() && f.Kind() == reflect.String && f.String() != "" {
			if candidate, exists := uids[n.String()]; exists && candidate != f.String() {
				uid = ""
			} else {
				uid = f.String()
			}
		}
		if len(uid) > 512 {
			uid = ""
		}
		key := canonicalKey(ns, kind, n.String())
		if prior, exists := out.identities[key]; exists && prior != uid {
			uid = ""
		}
		out.identities[key] = uid
		if kind == "Node" && uid != "" {
			out.nodes[n.String()] = localhistory.TrendNodeKey(n.String(), uid)
		}
		if kind == "Pod" {
			if f := v.FieldByName("Node"); f.IsValid() && f.Kind() == reflect.String {
				out.placement[key] = f.String()
			}
		}
	}
}

func (m *manager) canonicalDashboardSignals(p *clusterPlane, namespaces NamespaceSnapshot, names []string, nodes NodesSnapshot, at time.Time) canonicalDashboardProjection {
	p = captureCanonicalPlane(p)
	namespaces, _ = peekClusterSnapshot(&p.nsStore)
	nodes, _ = peekClusterSnapshot(&p.nodesStore)
	names = make([]string, 0, len(namespaces.Items))
	for _, ns := range namespaces.Items {
		names = append(names, ns.Name)
	}
	sort.Strings(names)
	out := canonicalDashboardProjection{at: at, identities: map[string]string{}, nodes: map[string]string{}, placement: map[string]string{}, coverage: "complete"}
	policy := m.EffectivePolicy(p.name)
	thresholds := signalThresholdsFromPolicy(policy)
	out.namespaces = visibleNamespacesWithCachedDataplaneLists(p, names)
	if namespaces.Meta.ObservedAt.IsZero() || len(out.namespaces) != len(names) || p.persistHydrating.Load() || p.persistHydrationPartial.Load() {
		out.coverage = "partial"
	}
	metadata := namespaceSignalMetadataIndex(namespaces)
	raw := []ClusterDashboardSignal{}
	// Match the existing Dashboard's early-empty population exactly.
	if len(names) > 0 && len(out.namespaces) > 0 {
		for _, ns := range out.namespaces {
			s := buildSnapshotSetForNamespace(p, ns, thresholds)
			raw = append(raw, applySignalPolicy(enrichSignalsFromMetadataIndex(detectDashboardSignals(at, ns, s), metadata), policy, p.name)...)
			canonicalSnapshotIdentity(&out, s.pods, s.podsOK, ns, "Pod")
			canonicalSnapshotIdentity(&out, s.deps, s.depsOK, ns, "Deployment")
			canonicalSnapshotIdentity(&out, s.ds, s.dsOK, ns, "DaemonSet")
			canonicalSnapshotIdentity(&out, s.sts, s.stsOK, ns, "StatefulSet")
			canonicalSnapshotIdentity(&out, s.rs, s.rsOK, ns, "ReplicaSet")
			canonicalSnapshotIdentity(&out, s.jobs, s.jobsOK, ns, "Job")
			canonicalSnapshotIdentity(&out, s.cjs, s.cjsOK, ns, "CronJob")
			canonicalSnapshotIdentity(&out, s.hpas, s.hpasOK, ns, "HorizontalPodAutoscaler")
			canonicalSnapshotIdentity(&out, s.svcs, s.svcsOK, ns, "Service")
			canonicalSnapshotIdentity(&out, s.ings, s.ingsOK, ns, "Ingress")
			canonicalSnapshotIdentity(&out, s.pvcs, s.pvcsOK, ns, "PersistentVolumeClaim")
			canonicalSnapshotIdentity(&out, s.pvs, s.pvsOK, "", "PersistentVolume")
			canonicalSnapshotIdentity(&out, s.cms, s.cmsOK, ns, "ConfigMap")
			canonicalSnapshotIdentity(&out, s.secs, s.secsOK, ns, "Secret")
			canonicalSnapshotIdentity(&out, s.sas, s.sasOK, ns, "ServiceAccount")
			canonicalSnapshotIdentity(&out, s.roles, s.rolesOK, ns, "Role")
			canonicalSnapshotIdentity(&out, s.roleBindings, s.roleBindingsOK, ns, "RoleBinding")
			canonicalSnapshotIdentity(&out, s.helmReleases, s.helmOK, ns, "HelmRelease")
			canonicalSnapshotIdentity(&out, s.resourceQuotas, s.quotasOK, ns, "ResourceQuota")
			canonicalSnapshotIdentity(&out, s.limitRanges, s.limitRangesOK, ns, "LimitRange")
			canonicalSnapshotIdentity(&out, s.customResources, s.customResourcesOK, ns, "CustomResource")
			canonicalSnapshotIdentity(&out, s.podMetrics, s.podMetricsOK, ns, "PodMetrics")
		}
		raw = append(raw, applySignalPolicy(enrichNodeSignalMetadata(detectNodeResourcePressureSignals(at, p, nodes, thresholds.NodeResourcePressurePct), nodes), policy, p.name)...)
	}
	canonicalSnapshotIdentity(&out, nodes, !nodes.Meta.ObservedAt.IsZero(), "", "Node")
	canonicalSnapshotIdentity(&out, p.nodeMetricsStore.snap, !p.nodeMetricsStore.snap.Meta.ObservedAt.IsZero(), "", "NodeMetrics")
	for i := range raw {
		raw[i].HistoryKey = signalHistoryIdentity(raw[i])
	}
	m.signalSuppressionsMu.RLock()
	records := make(map[string]SignalSuppressionRecord, len(m.signalSuppressions[p.name]))
	for key, record := range m.signalSuppressions[p.name] {
		if normalized, ok := normalizeImportedSignalSuppression(record, at); ok {
			records[key] = normalized
		}
	}
	m.signalSuppressionsMu.RUnlock()
	out.items, out.suppressed, out.suppression = projectPreparedSignalSuppressions(raw, records, at)
	// Include suppression configuration, not suppressed membership: evidence changes
	// may legitimately end until-changed suppression and are not policy changes.
	out.policy = canonicalHash([]any{"dashboard-canonical-v1", policy.Signals, records})
	return out
}

// Full context consent is already checked by the collector. Scopes used by the
// former independent evaluator deliberately do not select this population.
func (m *manager) canonicalHistoryBatch(ctx context.Context, name, epoch string, at time.Time) localhistory.TrendBatch {
	b := localhistory.TrendBatch{Context: name, Epoch: epoch, At: at, Policy: "dashboard-canonical-v1", FullProjection: true, Diagnostics: localhistory.TrendDiagnostics{Reasons: map[string]int{}}}
	m.mu.RLock()
	p := m.planes[name]
	m.mu.RUnlock()
	if p == nil || ctx.Err() != nil {
		b.Policy = "" // reject ingestion, retaining the previous durable projection
		b.Diagnostics.Reasons["canonical-source-unavailable"] = 1
		return b
	}
	ns, _ := peekClusterSnapshot(&p.nsStore)
	nodes, _ := peekClusterSnapshot(&p.nodesStore)
	names := make([]string, 0, len(ns.Items))
	for _, n := range ns.Items {
		names = append(names, n.Name)
	}
	sort.Strings(names)
	projection := m.canonicalDashboardSignals(p, ns, names, nodes, at)
	return projection.historyBatch(name, epoch)
}

// Both consumers may use this exact captured generation, even after cache writes.
func (projection canonicalDashboardProjection) historyBatch(name, epoch string) localhistory.TrendBatch {
	at := projection.at
	b := localhistory.TrendBatch{Context: name, Epoch: epoch, At: at, FullProjection: true, Diagnostics: localhistory.TrendDiagnostics{Reasons: map[string]int{}}}
	b.Policy = projection.policy
	b.AbsentDomainEvidence = func(namespace, rule string) (string, time.Time) {
		e := projection.domainEvidence(namespace, rule)
		return e.status, e.at
	}
	b.Diagnostics.EligibleScopes, b.Diagnostics.EvaluatedScopes = len(projection.namespaces), len(projection.namespaces)
	if projection.coverage != "complete" {
		b.Diagnostics.Reasons["dashboard-population-partial"] = 1
	}
	domains := map[string]*localhistory.TrendDomain{}
	domain := func(ns, rule string) *localhistory.TrendDomain {
		key := canonicalKey(ns, rule)
		if domains[key] == nil {
			evidence := projection.domainEvidence(ns, rule)
			at := evidence.at
			if at.IsZero() {
				at = projection.sourceAt
			}
			domains[key] = &localhistory.TrendDomain{Namespace: ns, Rule: rule, Complete: true, SourceAt: at, Generation: evidence.generation, TransitionsUnknown: !evidence.known, SourceStatus: evidence.status, EvidenceAt: evidence.at, CachedPopulation: true}
		}
		return domains[key]
	}
	// Empty registered rule groups remain observed zero, not missing history.
	for _, d := range dashboardSignalDetectors {
		for _, rule := range append([]string{d.Type}, d.AdditionalTypes...) {
			domain("", rule)
			// Empty complete domains prove disappearance of the last signal.
			for _, ns := range projection.namespaces {
				if projection.domainEvidence(ns, rule).known {
					domain(ns, rule)
				}
			}
			b.Diagnostics.SupportedRules = append(b.Diagnostics.SupportedRules, rule)
		}
	}
	domain("", "node_resource_pressure")
	b.Diagnostics.SupportedRules = append(b.Diagnostics.SupportedRules, "node_resource_pressure")
	supported := map[string]bool{}
	for _, rule := range b.Diagnostics.SupportedRules {
		supported[rule] = true
	}
	for rule := range dashboardSignalDefinitions {
		if !supported[rule] {
			b.Diagnostics.UnsupportedRules = append(b.Diagnostics.UnsupportedRules, rule)
		}
	}
	sort.Strings(b.Diagnostics.SupportedRules)
	sort.Strings(b.Diagnostics.UnsupportedRules)
	occurrences := map[string]int{}
	compact := len(projection.items) > localhistory.TrendMaxSignals
	aggregates := map[string]map[string]int{}
	for _, s := range projection.items {
		ns := s.Namespace
		if s.Scope == "cluster" {
			ns = ""
		}
		d := domain(ns, s.SignalType)
		resource := canonicalKey(ns, signalIdentityKind(s), signalIdentityName(s))
		uid := projection.identities[resource]
		node := ""
		if signalIdentityKind(s) == "Node" {
			node = projection.nodes[signalIdentityName(s)]
		} else {
			node = projection.nodes[projection.placement[resource]]
		}
		if ns != "" && node == "" {
			b.Diagnostics.Reasons["node-membership-unknown"]++
		}
		if compact {
			key := canonicalKey(ns, s.SignalType)
			if aggregates[key] == nil {
				aggregates[key] = map[string]int{}
			}
			aggregates[key][canonicalKey(s.Severity, node)]++
			d.TransitionsUnknown = true
			d.SourceStatus = "identity-compacted"
			continue
		}
		identity := canonicalKey(s.HistoryKey, uid)
		occurrence := occurrences[identity]
		occurrences[identity]++
		d.Signals = append(d.Signals, localhistory.TrendSignal{ResourceUID: uid, ID: canonicalHash([]string{identity, strconv.Itoa(occurrence)}), IdentityKey: canonicalHash(s.HistoryKey), IdentityKnown: uid != "", Severity: s.Severity, Node: node})
	}
	for key, counts := range aggregates {
		d := domains[key]
		for group, count := range counts {
			var fields []string
			_ = json.Unmarshal([]byte(group), &fields)
			d.Signals = append(d.Signals, localhistory.TrendSignal{ID: canonicalHash(group), Severity: fields[0], Node: fields[1], Multiplicity: count})
		}
	}
	if compact {
		b.Diagnostics.Reasons["canonical-identity-cap"] = 1
	}
	keys := make([]string, 0, len(domains))
	for key := range domains {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		d := domains[key]
		sort.Slice(d.Signals, func(i, j int) bool { return d.Signals[i].ID < d.Signals[j].ID })
		d.Generation = canonicalHash([]any{d.Generation, d.Signals})
		// Population coverage is not transition evidence for this domain. A cold
		// unrelated namespace (or partial hydration elsewhere) cannot veto a
		// fresh, complete source with known identities. The reducer still marks
		// aggregate coverage partial, preserving confirmed changes as a subtotal.
		if d.SourceAt.IsZero() || at.Sub(d.SourceAt) > 15*time.Minute {
			d.TransitionsUnknown = true
		}
		b.Domains = append(b.Domains, *d)
	}
	return b
}
