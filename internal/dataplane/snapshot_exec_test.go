package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type snapshotExecClientsProvider struct{}

type snapshotExecResult struct {
	snap Snapshot[int]
	err  error
}

func (snapshotExecClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return &cluster.Clients{}, "ctx", nil
}

func TestExecuteNamespacedSnapshotJoinedCallerPreservesStaleResult(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	scheduler := newWorkScheduler(1)
	store := newNamespacedSnapshotStore[Snapshot[int]]()
	setNamespacedSnapshot(&store, "app", Snapshot[int]{
		Items: []int{1},
		Meta:  plane.snapshotMetaHot(time.Now().UTC().Add(-time.Hour)),
	})

	started := make(chan struct{})
	release := make(chan struct{})
	var fetches atomic.Int32
	desc := namespacedSnapshotDescriptor[int]{
		kind:            ResourceKindPodMetrics,
		ttl:             time.Second,
		capGroup:        "metrics.k8s.io",
		capResource:     "pods",
		capScope:        CapabilityScopeNamespace,
		skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients, string) ([]int, error) {
			if fetches.Add(1) == 1 {
				close(started)
				<-release
			}
			return []int{2}, nil
		},
	}
	results := make(chan snapshotExecResult, 2)
	run := func() {
		snap, err := executeNamespacedSnapshot(
			plane,
			context.Background(),
			scheduler,
			WorkPriorityCritical,
			snapshotExecClientsProvider{},
			"app",
			&store,
			desc,
		)
		results <- snapshotExecResult{snap: snap, err: err}
	}

	go run()
	<-started
	go run()
	// Give the second caller time to join the in-flight scheduler entry.
	time.Sleep(25 * time.Millisecond)
	close(release)

	assertJoinedSnapshotResults(t, results, &fetches)
	cached, ok := peekNamespacedSnapshot(&store, "app")
	if !ok || len(cached.Items) != 1 || cached.Items[0] != 2 {
		t.Fatalf("cached snapshot after joined calls = %+v, ok=%v", cached.Items, ok)
	}
}

func TestExecuteClusterSnapshotJoinedCallerPreservesStaleResult(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	scheduler := newWorkScheduler(1)
	store := snapshotStore[Snapshot[int]]{}
	setClusterSnapshot(&store, Snapshot[int]{
		Items: []int{1},
		Meta:  plane.snapshotMetaHot(time.Now().UTC().Add(-time.Hour)),
	})

	started := make(chan struct{})
	release := make(chan struct{})
	var fetches atomic.Int32
	desc := clusterSnapshotDescriptor[int]{
		kind:            ResourceKindNodeMetrics,
		ttl:             time.Second,
		capGroup:        "metrics.k8s.io",
		capResource:     "nodes",
		capScope:        CapabilityScopeCluster,
		skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients) ([]int, error) {
			if fetches.Add(1) == 1 {
				close(started)
				<-release
			}
			return []int{2}, nil
		},
	}
	results := make(chan snapshotExecResult, 2)
	run := func() {
		snap, err := executeClusterSnapshot(
			plane,
			context.Background(),
			scheduler,
			WorkPriorityCritical,
			snapshotExecClientsProvider{},
			&store,
			desc,
		)
		results <- snapshotExecResult{snap: snap, err: err}
	}

	go run()
	<-started
	go run()
	time.Sleep(25 * time.Millisecond)
	close(release)

	assertJoinedSnapshotResults(t, results, &fetches)
	cached, ok := peekClusterSnapshot(&store)
	if !ok || len(cached.Items) != 1 || cached.Items[0] != 2 {
		t.Fatalf("cached snapshot after joined calls = %+v, ok=%v", cached.Items, ok)
	}
}

func assertJoinedSnapshotResults(t *testing.T, results <-chan snapshotExecResult, fetches *atomic.Int32) {
	t.Helper()
	sawFresh := false
	for i := 0; i < 2; i++ {
		got := <-results
		if got.err != nil {
			t.Fatalf("snapshot call %d returned error: %v", i, got.err)
		}
		if len(got.snap.Items) != 1 || (got.snap.Items[0] != 1 && got.snap.Items[0] != 2) {
			t.Fatalf("snapshot call %d items = %v, want stale [1] or fresh [2], never empty", i, got.snap.Items)
		}
		if got.snap.Items[0] == 2 {
			sawFresh = true
		}
	}
	if !sawFresh {
		t.Fatal("scheduler owner did not return the fresh result")
	}
	if got := fetches.Load(); got != 1 {
		t.Fatalf("fetch count = %d, want one deduplicated fetch", got)
	}
}

