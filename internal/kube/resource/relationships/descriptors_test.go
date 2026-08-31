package relationships

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestFixedIdentityDescriptorsExactMatrixAndUniqueGVRScope(t *testing.T) {
	want := map[string]IdentityDescriptor{
		"namespaces":                {"", "v1", "namespaces", "Namespace", dto.ResourceScopeCluster},
		"pods":                      {"", "v1", "pods", "Pod", dto.ResourceScopeNamespaced},
		"deployments":               {"apps", "v1", "deployments", "Deployment", dto.ResourceScopeNamespaced},
		"nodes":                     {"", "v1", "nodes", "Node", dto.ResourceScopeCluster},
		"persistentvolumes":         {"", "v1", "persistentvolumes", "PersistentVolume", dto.ResourceScopeCluster},
		"clusterroles":              {"rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", dto.ResourceScopeCluster},
		"clusterrolebindings":       {"rbac.authorization.k8s.io", "v1", "clusterrolebindings", "ClusterRoleBinding", dto.ResourceScopeCluster},
		"customresourcedefinitions": {"apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", dto.ResourceScopeCluster},
		"services":                  {"", "v1", "services", "Service", dto.ResourceScopeNamespaced},
		"ingresses":                 {"networking.k8s.io", "v1", "ingresses", "Ingress", dto.ResourceScopeNamespaced},
		"networkpolicies":           {"networking.k8s.io", "v1", "networkpolicies", "NetworkPolicy", dto.ResourceScopeNamespaced},
		"persistentvolumeclaims":    {"", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", dto.ResourceScopeNamespaced},
		"configmaps":                {"", "v1", "configmaps", "ConfigMap", dto.ResourceScopeNamespaced},
		"secrets":                   {"", "v1", "secrets", "Secret", dto.ResourceScopeNamespaced},
		"serviceaccounts":           {"", "v1", "serviceaccounts", "ServiceAccount", dto.ResourceScopeNamespaced},
		"roles":                     {"rbac.authorization.k8s.io", "v1", "roles", "Role", dto.ResourceScopeNamespaced},
		"rolebindings":              {"rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", dto.ResourceScopeNamespaced},
		"daemonsets":                {"apps", "v1", "daemonsets", "DaemonSet", dto.ResourceScopeNamespaced},
		"statefulsets":              {"apps", "v1", "statefulsets", "StatefulSet", dto.ResourceScopeNamespaced},
		"replicasets":               {"apps", "v1", "replicasets", "ReplicaSet", dto.ResourceScopeNamespaced},
		"jobs":                      {"batch", "v1", "jobs", "Job", dto.ResourceScopeNamespaced},
		"cronjobs":                  {"batch", "v1", "cronjobs", "CronJob", dto.ResourceScopeNamespaced},
		"horizontalpodautoscalers":  {"autoscaling", "v2", "horizontalpodautoscalers", "HorizontalPodAutoscaler", dto.ResourceScopeNamespaced},
		"resourcequotas":            {"", "v1", "resourcequotas", "ResourceQuota", dto.ResourceScopeNamespaced},
		"limitranges":               {"", "v1", "limitranges", "LimitRange", dto.ResourceScopeNamespaced},
	}
	got := FixedIdentityDescriptors()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fixed descriptor registry mismatch\n got: %#v\nwant: %#v", got, want)
	}

	identities := make(map[string]string, len(got))
	for snapshotKind, descriptor := range got {
		identity := fmt.Sprintf("%s/%s/%s/%s", descriptor.Group, descriptor.Version, descriptor.Resource, descriptor.Scope)
		if previous, exists := identities[identity]; exists {
			t.Fatalf("snapshot kinds %q and %q share GVR/scope identity %q", previous, snapshotKind, identity)
		}
		identities[identity] = snapshotKind
	}
}

