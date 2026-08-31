package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestProductionSnapshotDescriptorRelationshipWiring(t *testing.T) {
	required := map[string]string{
		"NamespacesSnapshot":          "dto.NamespaceListItemDTO",
		"NodesSnapshot":               "dto.NodeListItemDTO",
		"PersistentVolumesSnapshot":   "dto.PersistentVolumeDTO",
		"ClusterRolesSnapshot":        "dto.ClusterRoleListItemDTO",
		"ClusterRoleBindingsSnapshot": "dto.ClusterRoleBindingListItemDTO",
		"CRDsSnapshot":                "dto.CRDListItemDTO",
		"PodsSnapshot":                "dto.PodListItemDTO",
		"DeploymentsSnapshot":         "dto.DeploymentListItemDTO",
		"ServicesSnapshot":            "dto.ServiceListItemDTO",
		"IngressesSnapshot":           "dto.IngressListItemDTO",
		"NetworkPoliciesSnapshot":     "dto.NetworkPolicyDTO",
		"PVCsSnapshot":                "dto.PersistentVolumeClaimDTO",
		"ConfigMapsSnapshot":          "dto.ConfigMapDTO",
		"SecretsSnapshot":             "dto.SecretDTO",
		"ServiceAccountsSnapshot":     "dto.ServiceAccountListItemDTO",
		"RolesSnapshot":               "dto.RoleListItemDTO",
		"RoleBindingsSnapshot":        "dto.RoleBindingListItemDTO",
		"DaemonSetsSnapshot":          "dto.DaemonSetDTO",
		"StatefulSetsSnapshot":        "dto.StatefulSetDTO",
		"ReplicaSetsSnapshot":         "dto.ReplicaSetDTO",
		"JobsSnapshot":                "dto.JobDTO",
		"CronJobsSnapshot":            "dto.CronJobDTO",
		"HPAsSnapshot":                "dto.HorizontalPodAutoscalerDTO",
		"ResourceQuotasSnapshot":      "dto.ResourceQuotaDTO",
		"LimitRangesSnapshot":         "dto.LimitRangeDTO",
	}
	excluded := map[string]string{
		"HelmReleasesSnapshot": "dto.HelmReleaseDTO",
		"NodeMetricsSnapshot":  "dto.NodeMetricsDTO",
		"PodMetricsSnapshot":   "dto.PodMetricsDTO",
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "manager.go", nil, 0)
	if err != nil {
		t.Fatalf("parse production manager.go: %v", err)
	}

	type descriptorWiring struct {
		descriptorType string
		extractor      string
	}
	found := make(map[string]descriptorWiring)
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv == nil || fn.Body == nil {
			continue
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			literal, ok := node.(*ast.CompositeLit)
			if !ok {
				return true
			}
			descriptorName, descriptorType, ok := snapshotDescriptorType(fset, literal.Type)
			if !ok {
				return true
			}
			if _, duplicate := found[fn.Name.Name]; duplicate {
				t.Fatalf("production method %s declares multiple snapshot descriptors", fn.Name.Name)
			}
			wiring := descriptorWiring{descriptorType: descriptorType}
			for _, element := range literal.Elts {
				field, ok := element.(*ast.KeyValueExpr)
				if !ok || expressionSource(fset, field.Key) != "extractRelationships" {
					continue
				}
				wiring.extractor = expressionSource(fset, field.Value)
			}
			found[fn.Name.Name] = wiring
			_ = descriptorName
			return false
		})
	}

	for method, itemType := range required {
		wiring, ok := found[method]
		if !ok {
			t.Errorf("required production method %s has no snapshot descriptor", method)
			continue
		}
		if wiring.descriptorType != itemType {
			t.Errorf("%s descriptor generic = %s, want %s", method, wiring.descriptorType, itemType)
		}
		wantExtractor := "dto.ExtractResourceRelationships[" + itemType + "]"
		if wiring.extractor != wantExtractor {
			t.Errorf("%s extractor = %q, want %q", method, wiring.extractor, wantExtractor)
		}
	}
	for method, itemType := range excluded {
		wiring, ok := found[method]
		if !ok {
			t.Errorf("excluded production method %s has no snapshot descriptor", method)
			continue
		}
		if wiring.descriptorType != itemType {
			t.Errorf("%s descriptor generic = %s, want %s", method, wiring.descriptorType, itemType)
		}
		if wiring.extractor != "" {
			t.Errorf("excluded production method %s unexpectedly activates relationship extraction with %s", method, wiring.extractor)
		}
	}
	for method, wiring := range found {
		if _, ok := required[method]; ok {
			continue
		}
		if _, ok := excluded[method]; ok {
			continue
		}
		t.Errorf("unclassified production snapshot descriptor %s in %s; update the exhaustive relationship wiring contract", wiring.descriptorType, method)
	}
}

