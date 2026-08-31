package dataplane

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestFinalizeCustomResourceRelationshipsAfterManifestMerge(t *testing.T) {
	live := customResourceRelationshipItem("apps", "widget", "widget-uid", "live evidence")
	manifestDuplicate := dto.CustomResourceInstanceDTO{
		Name: live.Name, Namespace: live.Namespace, Kind: live.Kind, Group: live.Group, Version: live.Version, Resource: live.Resource,
	}
	manifestOnly := dto.CustomResourceInstanceDTO{
		Name: "manifest-only", Namespace: "apps", Kind: "Widget", Group: "operator.example.com", Version: "v1", Resource: "widgets",
	}

	merged := mergeCustomResourceItems([]dto.CustomResourceInstanceDTO{live}, []dto.CustomResourceInstanceDTO{manifestDuplicate, manifestOnly})
	if len(merged) != 2 {
		t.Fatalf("merged items = %d, want live item plus distinct manifest item", len(merged))
	}
	relationships := finalizeCustomResourceRelationships(merged)
	if len(relationships) != 1 {
		t.Fatalf("relationships = %+v, want only the real dynamic item carrier", relationships)
	}
	if relationships[0].Resource.Name != live.Name || relationships[0].References[0].Evidence.Description != "live evidence" {
		t.Fatalf("real relationship changed after manifest merge: %+v", relationships[0])
	}
}

func TestFinalizeCustomResourceRelationshipsDelegatesExactDedupAndEvidenceSemantics(t *testing.T) {
	first := customResourceRelationshipItem("apps", "widget", "widget-uid", "first evidence")
	duplicate := first
	second := customResourceRelationshipItem("apps", "widget", "widget-uid", "second evidence")

	relationships := finalizeCustomResourceRelationships([]dto.CustomResourceInstanceDTO{second, duplicate, first})
	if len(relationships) != 2 {
		t.Fatalf("relationships = %+v, want exact duplicate removed and distinct evidence retained", relationships)
	}
	if relationships[0].References[0].Evidence.Description != "first evidence" || relationships[1].References[0].Evidence.Description != "second evidence" {
		t.Fatalf("relationships are not normalized deterministically: %+v", relationships)
	}
	first.References[0].Evidence.Description = "mutated"
	if relationships[0].References[0].Evidence.Description != "first evidence" {
		t.Fatalf("normalized relationship retained an input alias: %+v", relationships[0])
	}
}

func TestCustomResourceSnapshotsExtractRealDynamicRelationshipCarriers(t *testing.T) {
	tests := []struct {
		name      string
		scope     string
		namespace string
		path      string
		invoke    func(*clusterPlane, customResourceClientsProvider) (CustomResourcesSnapshot, error)
	}{
		{
			name:  "cluster",
			scope: "Cluster",
			path:  "/apis/operator.example.com/v1/widgets",
			invoke: func(plane *clusterPlane, clients customResourceClientsProvider) (CustomResourcesSnapshot, error) {
				return plane.ClusterCustomResourcesSnapshot(context.Background(), newWorkScheduler(1), clients, WorkPriorityCritical)
			},
		},
		{
			name:      "namespaced",
			scope:     "Namespaced",
			namespace: "apps",
			path:      "/apis/operator.example.com/v1/namespaces/apps/widgets",
			invoke: func(plane *clusterPlane, clients customResourceClientsProvider) (CustomResourcesSnapshot, error) {
				return plane.CustomResourcesSnapshot(context.Background(), newWorkScheduler(1), clients, "apps", WorkPriorityCritical)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clients := newCustomResourceClients(t, tt.path, tt.namespace)
			plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
			setClusterSnapshot(&plane.crdsStore, CRDsSnapshot{
				Items: []dto.CRDListItemDTO{{
					Name: "widgets.operator.example.com", Group: "operator.example.com", Scope: tt.scope,
					Kind: "Widget", StorageVersion: "v1", Plural: "widgets",
				}},
				Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
			})

			snapshot, err := tt.invoke(plane, clients)
			if err != nil {
				t.Fatalf("successful bespoke snapshot: %v", err)
			}
			if len(snapshot.Items) != 1 {
				t.Fatalf("items = %+v, want one dynamic custom resource", snapshot.Items)
			}
			if len(snapshot.Relationships) != 1 {
				t.Fatalf("relationships = %+v, want one dynamic custom resource carrier", snapshot.Relationships)
			}
			assertCustomResourceRelationshipEnvelope(t, snapshot, 1, 1)
			got := snapshot.Relationships[0].Resource
			wantScope := dto.ResourceScopeCluster
			if tt.namespace != "" {
				wantScope = dto.ResourceScopeNamespaced
			}
			if got.Group != "operator.example.com" || got.Version != "v1" || got.Resource != "widgets" || got.Kind != "Widget" || got.Scope != wantScope || got.Namespace != tt.namespace || got.Name != "widget" || got.UID != "widget-uid" {
				t.Fatalf("relationship identity = %+v", got)
			}
		})
	}
}