type snapshotRelationshipItem struct {
	Name                            string `json:"name"`
	dto.ResourceRelationshipCarrier `json:"-"`
}

func testSnapshotRelationshipItem(name string) snapshotRelationshipItem {
	return snapshotRelationshipItem{
		Name: name,
		ResourceRelationshipCarrier: dto.ResourceRelationshipCarrier{
			Resource: dto.ResourceIdentityDTO{
				Version: "v1", Resource: "pods", Kind: "Pod", Scope: dto.ResourceScopeNamespaced, Namespace: "apps", Name: name,
			},
			References: []dto.ResourceReferenceDTO{{
				Type:     dto.ResourceRelationshipTypeSelector,
				Target:   dto.ResourceIdentityDTO{Version: "v1", Resource: "services", Kind: "Service", Scope: dto.ResourceScopeNamespaced, Namespace: "apps", Name: "api"},
				Evidence: dto.ResourceRelationshipEvidenceDTO{Selector: map[string]string{"app": "api"}},
			}},
			FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
				dto.ResourceRelationshipFamilyOwner:    {Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
				dto.ResourceRelationshipFamilySelector: {Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
			},
		},
	}
}

func TestSnapshotRelationshipJSONRoundTripAndLegacyDecode(t *testing.T) {
	snap := Snapshot[snapshotRelationshipItem]{
		Items:         []snapshotRelationshipItem{{Name: "api-0"}},
		Relationships: []dto.ResourceRelationshipRecord{testSnapshotRelationshipItem("api-0").ResourceRelationshipMetadata()},
	}
	payload, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode snapshot envelope: %v", err)
	}
	if _, ok := envelope["relationships"]; !ok {
		t.Fatalf("snapshot relationship sidecar missing from JSON: %s", payload)
	}

	var roundTripped Snapshot[snapshotRelationshipItem]
	if err := json.Unmarshal(payload, &roundTripped); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if !reflect.DeepEqual(roundTripped.Relationships, snap.Relationships) {
		t.Fatalf("relationship JSON round trip = %+v, want %+v", roundTripped.Relationships, snap.Relationships)
	}

	var legacy Snapshot[snapshotRelationshipItem]
	if err := json.Unmarshal([]byte(`{"Items":[{"name":"legacy"}],"Meta":{}}`), &legacy); err != nil {
		t.Fatalf("unmarshal legacy snapshot: %v", err)
	}
	if legacy.Relationships != nil {
		t.Fatalf("legacy snapshot gained authoritative relationships: %+v", legacy.Relationships)
	}
}

func TestExecuteClusterSnapshotNormalizesCustomRelationshipExtractor(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := snapshotStore[Snapshot[snapshotRelationshipItem]]{}
	item := testSnapshotRelationshipItem("api-0")
	api := item.ResourceRelationshipMetadata()
	api.Version = 0
	worker := api
	worker.References = append([]dto.ResourceReferenceDTO(nil), api.References...)
	worker.References[0].Evidence.Selector = map[string]string{"app": "worker"}
	aliased := []dto.ResourceRelationshipRecord{worker, api, worker}
	desc := clusterSnapshotDescriptor[snapshotRelationshipItem]{
		kind: ResourceKindNodeMetrics, ttl: time.Second, capScope: CapabilityScopeCluster, skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients) ([]snapshotRelationshipItem, error) {
			return []snapshotRelationshipItem{item}, nil
		},
		extractRelationships: func([]snapshotRelationshipItem) []dto.ResourceRelationshipRecord {
			return aliased
		},
	}

	snap, err := executeClusterSnapshot(plane, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, &store, desc)
	if err != nil {
		t.Fatalf("execute cluster snapshot: %v", err)
	}
	if len(snap.Relationships) != 2 {
		t.Fatalf("cluster relationships = %d, want two records after removing only the exact duplicate: %+v", len(snap.Relationships), snap.Relationships)
	}
	if snap.Relationships[0].Version != dto.ResourceRelationshipRecordVersion || snap.Relationships[1].Version != dto.ResourceRelationshipRecordVersion {
		t.Fatalf("executor did not apply relationship version: %+v", snap.Relationships)
	}
	if snap.Relationships[0].Resource != snap.Relationships[1].Resource {
		t.Fatalf("relationship records do not share one resource identity: %+v", snap.Relationships)
	}
	if got := snap.Relationships[0].References[0].Evidence.Selector["app"]; got != "api" {
		t.Fatalf("first relationship evidence = %q, want deterministic api-before-worker order", got)
	}
	if got := snap.Relationships[1].References[0].Evidence.Selector["app"]; got != "worker" {
		t.Fatalf("second relationship evidence = %q, want distinct evidence preserved", got)
	}

	aliased[0].References[0].Evidence.Selector["app"] = "mutated"
	if got := snap.Relationships[1].References[0].Evidence.Selector["app"]; got != "worker" {
		t.Fatalf("cluster relationship sidecar aliases custom extractor memory: %q", got)
	}
}