func TestProductionCustomResourceSnapshotRelationshipWiring(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "custom_resource_snapshots.go", nil, 0)
	if err != nil {
		t.Fatalf("parse production custom_resource_snapshots.go: %v", err)
	}
	required := map[string]int{
		"ClusterCustomResourcesSnapshot": 0,
		"CustomResourcesSnapshot":        0,
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		ast.Inspect(fn.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			identifier, ok := call.Fun.(*ast.Ident)
			if !ok || identifier.Name != "finalizeCustomResourceRelationshipSnapshot" {
				return true
			}
			if _, expected := required[fn.Name.Name]; !expected {
				t.Errorf("unclassified bespoke method %s fabricates a custom-resource relationship envelope", fn.Name.Name)
				return true
			}
			required[fn.Name.Name]++
			return true
		})
	}
	for method, calls := range required {
		if calls != 1 {
			t.Errorf("bespoke method %s calls finalizeCustomResourceRelationshipSnapshot %d times, want exactly 1", method, calls)
		}
	}
}

func snapshotDescriptorType(fset *token.FileSet, expr ast.Expr) (string, string, bool) {
	indexed, ok := expr.(*ast.IndexExpr)
	if !ok {
		return "", "", false
	}
	name := expressionSource(fset, indexed.X)
	if name != "clusterSnapshotDescriptor" && name != "namespacedSnapshotDescriptor" {
		return "", "", false
	}
	return name, expressionSource(fset, indexed.Index), true
}

func expressionSource(fset *token.FileSet, node ast.Node) string {
	var out strings.Builder
	if err := format.Node(&out, fset, node); err != nil {
		return "<format error>"
	}
	return out.String()
}

type productionRelationshipClientsProvider struct {
	clients *cluster.Clients
	err     error
}

func (p productionRelationshipClientsProvider) GetClientsForContext(context.Context, string) (*cluster.Clients, string, error) {
	return p.clients, "ctx", p.err
}

func TestProductionClusterDescriptorPersistsRelationshipSidecarAndFallsBack(t *testing.T) {
	node := corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-0", UID: types.UID("node-uid")}}
	clients := productionRelationshipClients(t, map[string]any{
		"/api/v1/nodes": &corev1.NodeList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "NodeList"}, Items: []corev1.Node{node}},
		"/api/v1/pods":  &corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}},
	})

	store := openRelationshipPersistence(t)
	policy := relationshipPersistencePolicy()
	plane := relationshipTestPlane(policy, store)
	live, err := plane.NodesSnapshot(context.Background(), newWorkScheduler(1), clients, WorkPriorityCritical)
	if err != nil {
		t.Fatalf("execute production NodesSnapshot: %v", err)
	}
	assertRelationshipResource(t, live.Relationships, "Node", "", "worker-0")

	fallbackPlane := relationshipTestPlane(policy, store)
	fallback, err := fallbackPlane.NodesSnapshot(context.Background(), newWorkScheduler(1), productionRelationshipClientsProvider{err: errors.New("cluster unavailable")}, WorkPriorityCritical)
	if err == nil {
		t.Fatal("failed cluster refresh unexpectedly succeeded")
	}
	if !reflect.DeepEqual(fallback.Relationships, live.Relationships) {
		t.Fatalf("cluster persisted fallback relationships = %+v, want %+v", fallback.Relationships, live.Relationships)
	}
}