func TestClusterCustomResourceSuccessfulEmptySnapshotEmitsRelationshipEnvelope(t *testing.T) {
	plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
	seedCustomResourceCRD(plane, "Cluster")
	snapshot, err := plane.ClusterCustomResourcesSnapshot(
		context.Background(), newWorkScheduler(1),
		newCustomResourceClientsWithItems(t, "/apis/operator.example.com/v1/widgets", nil),
		WorkPriorityCritical,
	)
	if err != nil {
		t.Fatalf("successful empty cluster custom-resource snapshot: %v", err)
	}
	if len(snapshot.Items) != 0 || len(snapshot.Relationships) != 0 {
		t.Fatalf("empty cluster snapshot fabricated data: items=%+v relationships=%+v", snapshot.Items, snapshot.Relationships)
	}
	assertCustomResourceRelationshipEnvelope(t, snapshot, 0, 0)
}

func TestNamespacedCustomResourceRelationshipEnvelopeExcludesHelmManifestProjections(t *testing.T) {
	manifest := "apiVersion: operator.example.com/v1\nkind: Widget\nmetadata:\n  name: manifest-only\n  namespace: apps\n"
	tests := []struct {
		name              string
		realItems         []any
		wantItems         int
		wantSourceItems   int
		wantEvidenceItems int
	}{
		{
			name: "live and virtual merge",
			realItems: []any{map[string]any{
				"apiVersion": "operator.example.com/v1", "kind": "Widget",
				"metadata": map[string]any{"name": "widget", "namespace": "apps", "uid": "widget-uid"},
			}},
			wantItems: 2, wantSourceItems: 1, wantEvidenceItems: 1,
		},
		{name: "virtual only after successful empty real list", wantItems: 1, wantSourceItems: 0, wantEvidenceItems: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
			seedCustomResourceCRD(plane, "Namespaced")
			snapshot, err := plane.CustomResourcesSnapshot(
				context.Background(), newWorkScheduler(1),
				newCustomResourceClientsWithManifest(t, "/apis/operator.example.com/v1/namespaces/apps/widgets", test.realItems, manifest),
				"apps", WorkPriorityCritical,
			)
			if err != nil {
				t.Fatalf("successful namespaced custom-resource snapshot: %v", err)
			}
			if len(snapshot.Items) != test.wantItems {
				t.Fatalf("merged items = %+v, want %d", snapshot.Items, test.wantItems)
			}
			assertCustomResourceRelationshipEnvelope(t, snapshot, test.wantSourceItems, test.wantEvidenceItems)
			if len(snapshot.Relationships) != test.wantEvidenceItems {
				t.Fatalf("relationships = %+v, want only %d real Kubernetes records", snapshot.Relationships, test.wantEvidenceItems)
			}
			for _, record := range snapshot.Relationships {
				if record.Resource.Name == "manifest-only" {
					t.Fatalf("Helm manifest projection fabricated relationship evidence: %+v", record)
				}
			}
		})
	}
}