func TestExecuteNamespacedSnapshotRelationshipStaleCacheFallback(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[snapshotRelationshipItem]]()
	item := testSnapshotRelationshipItem("api-0")
	wantRelationships := []dto.ResourceRelationshipRecord{item.ResourceRelationshipMetadata()}
	wantMetadata := &dto.ResourceRelationshipSnapshotMetadata{
		Version: dto.ResourceRelationshipSnapshotMetadataVersion,
		FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
			dto.ResourceRelationshipFamilyOwner: {Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete},
		},
		SourceItems: 1, EvidenceRecords: 1,
	}
	setNamespacedSnapshot(&store, "apps", Snapshot[snapshotRelationshipItem]{
		Items:                []snapshotRelationshipItem{item},
		Relationships:        wantRelationships,
		RelationshipMetadata: wantMetadata,
		Meta:                 plane.snapshotMetaHot(time.Now().UTC().Add(-time.Hour)),
	})
	desc := namespacedSnapshotDescriptor[snapshotRelationshipItem]{
		kind: ResourceKindPodMetrics, ttl: time.Second, capScope: CapabilityScopeNamespace, skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients, string) ([]snapshotRelationshipItem, error) {
			return nil, errors.New("list failed")
		},
		extractRelationships: dto.ExtractResourceRelationships[snapshotRelationshipItem],
	}

	snap, err := executeNamespacedSnapshot(plane, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
	if err == nil {
		t.Fatal("failed live fetch unexpectedly succeeded")
	}
	if !reflect.DeepEqual(snap.Relationships, wantRelationships) {
		t.Fatalf("stale-cache fallback relationships = %+v, want %+v", snap.Relationships, wantRelationships)
	}
	if !reflect.DeepEqual(snap.RelationshipMetadata, wantMetadata) {
		t.Fatalf("stale-cache fallback metadata = %+v, want %+v", snap.RelationshipMetadata, wantMetadata)
	}
	if got := snap.Relationships[0].References[0]; got.Type != dto.ResourceRelationshipTypeSelector || got.Target.Name != "api" || got.Evidence.Selector["app"] != "api" {
		t.Fatalf("stale-cache fallback relationship contents changed: %+v", got)
	}
}

func TestExecuteNamespacedSnapshotRelationshipExtraction(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	store := newNamespacedSnapshotStore[Snapshot[snapshotRelationshipItem]]()
	desc := namespacedSnapshotDescriptor[snapshotRelationshipItem]{
		kind: ResourceKindPodMetrics, ttl: time.Second, capScope: CapabilityScopeNamespace, skipPersistence: true,
		fetch: func(context.Context, *cluster.Clients, string) ([]snapshotRelationshipItem, error) {
			return []snapshotRelationshipItem{testSnapshotRelationshipItem("api-0")}, nil
		},
		extractRelationships: dto.ExtractResourceRelationships[snapshotRelationshipItem],
	}

	snap, err := executeNamespacedSnapshot(plane, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
	if err != nil {
		t.Fatalf("execute namespaced snapshot: %v", err)
	}
	if len(snap.Relationships) != 1 || snap.Relationships[0].Resource.Name != "api-0" {
		t.Fatalf("namespaced relationships = %+v", snap.Relationships)
	}
	if snap.RelationshipMetadata == nil || snap.RelationshipMetadata.SourceItems != 1 || snap.RelationshipMetadata.EvidenceRecords != 1 || snap.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner].Coverage != dto.ResourceRelationshipCoverageFull {
		t.Fatalf("namespaced relationship envelope = %+v", snap.RelationshipMetadata)
	}
}

