package dataplane

import "sort"

type dashboardSignalStore struct {
	items      []ClusterDashboardSignal
	byResource map[dashboardSignalResourceKey][]ClusterDashboardSignal
}

type dashboardSignalResourceSignals struct {
	ResourceKind  string
	ResourceName  string
	Scope         string
	ScopeLocation string
	Signals       []ClusterDashboardSignal
}

type dashboardSignalResourceKey struct {
	kind          string
	name          string
	scope         string
	scopeLocation string
}

type dashboardSignalDefinition struct {
	Type            string
	Label           string
	SummaryCounter  string
	ActualData      string
	CalculatedData  string
	LikelyCause     string
	SuggestedAction string
	Priority        int
}

func newDashboardSignalStore() dashboardSignalStore {
	return dashboardSignalStore{
		byResource: map[dashboardSignalResourceKey][]ClusterDashboardSignal{},
	}
}

func (s *dashboardSignalStore) Add(items ...ClusterDashboardSignal) {
	for _, item := range items {
		s.items = append(s.items, item)
		key := dashboardSignalResourceKeyFor(item)
		if key.kind == "" || key.name == "" {
			continue
		}
		s.byResource[key] = append(s.byResource[key], item)
	}
}

func (s dashboardSignalStore) Items() []ClusterDashboardSignal {
	if len(s.items) == 0 {
		return nil
	}
	out := make([]ClusterDashboardSignal, len(s.items))
	copy(out, s.items)
	return out
}

func (s dashboardSignalStore) Len() int {
	return len(s.items)
}

func (s dashboardSignalStore) SignalsForResource(kind, name, scope, scopeLocation string) []ClusterDashboardSignal {
	key := dashboardSignalResourceKey{
		kind:          kind,
		name:          name,
		scope:         scope,
		scopeLocation: scopeLocation,
	}
	items := s.byResource[key]
	if len(items) == 0 {
		return nil
	}
	out := make([]ClusterDashboardSignal, len(items))
	copy(out, items)
	return out
}

func (s dashboardSignalStore) ResourceSignals() []dashboardSignalResourceSignals {
	if len(s.byResource) == 0 {
		return nil
	}
	keys := make([]dashboardSignalResourceKey, 0, len(s.byResource))
	for key := range s.byResource {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].scope != keys[j].scope {
			return keys[i].scope < keys[j].scope
		}
		if keys[i].scopeLocation != keys[j].scopeLocation {
			return keys[i].scopeLocation < keys[j].scopeLocation
		}
		if keys[i].kind != keys[j].kind {
			return keys[i].kind < keys[j].kind
		}
		return keys[i].name < keys[j].name
	})

	out := make([]dashboardSignalResourceSignals, 0, len(keys))
	for _, key := range keys {
		signals := s.SignalsForResource(key.kind, key.name, key.scope, key.scopeLocation)
		out = append(out, dashboardSignalResourceSignals{
			ResourceKind:  key.kind,
			ResourceName:  key.name,
			Scope:         key.scope,
			ScopeLocation: key.scopeLocation,
			Signals:       signals,
		})
	}
	return out
}

func (s dashboardSignalStore) Summary(limit int, opts ClusterDashboardListOptions) ClusterDashboardSignalsPanel {
	return summarizeDashboardSignals(s.Items(), limit, opts)
}

func dashboardSignalResourceKeyFor(item ClusterDashboardSignal) dashboardSignalResourceKey {
	kind := item.ResourceKind
	if kind == "" {
		kind = item.Kind
	}
	name := item.ResourceName
	if name == "" {
		name = item.Name
	}
	return dashboardSignalResourceKey{
		kind:          kind,
		name:          name,
		scope:         item.Scope,
		scopeLocation: item.ScopeLocation,
	}
}

func dashboardSignalDefinitionForType(signalType string) dashboardSignalDefinition {
	if def, ok := dashboardSignalDefinitions[signalType]; ok {
		return def
	}
	return dashboardSignalDefinition{Type: signalType, Label: signalType, Priority: 10}
}