func TestNamespacedCustomResourceResourceMapUsesEligibleSourceCount(t *testing.T) {
	manifest := "apiVersion: operator.example.com/v1\nkind: Widget\nmetadata:\n  name: manifest-only\n  namespace: apps\n"
	liveItem := map[string]any{
		"apiVersion": "operator.example.com/v1", "kind": "Widget",
		"metadata": map[string]any{"name": "widget", "namespace": "apps", "uid": "widget-uid"},
	}
	tests := []struct {
		name         string
		realItems    []any
		targetName   string
		targetUID    string
		persist      bool
		corruptCount bool
		wantResolved bool
		wantCoverage dto.ResourceRelationshipCoverage
		wantReason   string
	}{
		{name: "live and virtual merge", realItems: []any{liveItem}, targetName: "widget", targetUID: "widget-uid", wantResolved: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "persisted live and virtual merge", realItems: []any{liveItem}, targetName: "widget", targetUID: "widget-uid", persist: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "virtual only", targetName: "manifest-only", wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "persisted virtual only", targetName: "manifest-only", persist: true, wantCoverage: dto.ResourceRelationshipCoverageFull},
		{name: "corrupt envelope source count", realItems: []any{liveItem}, targetName: "widget", targetUID: "widget-uid", corruptCount: true, wantResolved: true, wantCoverage: dto.ResourceRelationshipCoveragePartial, wantReason: "inconsistent relationship metadata: customresources/apps"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
			seedCustomResourceCRD(plane, "Namespaced")
			snapshot, err := plane.CustomResourcesSnapshot(
				context.Background(), newWorkScheduler(1),
				newCustomResourceClientsWithManifest(t, "/apis/operator.example.com/v1/namespaces/apps/widgets", test.realItems, manifest),
				"apps", WorkPriorityCritical,
			)
			if err != nil {
				t.Fatalf("create merged custom-resource snapshot: %v", err)
			}
			wantSources := len(test.realItems)
			if snapshot.RelationshipSourceItems == nil || *snapshot.RelationshipSourceItems != wantSources {
				t.Fatalf("authoritative relationship source count = %v, want %d", snapshot.RelationshipSourceItems, wantSources)
			}
			if test.corruptCount {
				snapshot.RelationshipMetadata.SourceItems++
			}
			if test.persist {
				store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = store.Close() })
				if err := store.Save("ctx", ResourceKindCustomResources, "apps", snapshot); err != nil {
					t.Fatal(err)
				}
				var loaded CustomResourcesSnapshot
				ok, err := store.Load("ctx", ResourceKindCustomResources, "apps", &loaded)
				if err != nil || !ok {
					t.Fatalf("load persisted custom-resource snapshot: ok=%v err=%v", ok, err)
				}
				snapshot = loaded
				if snapshot.RelationshipSourceItems == nil || *snapshot.RelationshipSourceItems != wantSources {
					t.Fatalf("persisted relationship source count = %v, want %d", snapshot.RelationshipSourceItems, wantSources)
				}
			}

			seedCompleteEmptyResourceMapInventory(plane)
			setNamespacedSnapshot(&plane.customResourcesStore, "apps", snapshot)
			target := resourceMapIdentity("operator.example.com", "v1", "widgets", "Widget", "apps", test.targetName, test.targetUID)
			mapped, err := plane.ResourceMap(ResourceMapRequest{Target: target})
			if err != nil {
				t.Fatal(err)
			}
			if mapped.Target.Resolved != test.wantResolved || mapped.Coverage.Coverage != test.wantCoverage {
				t.Fatalf("custom-resource map = target=%+v coverage=%+v", mapped.Target, mapped.Coverage)
			}
			if !test.wantResolved && mapped.Target.Availability != ResourceMapAvailabilityMissing {
				t.Fatalf("virtual projection fabricated or obscured target authority: %+v", mapped.Target)
			}
			if test.wantReason != "" && !containsString(mapped.Coverage.Reasons, test.wantReason) {
				t.Fatalf("coverage reasons = %v, want %q", mapped.Coverage.Reasons, test.wantReason)
			}
			if test.wantCoverage == dto.ResourceRelationshipCoverageFull && reasonContains(mapped.Coverage.Reasons, "inconsistent relationship metadata") {
				t.Fatalf("valid virtual merge was marked inconsistent: %v", mapped.Coverage.Reasons)
			}
		})
	}
}