func TestProductionNamespacedDescriptorPersistsRelationshipSidecarAndFallsBack(t *testing.T) {
	controller := true
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name:      "api-0",
		Namespace: "apps",
		UID:       types.UID("pod-uid"),
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-7f", UID: types.UID("rs-uid"), Controller: &controller,
		}},
	}}
	clients := productionRelationshipClients(t, map[string]any{
		"/api/v1/namespaces/apps/pods":   &corev1.PodList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"}, Items: []corev1.Pod{pod}},
		"/api/v1/namespaces/apps/events": &corev1.EventList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "EventList"}},
	})

	store := openRelationshipPersistence(t)
	policy := relationshipPersistencePolicy()
	plane := relationshipTestPlane(policy, store)
	live, err := plane.PodsSnapshot(context.Background(), newWorkScheduler(1), clients, "apps", WorkPriorityCritical)
	if err != nil {
		t.Fatalf("execute production PodsSnapshot: %v", err)
	}
	assertRelationshipResource(t, live.Relationships, "Pod", "apps", "api-0")
	if len(live.Relationships[0].Owners) != 1 || live.Relationships[0].Owners[0].Name != "api-7f" {
		t.Fatalf("production pod relationship owner = %+v", live.Relationships[0].Owners)
	}

	fallbackPlane := relationshipTestPlane(policy, store)
	fallback, err := fallbackPlane.PodsSnapshot(context.Background(), newWorkScheduler(1), productionRelationshipClientsProvider{err: errors.New("cluster unavailable")}, "apps", WorkPriorityCritical)
	if err == nil {
		t.Fatal("failed namespaced refresh unexpectedly succeeded")
	}
	if !reflect.DeepEqual(fallback.Relationships, live.Relationships) {
		t.Fatalf("namespaced persisted fallback relationships = %+v, want %+v", fallback.Relationships, live.Relationships)
	}
}

func productionRelationshipClients(t *testing.T, responses map[string]any) productionRelationshipClientsProvider {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response, ok := responses[r.URL.Path]
		if !ok {
			http.Error(w, "unexpected Kubernetes request: "+r.URL.String(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode Kubernetes response for %s: %v", r.URL.Path, err)
		}
	}))
	t.Cleanup(server.Close)
	config := &rest.Config{Host: server.URL}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		t.Fatalf("create Kubernetes clientset: %v", err)
	}
	return productionRelationshipClientsProvider{clients: &cluster.Clients{RestConfig: config, Clientset: clientset}}
}

func openRelationshipPersistence(t *testing.T) snapshotPersistence {
	t.Helper()
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/cache.bbolt")
	if err != nil {
		t.Fatalf("open relationship persistence: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func relationshipPersistencePolicy() DataplanePolicy {
	policy := DefaultDataplanePolicy()
	policy.Persistence.Enabled = true
	return policy
}

func relationshipTestPlane(policy DataplanePolicy, persistence snapshotPersistence) *clusterPlane {
	return newClusterPlane("ctx", ProfileFocused, DiscoveryModeTargeted, ObservationScope{}, func() DataplanePolicy {
		return policy
	}, func() snapshotPersistence {
		return persistence
	}, nil)
}

func assertRelationshipResource(t *testing.T, relationships []dto.ResourceRelationshipRecord, kind, namespace, name string) {
	t.Helper()
	if len(relationships) != 1 {
		t.Fatalf("relationship count = %d, want 1: %+v", len(relationships), relationships)
	}
	resource := relationships[0].Resource
	if resource.Kind != kind || resource.Namespace != namespace || resource.Name != name {
		t.Fatalf("relationship resource = %+v, want kind=%s namespace=%q name=%s", resource, kind, namespace, name)
	}
}