var dashboardSignalDefinitions = map[string]dashboardSignalDefinition{
	"pod_restarts": {
		Type:            "pod_restarts",
		Label:           "Pod restarts",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "restart count is at least 5",
		LikelyCause:     "The pod may be repeatedly crashing, failing health checks, or restarting after node/runtime interruptions.",
		SuggestedAction: "Open pod logs and events, inspect container restart reasons, and check whether the owning workload recently rolled out or is failing probes.",
		Priority:        0,
	},
	"stale_transitional_helm_release": {
		Type:            "stale_transitional_helm_release",
		Label:           "Stuck Helm releases",
		SummaryCounter:  "stuck_helm_releases",
		CalculatedData:  "transitional Helm status for more than 15 minutes, or transitional with unknown update time",
		LikelyCause:     "A Helm upgrade, rollback, or uninstall likely stalled on hooks, failing resources, or an interrupted release operation.",
		SuggestedAction: "Inspect the release status, recent Helm history, and related workload events. Resolve the blocking resource or hook, then finish or roll back the release cleanly.",
		Priority:        1,
	},
	"abnormal_job": {
		Type:            "abnormal_job",
		Label:           "Abnormal jobs",
		SummaryCounter:  "abnormal_jobs",
		CalculatedData:  "failed status or failed attempts observed",
		LikelyCause:     "The job probably has failing pods, image/config problems, missing dependencies, or logic that exits unsuccessfully.",
		SuggestedAction: "Open the job and pod logs, inspect events, and fix the failing input, dependency, or image issue before rerunning.",
		Priority:        2,
	},
	"long_running_job": {
		Type:            "long_running_job",
		Label:           "Long-running jobs",
		SummaryCounter:  "abnormal_jobs",
		CalculatedData:  "running for more than 6 hours",
		LikelyCause:     "The job may be blocked on external work, stuck waiting on resources, or looping without making progress.",
		SuggestedAction: "Inspect active pods, logs, and related dependencies. If it is intentionally long-running, consider moving it to a different workload type or adjusting expectations.",
		Priority:        2,
	},
	"abnormal_cronjob": {
		Type:            "abnormal_cronjob",
		Label:           "Abnormal CronJobs",
		SummaryCounter:  "abnormal_cronjobs",
		CalculatedData:  "unusually large active job count",
		LikelyCause:     "The schedule may be producing overlapping runs, repeatedly failing, or never completing successfully.",
		SuggestedAction: "Review recent job history, concurrency policy, schedule, and pod failures. Reduce overlap or fix the underlying job failure before the backlog grows.",
		Priority:        3,
	},
	"cronjob_no_recent_success": {
		Type:            "cronjob_no_recent_success",
		Label:           "CronJobs without recent success",
		SummaryCounter:  "abnormal_cronjobs",
		CalculatedData:  "no recorded successful run after more than 24 hours",
		LikelyCause:     "The schedule may be producing overlapping runs, repeatedly failing, or never completing successfully.",
		SuggestedAction: "Review recent job history, concurrency policy, schedule, and pod failures. Reduce overlap or fix the underlying job failure before the backlog grows.",
		Priority:        3,
	},
	"hpa_needs_attention": {
		Type:            "hpa_needs_attention",
		Label:           "HPA warnings",
		SummaryCounter:  "hpa_warnings",
		CalculatedData:  "HPA status condition or replica bounds need attention",
		LikelyCause:     "The autoscaler may be unable to read metrics, unable to reach its scale target, pinned at maxReplicas, or below minReplicas.",
		SuggestedAction: "Inspect HPA conditions, metric targets, and the referenced workload. Check metrics-server/custom metrics health before changing replica bounds.",
		Priority:        4,
	},
	"resource_quota_pressure": {
		Type:            "resource_quota_pressure",
		Label:           "Quota pressure",
		SummaryCounter:  "quota_warnings",
		CalculatedData:  "quota usage is at least 80% of hard limit",
		LikelyCause:     "The namespace is approaching its configured quota because workload growth or a runaway job is consuming the remaining budget.",
		SuggestedAction: "Inspect which resource is close to the hard limit, then either scale usage back down or raise the quota if the growth is intentional.",
		Priority:        4,
	},
	"pvc_needs_attention": {
		Type:            "pvc_needs_attention",
		Label:           "PVC warnings",
		SummaryCounter:  "pvc_warnings",
		CalculatedData:  "PVC phase or resize signal needs attention",
		LikelyCause:     "The claim may belong to a removed workload, a failed rollout, or a namespace that no longer has active consumers.",
		SuggestedAction: "Check what last mounted it and whether data must be kept. Delete or archive it only after confirming retention expectations.",
		Priority:        5,
	},
	"potentially_unused_pvc": {
		Type:            "potentially_unused_pvc",
		Label:           "Potentially unused PVCs",
		SummaryCounter:  "potentially_unused_pvcs",
		CalculatedData:  "no pods present in cached namespace snapshot",
		LikelyCause:     "The claim may belong to a removed workload, a failed rollout, or a namespace that no longer has active consumers.",
		SuggestedAction: "Check what last mounted it and whether data must be kept. Delete or archive it only after confirming retention expectations.",
		Priority:        5,
	},
	"service_no_ready_endpoints": {
		Type:            "service_no_ready_endpoints",
		Label:           "Service endpoints",
		SummaryCounter:  "service_warnings",
		CalculatedData:  "0 ready endpoints",
		LikelyCause:     "The service selector may not match any ready pods, or all selected pods are currently not ready.",
		SuggestedAction: "Inspect the service endpoints and selector labels, then open the selected workloads or pods to restore ready backends.",
		Priority:        6,
	},
	"ingress_pending_address": {
		Type:            "ingress_pending_address",
		Label:           "Ingress pending address",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "ingress address or routing health needs attention",
		LikelyCause:     "The ingress controller may not have admitted the route yet, or the backend/service wiring is incomplete.",
		SuggestedAction: "Inspect ingress events, address assignment, TLS/backend references, and the services behind the route.",
		Priority:        6,
	},
	"ingress_needs_attention": {
		Type:            "ingress_needs_attention",
		Label:           "Ingress routing",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "ingress address or routing health needs attention",
		LikelyCause:     "The ingress controller may not have admitted the route yet, or the backend/service wiring is incomplete.",
		SuggestedAction: "Inspect ingress events, address assignment, TLS/backend references, and the services behind the route.",
		Priority:        6,
	},
	"potentially_unused_serviceaccount": {
		Type:            "potentially_unused_serviceaccount",
		Label:           "Potentially unused service accounts",
		SummaryCounter:  "potentially_unused_serviceaccounts",
		CalculatedData:  "non-default service account with no pods present in cached namespace snapshot",
		LikelyCause:     "The service account may have been created for a workload that no longer runs in this namespace.",
		SuggestedAction: "Verify whether any pods or controllers still reference it. Remove it if unused, especially if it carries extra permissions.",
		Priority:        7,
	},
	"role_permission_surface": {
		Type:            "role_permission_surface",
		Label:           "Roles",
		SummaryCounter:  "role_warnings",
		CalculatedData:  "empty or broad rule surface",
		LikelyCause:     "The role may be a placeholder with no rules or a broad permission surface that deserves review.",
		SuggestedAction: "Review the rules and confirm the role is intentionally broad; otherwise narrow or remove it.",
		Priority:        7,
	},
	"rolebinding_subject_surface": {
		Type:            "rolebinding_subject_surface",
		Label:           "RoleBindings",
		SummaryCounter:  "rolebinding_warnings",
		CalculatedData:  "empty or broad subject surface",
		LikelyCause:     "The binding may have no subjects or grant access to an unusually broad subject set.",
		SuggestedAction: "Review subjects and the referenced role, then remove stale subjects or split broad access into narrower bindings.",
		Priority:        7,
	},
	"empty_configmap": {
		Type:            "empty_configmap",
		Label:           "Empty ConfigMaps",
		SummaryCounter:  "empty_configmaps",
		ActualData:      "0 data keys",
		CalculatedData:  "empty ConfigMap",
		LikelyCause:     "The object may be a placeholder, partially applied manifest, or leftover config no workload actually uses.",
		SuggestedAction: "Confirm whether a workload mounts or references it. Populate the expected data or remove it if it is obsolete.",
		Priority:        8,
	},
	"empty_secret": {
		Type:            "empty_secret",
		Label:           "Empty Secrets",
		SummaryCounter:  "empty_secrets",
		ActualData:      "0 data keys",
		CalculatedData:  "empty Secret",
		LikelyCause:     "The secret may be an incomplete rollout artifact, placeholder, or stale object left behind by an old deployment.",
		SuggestedAction: "Verify whether anything references it. Restore the expected data or delete it if it is no longer used.",
		Priority:        8,
	},
	"empty_namespace": {
		Type:            "empty_namespace",
		Label:           "Empty namespaces",
		SummaryCounter:  "empty_namespaces",
		ActualData:      "0 workload, network, storage, config, and Helm resources in cached snapshots",
		CalculatedData:  "empty namespace candidate in cached scope",
		LikelyCause:     "The workload may have been removed earlier, or the namespace was created temporarily and never cleaned up.",
		SuggestedAction: "Check recent ownership and deploy history. If it is no longer needed, remove the namespace after confirming no retained data or policies still depend on it.",
		Priority:        9,
	},
	"container_near_limit": {
		Type:            "container_near_limit",
		Label:           "Pods near CPU or memory limit",
		SummaryCounter:  "container_near_limit",
		CalculatedData:  "pod usage is at or above the configured percentage of the container limit",
		LikelyCause:     "Actual workload traffic may have grown past what container limits allow, or the limits may be set too tight for the observed steady state.",
		SuggestedAction: "Review pod usage trends and container limits; raise limits if the usage is legitimate or investigate the workload for a leak or load spike.",
		Priority:        3,
	},
	"node_resource_pressure": {
		Type:            "node_resource_pressure",
		Label:           "Nodes under CPU or memory pressure",
		SummaryCounter:  "node_resource_pressure",
		CalculatedData:  "node usage is at or above the configured percentage of allocatable capacity",
		LikelyCause:     "Too many workloads may have been scheduled on the node, a workload may be consuming more resources than budgeted, or allocatable capacity may be reduced by system daemons.",
		SuggestedAction: "Review scheduled pods on the node, rebalance workloads, or scale the cluster; check for runaway processes if a single workload is dominating usage.",
		Priority:        2,
	},
	"pod_young_frequent_restarts": {
		Type:            "pod_young_frequent_restarts",
		Label:           "Pods restarting frequently in short lifetime",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "pod accumulated at least 5 restarts while age is 30 minutes or less",
		LikelyCause:     "The pod may be crash-looping on startup, failing probes right away, or tripping over image/config errors during initial rollout.",
		SuggestedAction: "Open pod logs and recent events, inspect container last-termination reasons, and verify that image, config, secrets, and probes are ready before the containers start.",
		Priority:        0,
	},
	"pod_succeeded_with_issues": {
		Type:            "pod_succeeded_with_issues",
		Label:           "Pods Succeeded with recorded issues",
		CalculatedData:  "phase Succeeded while conditions, container states, or Warning events indicate problems",
		LikelyCause:     "Short-lived pods (init containers, Jobs) can reach Succeeded even when earlier conditions or events captured problems that still matter for troubleshooting.",
		SuggestedAction: "Treat Succeeded as completion, not health: review the recorded conditions, container last-termination reasons, and Warning events to understand what happened.",
		Priority:        5,
	},
	"pod_missing_secret_reference": {
		Type:            "pod_missing_secret_reference",
		Label:           "Pods with missing Secret references",
		CalculatedData:  "pod warning events mention a referenced Secret could not be found or retrieved",
		LikelyCause:     "The pod spec, environment, volume, or image pull secret references a Secret that is absent, misspelled, or not available in the namespace.",
		SuggestedAction: "Create or restore the Secret, fix the pod/workload reference, or remove the reference if it is obsolete. Then restart or roll out the owning workload.",
		Priority:        1,
	},
	"deployment_unavailable": {
		Type:            "deployment_unavailable",
		Label:           "Deployments unavailable for extended time",
		CalculatedData:  "Available=False for more than 10 minutes, or no available replicas for a mature deployment",
		LikelyCause:     "The rollout may be stuck on failing pods, image or config errors, unschedulable replicas, or a bad probe/template change that prevents any replica from becoming available.",
		SuggestedAction: "Inspect the latest rollout, the active ReplicaSet, pod events, and probe configuration. Roll back or fix the failing template/dependency to restore available replicas.",
		Priority:        1,
	},
	"deployment_missing_template_reference": {
		Type:            "deployment_missing_template_reference",
		Label:           "Deployments with missing template references",
		CalculatedData:  "deployment pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The Deployment template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, update the Deployment template reference, then restart the rollout if pods are stuck on the old template.",
		Priority:        1,
	},
}