func TestCustomResourceFanOutPartialCannotProveRelationshipAbsence(t *testing.T) {
	tests := []struct {
		name      string
		scope     string
		namespace string
		path      string
		status    int
		invoke    func(*clusterPlane, customResourceClientsProvider) (CustomResourcesSnapshot, error)
	}{
		{
			name: "cluster denied", scope: "Cluster", path: "/apis/operator.example.com/v1/widgets", status: http.StatusForbidden,
			invoke: func(plane *clusterPlane, clients customResourceClientsProvider) (CustomResourcesSnapshot, error) {
				return plane.ClusterCustomResourcesSnapshot(context.Background(), newWorkScheduler(1), clients, WorkPriorityCritical)
			},
		},
		{
			name: "namespaced error", scope: "Namespaced", namespace: "apps", path: "/apis/operator.example.com/v1/namespaces/apps/widgets", status: http.StatusInternalServerError,
			invoke: func(plane *clusterPlane, clients customResourceClientsProvider) (CustomResourcesSnapshot, error) {
				return plane.CustomResourcesSnapshot(context.Background(), newWorkScheduler(1), clients, "apps", WorkPriorityCritical)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
			seedCompleteEmptyResourceMapInventory(plane)
			seedCustomResourceCRD(plane, test.scope)
			snapshot, err := test.invoke(plane, newCustomResourceClientsWithStatus(t, test.path, test.status))
			if err != nil {
				t.Fatalf("partial fan-out returned aggregate error: %v", err)
			}
			if len(snapshot.Items) != 0 || snapshot.RelationshipMetadata == nil {
				t.Fatalf("partial empty snapshot = %+v", snapshot)
			}
			ownerCoverage := snapshot.RelationshipMetadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]
			if ownerCoverage.Coverage != dto.ResourceRelationshipCoveragePartial || ownerCoverage.Completeness != dto.ResourceRelationshipCompletenessPartial {
				t.Fatalf("partial fan-out owner envelope = %+v", ownerCoverage)
			}
			target := resourceMapIdentity("operator.example.com", "v1", "widgets", "Widget", test.namespace, "missing", "")
			mapped, err := plane.ResourceMap(ResourceMapRequest{Target: target})
			if err != nil {
				t.Fatal(err)
			}
			if mapped.Target.Availability != ResourceMapAvailabilityUnknown || !reasonContains(mapped.Coverage.Reasons, "inexact owner relationship metadata") {
				t.Fatalf("partial custom-resource fan-out proved absence: target=%+v coverage=%+v", mapped.Target, mapped.Coverage)
			}
		})
	}
}

func TestCustomResourceFailedFetchDoesNotCreateRelationshipEnvelope(t *testing.T) {
	plane := customResourceRelationshipTestPlane(DefaultDataplanePolicy(), nil)
	seedCustomResourceCRD(plane, "Cluster")
	snapshot, err := plane.ClusterCustomResourcesSnapshot(
		context.Background(), newWorkScheduler(1),
		customResourceClientsProvider{err: errors.New("cluster unavailable")},
		WorkPriorityCritical,
	)
	if err == nil {
		t.Fatal("failed cluster custom-resource fetch unexpectedly succeeded")
	}
	if snapshot.Relationships != nil || snapshot.RelationshipMetadata != nil {
		t.Fatalf("failed fetch created relationship proof: relationships=%+v metadata=%+v", snapshot.Relationships, snapshot.RelationshipMetadata)
	}
}

