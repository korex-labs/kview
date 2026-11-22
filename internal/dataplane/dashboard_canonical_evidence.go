package dataplane

import "github.com/korex-labs/kview/v5/internal/kube/dto"

// Consulted sources determine canonical transition confidence independently of
// active Dashboard membership. Unclassified rules retain unknown evidence.
var trendDependencies = map[string][]string{
	"empty_namespace":        {"pods", "deps", "ds", "sts", "rs", "jobs", "cjs", "hpas", "svcs", "ings", "pvcs", "cms", "secs", "helm"},
	"pod_image_pull_failure": {"pods"}, "pod_crash_loop_waiting": {"pods"}, "pod_unschedulable": {"pods"}, "pod_restarts": {"pods"},
	"deployment_unavailable": {"deps"}, "abnormal_job": {"jobs"}, "long_running_job": {"jobs"}, "abnormal_cronjob": {"cjs"}, "cronjob_no_recent_success": {"cjs"}, "hpa_needs_attention": {"hpas"}, "stale_transitional_helm_release": {"helm"},
	"service_no_matching_cached_pods": {"svcs", "podSelectorEvidence"}, "ingress_pending_address": {"ings"}, "ingress_needs_attention": {"ings"}, "ingress_backend_service_missing": {"ings", "svcs"},
	"pvc_needs_attention": {"pvcs"}, "pvc_node_bound_storage": {"pvcs", "pvs"}, "role_permission_surface": {"roles"}, "rolebinding_subject_surface": {"roleBindings"}, "resource_quota_pressure": {"quotas"}, "empty_configmap": {"cms"}, "empty_secret": {"secs"}, "potentially_unused_pvc": {"pvcs", "pods"}, "potentially_unused_serviceaccount": {"sas", "pods"}, "container_near_limit": {"pods", "podMetrics"},
}

// Only built-in canonical GVRs are accepted; a same-kind custom sidecar is not identity proof.
var trendSidecarTypes = map[string][3]string{
	"PersistentVolume": {"", "v1", "persistentvolumes"},
	"Pod":              {"", "v1", "pods"}, "Service": {"", "v1", "services"}, "ConfigMap": {"", "v1", "configmaps"}, "Secret": {"", "v1", "secrets"}, "ServiceAccount": {"", "v1", "serviceaccounts"}, "PersistentVolumeClaim": {"", "v1", "persistentvolumeclaims"}, "Node": {"", "v1", "nodes"}, "ResourceQuota": {"", "v1", "resourcequotas"},
	"Deployment": {"apps", "v1", "deployments"}, "DaemonSet": {"apps", "v1", "daemonsets"}, "StatefulSet": {"apps", "v1", "statefulsets"}, "ReplicaSet": {"apps", "v1", "replicasets"}, "Job": {"batch", "v1", "jobs"}, "CronJob": {"batch", "v1", "cronjobs"}, "HorizontalPodAutoscaler": {"autoscaling", "v2", "horizontalpodautoscalers"}, "Ingress": {"networking.k8s.io", "v1", "ingresses"}, "Role": {"rbac.authorization.k8s.io", "v1", "roles"}, "RoleBinding": {"rbac.authorization.k8s.io", "v1", "rolebindings"},
}

func trendSidecarKind(r dto.ResourceIdentityDTO, kind string) bool {
	gvr, ok := trendSidecarTypes[kind]
	return ok && r.Kind == kind && r.Group == gvr[0] && r.Version == gvr[1] && r.Resource == gvr[2]
}
