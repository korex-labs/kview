package dataplane

import (
	"context"
	"fmt"
	"sort"
	"time"
)

const maxSignalExclusionPreviewItems = 100

type SignalExclusionPreviewItem struct {
	ResourceKind string `json:"resourceKind"`
	Namespace    string `json:"namespace,omitempty"`
	ResourceName string `json:"resourceName"`
	Reason       string `json:"reason,omitempty"`
}

type SignalExclusionPreviewResult struct {
	SignalType     string                       `json:"signalType"`
	CandidateCount int                          `json:"candidateCount"`
	MatchedCount   int                          `json:"matchedCount"`
	Items          []SignalExclusionPreviewItem `json:"items"`
	ItemsTruncated bool                         `json:"itemsTruncated,omitempty"`
	CacheOnly      bool                         `json:"cacheOnly"`
}

func (m *manager) PreviewSignalExclusions(ctx context.Context, clusterName, signalType string, exclusions SignalExclusionSet) (SignalExclusionPreviewResult, error) {
	result := SignalExclusionPreviewResult{SignalType: signalType, CacheOnly: true}
	if !knownDashboardSignalType(signalType) {
		return result, fmt.Errorf("unknown signal type %q", signalType)
	}
	if err := validateSignalExclusionSet(exclusions); err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return result, err
	}
	plane, _ := planeAny.(*clusterPlane)
	if plane == nil {
		return result, nil
	}

	policy := m.EffectivePolicy(clusterName)
	thresholds := signalThresholdsFromPolicy(policy)
	compiled := compileSignalExclusionSet(normalizeSignalExclusionSet(&exclusions))
	var candidates []ClusterDashboardSignal
	now := time.Now().UTC()

	namespaceSnapshot, namespacesCached := peekClusterSnapshot(&plane.nsStore)
	namespaceIndex := namespaceSignalMetadataIndex(namespaceSnapshot)
	var names []string
	if namespacesCached {
		names = make([]string, 0, len(namespaceSnapshot.Items))
		for _, item := range namespaceSnapshot.Items {
			names = append(names, item.Name)
		}
	} else {
		names = cachedSignalPreviewNamespaces(plane)
	}
	sort.Strings(names)
	for _, namespace := range visibleNamespacesWithCachedDataplaneLists(plane, names) {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		set := buildSnapshotSetForNamespace(plane, namespace, thresholds)
		items := enrichSignalsFromMetadataIndex(detectDashboardSignals(now, namespace, set), namespaceIndex)
		for _, item := range items {
			if item.SignalType == signalType {
				candidates = append(candidates, item)
			}
		}
	}

	nodes, _ := peekClusterSnapshot(&plane.nodesStore)
	for _, item := range enrichNodeSignalMetadata(detectNodeResourcePressureSignals(now, plane, nodes, thresholds.NodeResourcePressurePct), nodes) {
		if item.SignalType == signalType {
			candidates = append(candidates, item)
		}
	}
	volumes, _ := peekClusterSnapshot(&plane.persistentVolumesStore)
	for _, item := range enrichPersistentVolumeSignalMetadata(detectClusterPVNodeBoundStorageSignals(volumes), volumes) {
		if item.SignalType == signalType {
			candidates = append(candidates, item)
		}
	}

	if err := ctx.Err(); err != nil {
		return result, err
	}
	candidates = dedupeSignalExclusionPreviewCandidates(candidates)
	result.CandidateCount = len(candidates)
	for _, item := range candidates {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if !compiled.excludes(item) {
			continue
		}
		result.MatchedCount++
		if len(result.Items) >= maxSignalExclusionPreviewItems {
			result.ItemsTruncated = true
			continue
		}
		kind := item.ResourceKind
		if kind == "" {
			kind = item.Kind
		}
		name := item.ResourceName
		if name == "" {
			name = item.Name
		}
		result.Items = append(result.Items, SignalExclusionPreviewItem{
			ResourceKind: kind,
			Namespace:    item.Namespace,
			ResourceName: name,
			Reason:       item.Reason,
		})
	}
	return result, nil
}

func cachedSignalPreviewNamespaces(plane *clusterPlane) []string {
	if plane == nil {
		return nil
	}
	set := map[string]struct{}{}
	addCachedSnapshotNamespaces(set, &plane.podsStore)
	addCachedSnapshotNamespaces(set, &plane.depsStore)
	addCachedSnapshotNamespaces(set, &plane.jobsStore)
	addCachedSnapshotNamespaces(set, &plane.cjStore)
	addCachedSnapshotNamespaces(set, &plane.hpaStore)
	addCachedSnapshotNamespaces(set, &plane.svcsStore)
	addCachedSnapshotNamespaces(set, &plane.ingStore)
	addCachedSnapshotNamespaces(set, &plane.pvcsStore)
	addCachedSnapshotNamespaces(set, &plane.cmsStore)
	addCachedSnapshotNamespaces(set, &plane.secsStore)
	addCachedSnapshotNamespaces(set, &plane.saStore)
	addCachedSnapshotNamespaces(set, &plane.rolesStore)
	addCachedSnapshotNamespaces(set, &plane.roleBindingsStore)
	addCachedSnapshotNamespaces(set, &plane.helmReleasesStore)
	addCachedSnapshotNamespaces(set, &plane.rqStore)
	out := make([]string, 0, len(set))
	for namespace := range set {
		out = append(out, namespace)
	}
	return out
}

func addCachedSnapshotNamespaces[I any](out map[string]struct{}, store *namespacedSnapshotStore[Snapshot[I]]) {
	for namespace := range peekAllNamespacedSnapshots(store) {
		out[namespace] = struct{}{}
	}
}

func dedupeSignalExclusionPreviewCandidates(items []ClusterDashboardSignal) []ClusterDashboardSignal {
	type key struct {
		signalType string
		kind       string
		namespace  string
		name       string
		reason     string
	}
	seen := make(map[key]struct{}, len(items))
	out := make([]ClusterDashboardSignal, 0, len(items))
	for _, item := range items {
		kind := item.ResourceKind
		if kind == "" {
			kind = item.Kind
		}
		name := item.ResourceName
		if name == "" {
			name = item.Name
		}
		candidateKey := key{item.SignalType, kind, item.Namespace, name, item.Reason}
		if _, ok := seen[candidateKey]; ok {
			continue
		}
		seen[candidateKey] = struct{}{}
		out = append(out, item)
	}
	return out
}