func TestExecuteSnapshotRelationshipNoExtractorCompatibilityAndFailedFetch(t *testing.T) {
	plane := newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, nil, nil, nil)
	t.Run("no extractor", func(t *testing.T) {
		store := snapshotStore[Snapshot[snapshotRelationshipItem]]{}
		desc := clusterSnapshotDescriptor[snapshotRelationshipItem]{
			kind: ResourceKindNodeMetrics, ttl: time.Second, capScope: CapabilityScopeCluster, skipPersistence: true,
			fetch: func(context.Context, *cluster.Clients) ([]snapshotRelationshipItem, error) {
				return []snapshotRelationshipItem{testSnapshotRelationshipItem("api-0")}, nil
			},
		}
		snap, err := executeClusterSnapshot(plane, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, &store, desc)
		if err != nil || snap.Relationships != nil {
			t.Fatalf("no-extractor behavior changed: relationships=%+v err=%v", snap.Relationships, err)
		}
	})

	t.Run("failed fetch", func(t *testing.T) {
		store := newNamespacedSnapshotStore[Snapshot[snapshotRelationshipItem]]()
		var extractions atomic.Int32
		desc := namespacedSnapshotDescriptor[snapshotRelationshipItem]{
			kind: ResourceKindPodMetrics, ttl: time.Second, capScope: CapabilityScopeNamespace, skipPersistence: true,
			fetch: func(context.Context, *cluster.Clients, string) ([]snapshotRelationshipItem, error) {
				return nil, errors.New("list failed")
			},
			extractRelationships: func(items []snapshotRelationshipItem) []dto.ResourceRelationshipRecord {
				extractions.Add(1)
				return dto.ExtractResourceRelationships(items)
			},
		}
		snap, err := executeNamespacedSnapshot(plane, context.Background(), newWorkScheduler(1), WorkPriorityCritical, snapshotExecClientsProvider{}, "apps", &store, desc)
		if err == nil {
			t.Fatal("failed fetch unexpectedly succeeded")
		}
		if extractions.Load() != 0 || snap.Relationships != nil || snap.RelationshipMetadata != nil {
			t.Fatalf("failed fetch extracted relationship envelope: count=%d relationships=%+v metadata=%+v", extractions.Load(), snap.Relationships, snap.RelationshipMetadata)
		}
	})
}

func TestNormalizeSnapshotRelationshipsEnvelopeAndFamilyAggregation(t *testing.T) {
	full := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	unknown := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageUnknown, Completeness: dto.ResourceRelationshipCompletenessUnknown}

	t.Run("successful empty extraction emits full declared envelope", func(t *testing.T) {
		records, metadata := normalizeSnapshotRelationships([]snapshotRelationshipItem{}, func([]snapshotRelationshipItem) []dto.ResourceRelationshipRecord { return nil }, []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels})
		if records != nil || metadata == nil || metadata.Version != dto.ResourceRelationshipSnapshotMetadataVersion || metadata.SourceItems != 0 || metadata.EvidenceRecords != 0 {
			t.Fatalf("empty relationship envelope = records=%+v metadata=%+v", records, metadata)
		}
		for _, family := range []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilyOwner, dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels} {
			if metadata.FamilyCoverage[family] != full {
				t.Fatalf("empty successful family %q = %+v, want full", family, metadata.FamilyCoverage[family])
			}
		}
	})

	t.Run("worst and absent evidence aggregate truthfully", func(t *testing.T) {
		items := []snapshotRelationshipItem{testSnapshotRelationshipItem("a"), testSnapshotRelationshipItem("b")}
		recordA := items[0].ResourceRelationshipMetadata()
		recordB := items[1].ResourceRelationshipMetadata()
		recordB.FamilyCoverage[dto.ResourceRelationshipFamilyLabels] = unknown
		delete(recordB.FamilyCoverage, dto.ResourceRelationshipFamilySelector)
		records, metadata := normalizeSnapshotRelationships(items, func([]snapshotRelationshipItem) []dto.ResourceRelationshipRecord {
			return []dto.ResourceRelationshipRecord{recordB, recordA}
		}, []dto.ResourceRelationshipFamily{dto.ResourceRelationshipFamilySelector, dto.ResourceRelationshipFamilyLabels})
		if metadata.SourceItems != 2 || metadata.EvidenceRecords != 2 || len(records) != 2 {
			t.Fatalf("relationship counts = records=%d metadata=%+v", len(records), metadata)
		}
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != full {
			t.Fatalf("owner default aggregation = %+v", got)
		}
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilySelector]; got.Coverage != dto.ResourceRelationshipCoveragePartial || got.Completeness != dto.ResourceRelationshipCompletenessPartial {
			t.Fatalf("absent selector evidence aggregation = %+v", got)
		}
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyLabels]; got != unknown {
			t.Fatalf("worst labels aggregation = %+v, want unknown", got)
		}
	})
}

