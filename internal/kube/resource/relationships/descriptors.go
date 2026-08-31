package relationships

import "github.com/korex-labs/kview/v5/internal/kube/dto"

// IdentityDescriptor is the type-level Kubernetes identity shared by every
// object of one API resource. Dynamic custom resources construct descriptors
// from CRD discovery; fixed built-in resources use the registry below.
type IdentityDescriptor struct {
	Group    string
	Version  string
	Resource string
	Kind     string
	Scope    dto.ResourceScope
}

var (
	NamespaceDescriptor                = IdentityDescriptor{"", "v1", "namespaces", "Namespace", dto.ResourceScopeCluster}
	PodDescriptor                      = IdentityDescriptor{"", "v1", "pods", "Pod", dto.ResourceScopeNamespaced}
	DeploymentDescriptor               = IdentityDescriptor{"apps", "v1", "deployments", "Deployment", dto.ResourceScopeNamespaced}
	NodeDescriptor                     = IdentityDescriptor{"", "v1", "nodes", "Node", dto.ResourceScopeCluster}
	PersistentVolumeDescriptor         = IdentityDescriptor{"", "v1", "persistentvolumes", "PersistentVolume", dto.ResourceScopeCluster}
	ClusterRoleDescriptor              = IdentityDescriptor{"rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", dto.ResourceScopeCluster}
	ClusterRoleBindingDescriptor       = IdentityDescriptor{"rbac.authorization.k8s.io", "v1", "clusterrolebindings", "ClusterRoleBinding", dto.ResourceScopeCluster}
	CustomResourceDefinitionDescriptor = IdentityDescriptor{"apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", dto.ResourceScopeCluster}
	ServiceDescriptor                  = IdentityDescriptor{"", "v1", "services", "Service", dto.ResourceScopeNamespaced}
	IngressDescriptor                  = IdentityDescriptor{"networking.k8s.io", "v1", "ingresses", "Ingress", dto.ResourceScopeNamespaced}
	NetworkPolicyDescriptor            = IdentityDescriptor{"networking.k8s.io", "v1", "networkpolicies", "NetworkPolicy", dto.ResourceScopeNamespaced}
	PersistentVolumeClaimDescriptor    = IdentityDescriptor{"", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", dto.ResourceScopeNamespaced}
	ConfigMapDescriptor                = IdentityDescriptor{"", "v1", "configmaps", "ConfigMap", dto.ResourceScopeNamespaced}
	SecretDescriptor                   = IdentityDescriptor{"", "v1", "secrets", "Secret", dto.ResourceScopeNamespaced}
	ServiceAccountDescriptor           = IdentityDescriptor{"", "v1", "serviceaccounts", "ServiceAccount", dto.ResourceScopeNamespaced}
	RoleDescriptor                     = IdentityDescriptor{"rbac.authorization.k8s.io", "v1", "roles", "Role", dto.ResourceScopeNamespaced}
	RoleBindingDescriptor              = IdentityDescriptor{"rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", dto.ResourceScopeNamespaced}
	DaemonSetDescriptor                = IdentityDescriptor{"apps", "v1", "daemonsets", "DaemonSet", dto.ResourceScopeNamespaced}
	StatefulSetDescriptor              = IdentityDescriptor{"apps", "v1", "statefulsets", "StatefulSet", dto.ResourceScopeNamespaced}
	ReplicaSetDescriptor               = IdentityDescriptor{"apps", "v1", "replicasets", "ReplicaSet", dto.ResourceScopeNamespaced}
	JobDescriptor                      = IdentityDescriptor{"batch", "v1", "jobs", "Job", dto.ResourceScopeNamespaced}
	CronJobDescriptor                  = IdentityDescriptor{"batch", "v1", "cronjobs", "CronJob", dto.ResourceScopeNamespaced}
	HorizontalPodAutoscalerDescriptor  = IdentityDescriptor{"autoscaling", "v2", "horizontalpodautoscalers", "HorizontalPodAutoscaler", dto.ResourceScopeNamespaced}
	ResourceQuotaDescriptor            = IdentityDescriptor{"", "v1", "resourcequotas", "ResourceQuota", dto.ResourceScopeNamespaced}
	LimitRangeDescriptor               = IdentityDescriptor{"", "v1", "limitranges", "LimitRange", dto.ResourceScopeNamespaced}
)

// FixedIdentityDescriptors returns a caller-owned registry of all real, fixed
// Kubernetes list resources captured by production snapshot mappers. Dynamic
// CustomResource and virtual HelmRelease identities are intentionally excluded.
func FixedIdentityDescriptors() map[string]IdentityDescriptor {
	return map[string]IdentityDescriptor{
		"namespaces":                NamespaceDescriptor,
		"pods":                      PodDescriptor,
		"deployments":               DeploymentDescriptor,
		"nodes":                     NodeDescriptor,
		"persistentvolumes":         PersistentVolumeDescriptor,
		"clusterroles":              ClusterRoleDescriptor,
		"clusterrolebindings":       ClusterRoleBindingDescriptor,
		"customresourcedefinitions": CustomResourceDefinitionDescriptor,
		"services":                  ServiceDescriptor,
		"ingresses":                 IngressDescriptor,
		"networkpolicies":           NetworkPolicyDescriptor,
		"persistentvolumeclaims":    PersistentVolumeClaimDescriptor,
		"configmaps":                ConfigMapDescriptor,
		"secrets":                   SecretDescriptor,
		"serviceaccounts":           ServiceAccountDescriptor,
		"roles":                     RoleDescriptor,
		"rolebindings":              RoleBindingDescriptor,
		"daemonsets":                DaemonSetDescriptor,
		"statefulsets":              StatefulSetDescriptor,
		"replicasets":               ReplicaSetDescriptor,
		"jobs":                      JobDescriptor,
		"cronjobs":                  CronJobDescriptor,
		"horizontalpodautoscalers":  HorizontalPodAutoscalerDescriptor,
		"resourcequotas":            ResourceQuotaDescriptor,
		"limitranges":               LimitRangeDescriptor,
	}
}