func TestCustomResourcePersistedFallbackRetainsRelationshipSidecar(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	livePlane := customResourceRelationshipTestPlane(policy, store)
	seedCustomResourceCRD(livePlane, "Namespaced")
	live, err := livePlane.CustomResourcesSnapshot(
		context.Background(), newWorkScheduler(1),
		newCustomResourceClients(t, "/apis/operator.example.com/v1/namespaces/apps/widgets", "apps"),
		"apps", WorkPriorityCritical,
	)
	if err != nil {
		t.Fatalf("persist successful bespoke snapshot: %v", err)
	}
	if len(live.Relationships) != 1 {
		t.Fatalf("persisted live relationships = %+v", live.Relationships)
	}

	fallbackPlane := customResourceRelationshipTestPlane(policy, store)
	seedCustomResourceCRD(fallbackPlane, "Namespaced")
	fallback, err := fallbackPlane.CustomResourcesSnapshot(
		context.Background(), newWorkScheduler(1),
		customResourceClientsProvider{err: errors.New("cluster unavailable")},
		"apps", WorkPriorityCritical,
	)
	if err == nil {
		t.Fatal("failed bespoke refresh unexpectedly succeeded")
	}
	if !reflect.DeepEqual(fallback.Relationships, live.Relationships) {
		t.Fatalf("fallback relationships = %+v, want %+v", fallback.Relationships, live.Relationships)
	}
	if !reflect.DeepEqual(fallback.RelationshipMetadata, live.RelationshipMetadata) {
		t.Fatalf("fallback relationship envelope = %+v, want %+v", fallback.RelationshipMetadata, live.RelationshipMetadata)
	}
	if fallback.Meta.Freshness != FreshnessClassStale {
		t.Fatalf("fallback freshness = %q, want stale", fallback.Meta.Freshness)
	}
}

type customResourceClientsProvider struct {
	clients *cluster.Clients
	err     error
}

func (p customResourceClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return p.clients, "ctx", p.err
}

func newCustomResourceClients(t *testing.T, customResourcePath, namespace string) customResourceClientsProvider {
	t.Helper()
	return newCustomResourceClientsWithItems(t, customResourcePath, []any{map[string]any{
		"apiVersion": "operator.example.com/v1",
		"kind":       "Widget",
		"metadata": map[string]any{
			"name":      "widget",
			"namespace": namespace,
			"uid":       "widget-uid",
		},
	}})
}

func newCustomResourceClientsWithItems(t *testing.T, customResourcePath string, items []any) customResourceClientsProvider {
	return newCustomResourceClientsWithManifest(t, customResourcePath, items, "")
}

func newCustomResourceClientsWithManifest(t *testing.T, customResourcePath string, items []any, manifest string) customResourceClientsProvider {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case customResourcePath:
			response := map[string]any{
				"apiVersion": "operator.example.com/v1",
				"kind":       "WidgetList",
				"metadata":   map[string]any{},
				"items":      items,
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				t.Errorf("encode custom resource response: %v", err)
			}
		case "/api/v1/namespaces/apps/secrets":
			secrets := &corev1.SecretList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"}}
			if manifest != "" {
				secrets.Items = []corev1.Secret{helmReleaseSecret(t, manifest)}
			}
			if err := json.NewEncoder(w).Encode(secrets); err != nil {
				t.Errorf("encode Helm secret response: %v", err)
			}
		default:
			http.Error(w, "unexpected Kubernetes request: "+r.URL.String(), http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	config := &rest.Config{Host: server.URL}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		t.Fatalf("create Kubernetes clientset: %v", err)
	}
	return customResourceClientsProvider{clients: &cluster.Clients{RestConfig: config, Clientset: clientset}}
}

func newCustomResourceClientsWithStatus(t *testing.T, customResourcePath string, status int) customResourceClientsProvider {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case customResourcePath:
			http.Error(w, http.StatusText(status), status)
		case "/api/v1/namespaces/apps/secrets":
			_ = json.NewEncoder(w).Encode(&corev1.SecretList{})
		default:
			http.Error(w, "unexpected Kubernetes request: "+r.URL.String(), http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	config := &rest.Config{Host: server.URL}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		t.Fatalf("create Kubernetes clientset: %v", err)
	}
	return customResourceClientsProvider{clients: &cluster.Clients{RestConfig: config, Clientset: clientset}}
}