type snapshotRelationshipItemWithoutProvider struct{ Name string }

func TestNormalizeSnapshotRelationshipsUsesDistinctAuthoritativeSourceIdentities(t *testing.T) {
	full := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	partial := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial}
	items := []snapshotRelationshipItem{testSnapshotRelationshipItem("a"), testSnapshotRelationshipItem("b")}
	recordA := items[0].ResourceRelationshipMetadata()
	recordB := items[1].ResourceRelationshipMetadata()
	distinctA := recordA
	distinctA.References = append([]dto.ResourceReferenceDTO(nil), recordA.References...)
	distinctA.References[0].Evidence.Description = "second evidence"
	partialA := recordA
	partialA.FamilyCoverage = map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
		dto.ResourceRelationshipFamilyOwner:    partial,
		dto.ResourceRelationshipFamilySelector: full,
	}

	tests := []struct {
		name        string
		records     []dto.ResourceRelationshipRecord
		want        dto.ResourceRelationshipCoverageDTO
		wantRecords int
	}{
		{"one source repeated cannot cover another", []dto.ResourceRelationshipRecord{recordA, distinctA}, partial, 2},
		{"both source identities fully observed", []dto.ResourceRelationshipRecord{recordA, recordB}, full, 2},
		{"worst evidence wins within one identity", []dto.ResourceRelationshipRecord{recordA, partialA, recordB}, partial, 3},
		{"exact duplicate normalization", []dto.ResourceRelationshipRecord{recordA, recordA, recordB}, full, 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			records, metadata := normalizeSnapshotRelationships(items, func([]snapshotRelationshipItem) []dto.ResourceRelationshipRecord { return test.records }, nil)
			if len(records) != test.wantRecords || metadata.EvidenceRecords != test.wantRecords || metadata.SourceItems != 2 {
				t.Fatalf("normalized counts = records=%d metadata=%+v", len(records), metadata)
			}
			if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != test.want {
				t.Fatalf("owner family = %+v, want %+v", got, test.want)
			}
		})
	}

	t.Run("duplicate source identity makes proof partial", func(t *testing.T) {
		duplicatedItems := []snapshotRelationshipItem{items[0], items[0]}
		_, metadata := normalizeSnapshotRelationships(duplicatedItems, func([]snapshotRelationshipItem) []dto.ResourceRelationshipRecord {
			return []dto.ResourceRelationshipRecord{recordA}
		}, nil)
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != partial {
			t.Fatalf("duplicate source identity family = %+v, want partial", got)
		}
	})

	t.Run("invalid source identity makes proof partial", func(t *testing.T) {
		invalid := testSnapshotRelationshipItem("invalid")
		invalid.Resource.Name = ""
		_, metadata := normalizeSnapshotRelationships([]snapshotRelationshipItem{invalid}, dto.ExtractResourceRelationships[snapshotRelationshipItem], nil)
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != partial {
			t.Fatalf("invalid source identity family = %+v, want partial", got)
		}
	})

	t.Run("missing provider makes proof partial", func(t *testing.T) {
		_, metadata := normalizeSnapshotRelationships([]snapshotRelationshipItemWithoutProvider{{Name: "a"}}, func([]snapshotRelationshipItemWithoutProvider) []dto.ResourceRelationshipRecord { return nil }, nil)
		if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != partial {
			t.Fatalf("carrierless source family = %+v, want partial", got)
		}
	})
}