func TestProductionListMappersCaptureAllIdentityDescriptors(t *testing.T) {
	// The production identity set is 25 fixed Kubernetes kinds plus the one
	// dynamic CustomResource mapper. HelmRelease is virtual and has no LIST mapper.
	wiring := map[string]struct {
		path             string
		descriptorSymbol string
	}{
		"namespaces":                {"namespaces/namespaces.go", "NamespaceDescriptor"},
		"pods":                      {"pods/pods.go", "PodDescriptor"},
		"deployments":               {"deployments/deployments.go", "DeploymentDescriptor"},
		"nodes":                     {"nodes/nodes.go", "NodeDescriptor"},
		"persistentvolumes":         {"persistentvolumes/persistentvolumes.go", "PersistentVolumeDescriptor"},
		"clusterroles":              {"clusterroles/clusterroles.go", "ClusterRoleDescriptor"},
		"clusterrolebindings":       {"clusterrolebindings/clusterrolebindings.go", "ClusterRoleBindingDescriptor"},
		"customresourcedefinitions": {"customresourcedefinitions/customresourcedefinitions.go", "CustomResourceDefinitionDescriptor"},
		"services":                  {"services/services.go", "ServiceDescriptor"},
		"ingresses":                 {"ingresses/ingresses.go", "IngressDescriptor"},
		"networkpolicies":           {"networkpolicies/networkpolicies.go", "NetworkPolicyDescriptor"},
		"persistentvolumeclaims":    {"persistentvolumeclaims/persistentvolumeclaims.go", "PersistentVolumeClaimDescriptor"},
		"configmaps":                {"configmaps/configmaps.go", "ConfigMapDescriptor"},
		"secrets":                   {"secrets/secrets.go", "SecretDescriptor"},
		"serviceaccounts":           {"serviceaccounts/serviceaccounts.go", "ServiceAccountDescriptor"},
		"roles":                     {"roles/roles.go", "RoleDescriptor"},
		"rolebindings":              {"rolebindings/rolebindings.go", "RoleBindingDescriptor"},
		"daemonsets":                {"daemonsets/daemonsets.go", "DaemonSetDescriptor"},
		"statefulsets":              {"statefulsets/statefulsets.go", "StatefulSetDescriptor"},
		"replicasets":               {"replicasets/replicasets.go", "ReplicaSetDescriptor"},
		"jobs":                      {"jobs/jobs.go", "JobDescriptor"},
		"cronjobs":                  {"cronjobs/cronjobs.go", "CronJobDescriptor"},
		"horizontalpodautoscalers":  {"horizontalpodautoscalers/horizontalpodautoscalers.go", "HorizontalPodAutoscalerDescriptor"},
		"resourcequotas":            {"resourcequotas/resourcequotas.go", "ResourceQuotaDescriptor"},
		"limitranges":               {"limitranges/limitranges.go", "LimitRangeDescriptor"},
		"customresources":           {"customresources/list_aggregated.go", "descriptor"},
	}
	if len(wiring) != 26 {
		t.Fatalf("production wiring contract covers %d identities, want 26", len(wiring))
	}

	for snapshotKind, contract := range wiring {
		t.Run(snapshotKind, func(t *testing.T) {
			path := filepath.Join("..", contract.path)
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			if !hasRelationshipCapture(file, contract.descriptorSymbol) {
				t.Fatalf("%s no longer assigns relationships.Capture(..., %s) to ResourceRelationshipCarrier", path, contract.descriptorSymbol)
			}
		})
	}
}

func hasRelationshipCapture(file *ast.File, descriptorSymbol string) bool {
	found := false
	ast.Inspect(file, func(node ast.Node) bool {
		function, ok := node.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			return true
		}
		captured := map[string]bool{}
		ast.Inspect(function.Body, func(inner ast.Node) bool {
			assignment, ok := inner.(*ast.AssignStmt)
			if !ok {
				return true
			}
			for i, value := range assignment.Rhs {
				if i < len(assignment.Lhs) && containsRelationshipCapture(value, descriptorSymbol) {
					if identifier, ok := assignment.Lhs[i].(*ast.Ident); ok {
						captured[identifier.Name] = true
					}
				}
			}
			return true
		})
		ast.Inspect(function.Body, func(inner ast.Node) bool {
			keyValue, ok := inner.(*ast.KeyValueExpr)
			if !ok || identifierName(keyValue.Key) != "ResourceRelationshipCarrier" {
				return true
			}
			if containsRelationshipCapture(keyValue.Value, descriptorSymbol) {
				found = true
				return false
			}
			if identifier, ok := keyValue.Value.(*ast.Ident); ok && captured[identifier.Name] {
				found = true
				return false
			}
			return true
		})
		return !found
	})
	return found
}

func isRelationshipCapture(expression ast.Expr, descriptorSymbol string) bool {
	call, ok := expression.(*ast.CallExpr)
	if !ok || len(call.Args) != 2 {
		return false
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || identifierName(selector.X) != "relationships" || selector.Sel.Name != "Capture" {
		return false
	}
	switch descriptor := call.Args[1].(type) {
	case *ast.SelectorExpr:
		return identifierName(descriptor.X) == "relationships" && descriptor.Sel.Name == descriptorSymbol
	case *ast.Ident:
		return descriptor.Name == descriptorSymbol
	default:
		return false
	}
}

func containsRelationshipCapture(expression ast.Expr, descriptorSymbol string) bool {
	found := false
	ast.Inspect(expression, func(node ast.Node) bool {
		candidate, ok := node.(ast.Expr)
		if ok && isRelationshipCapture(candidate, descriptorSymbol) {
			found = true
			return false
		}
		return !found
	})
	return found
}

func identifierName(expression ast.Expr) string {
	identifier, _ := expression.(*ast.Ident)
	if identifier == nil {
		return ""
	}
	return identifier.Name
}