func helmReleaseSecret(t *testing.T, manifest string) corev1.Secret {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"name": "widgets", "namespace": "apps", "version": 1, "manifest": manifest,
		"info": map[string]any{"status": "deployed"},
	})
	if err != nil {
		t.Fatalf("marshal Helm release: %v", err)
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(payload); err != nil {
		t.Fatalf("compress Helm release: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close Helm release compressor: %v", err)
	}
	encoded := base64.StdEncoding.EncodeToString(compressed.Bytes())
	return corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: "sh.helm.release.v1.widgets.v1", Namespace: "apps",
			Labels: map[string]string{"owner": "helm", "name": "widgets", "status": "deployed", "version": "1"},
		},
		Type: "helm.sh/release.v1",
		Data: map[string][]byte{"release": []byte(encoded)},
	}
}

func assertCustomResourceRelationshipEnvelope(t *testing.T, snapshot CustomResourcesSnapshot, sourceItems, evidenceRecords int) {
	t.Helper()
	metadata := snapshot.RelationshipMetadata
	if metadata == nil {
		t.Fatal("successful custom-resource snapshot omitted relationship envelope")
	}
	if metadata.Version != dto.ResourceRelationshipSnapshotMetadataVersion || metadata.SourceItems != sourceItems || metadata.EvidenceRecords != evidenceRecords {
		t.Fatalf("relationship envelope = %+v, want version=%d sourceItems=%d evidenceRecords=%d", metadata, dto.ResourceRelationshipSnapshotMetadataVersion, sourceItems, evidenceRecords)
	}
	want := dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoverageFull, Completeness: dto.ResourceRelationshipCompletenessComplete}
	if got := metadata.FamilyCoverage[dto.ResourceRelationshipFamilyOwner]; got != want {
		t.Fatalf("owner family coverage = %+v, want %+v", got, want)
	}
}

func customResourceRelationshipItem(namespace, name, uid, evidence string) dto.CustomResourceInstanceDTO {
	scope := dto.ResourceScopeCluster
	if namespace != "" {
		scope = dto.ResourceScopeNamespaced
	}
	identity := dto.ResourceIdentityDTO{
		Group: "operator.example.com", Version: "v1", Resource: "widgets", Kind: "Widget",
		Scope: scope, Namespace: namespace, Name: name, UID: uid,
	}
	return dto.CustomResourceInstanceDTO{
		ResourceRelationshipCarrier: dto.ResourceRelationshipCarrier{
			Resource: identity,
			References: []dto.ResourceReferenceDTO{{
				Type:   dto.ResourceRelationshipTypeObjectReference,
				Target: dto.ResourceIdentityDTO{Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Scope: dto.ResourceScopeNamespaced, Namespace: namespace, Name: "settings"},
				Source: dto.ResourceRelationshipSourceDTO{Type: dto.ResourceRelationshipSourceKubernetes, FieldPath: ".spec.settingsRef"},
				Evidence: dto.ResourceRelationshipEvidenceDTO{
					Description: evidence,
				},
				Coverage: dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial},
			}},
			Coverage: dto.ResourceRelationshipCoverageDTO{Coverage: dto.ResourceRelationshipCoveragePartial, Completeness: dto.ResourceRelationshipCompletenessPartial},
		},
		Name: name, Namespace: namespace, Kind: "Widget", Group: "operator.example.com", Version: "v1", Resource: "widgets",
	}
}

func customResourceRelationshipTestPlane(policy DataplanePolicy, persistence snapshotPersistence) *clusterPlane {
	return newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy {
		return policy
	}, func() snapshotPersistence {
		return persistence
	}, nil)
}

func seedCustomResourceCRD(plane *clusterPlane, scope string) {
	setClusterSnapshot(&plane.crdsStore, CRDsSnapshot{
		Items: []dto.CRDListItemDTO{{
			Name: "widgets.operator.example.com", Group: "operator.example.com", Scope: scope,
			Kind: "Widget", StorageVersion: "v1", Plural: "widgets",
		}},
		Meta: SnapshotMetadata{ObservedAt: time.Now().UTC()},
	})
}
