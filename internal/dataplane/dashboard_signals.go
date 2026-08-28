package dataplane

import (
	"sort"
	"strings"
)

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
	FilterLabel     string
	SummaryCounter  string
	ActualData      string
	CalculatedData  string
	LikelyCause     string
	SuggestedAction string
	Priority        int
}

type SignalCatalogItem struct {
	Type              string          `json:"type"`
	Label             string          `json:"label"`
	SummaryCounter    string          `json:"summaryCounter,omitempty"`
	ActualData        string          `json:"actualData,omitempty"`
	CalculatedData    string          `json:"calculatedData,omitempty"`
	LikelyCause       string          `json:"likelyCause,omitempty"`
	SuggestedAction   string          `json:"suggestedAction,omitempty"`
	DefaultEnabled    bool            `json:"defaultEnabled"`
	DefaultSeverity   string          `json:"defaultSeverity,omitempty"`
	DefaultPriority   int             `json:"defaultPriority"`
	GlobalOverride    *SignalOverride `json:"globalOverride,omitempty"`
	ContextOverride   *SignalOverride `json:"contextOverride,omitempty"`
	EffectiveEnabled  bool            `json:"effectiveEnabled"`
	EffectiveSeverity string          `json:"effectiveSeverity,omitempty"`
	EffectivePriority int             `json:"effectivePriority"`
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

func dashboardSignalTypeKey(signalType string) string {
	return strings.TrimSpace(signalType)
}

func dashboardSignalKindLabel(kind string) string {
	switch kind {
	case "HorizontalPodAutoscaler":
		return "HPA"
	case "PersistentVolumeClaim":
		return "PVC"
	case "PersistentVolume":
		return "PV"
	case "ServiceAccount":
		return "SA"
	default:
		return kind
	}
}

func knownDashboardSignalType(signalType string) bool {
	_, ok := dashboardSignalDefinitions[signalType]
	return ok
}

func isSignalSeverityOverride(severity string) bool {
	switch severity {
	case "low", "medium", "high":
		return true
	default:
		return false
	}
}

func applySignalPolicy(items []ClusterDashboardSignal, policy DataplanePolicy, contextName string) []ClusterDashboardSignal {
	if len(items) == 0 {
		return nil
	}
	out := make([]ClusterDashboardSignal, 0, len(items))
	effectiveByType := make(map[string]effectiveSignalPolicy)
	compiledExclusions := make(map[string]compiledSignalExclusionSet)
	for _, item := range items {
		effective, ok := effectiveByType[item.SignalType]
		if !ok {
			effective = effectiveSignalSettings(policy, contextName, item.SignalType)
			effectiveByType[item.SignalType] = effective
			compiledExclusions[item.SignalType] = compileSignalExclusionSet(effective.exclusions)
		}
		if !effective.enabled {
			continue
		}
		if compiledExclusions[item.SignalType].excludes(item) {
			continue
		}
		if isSignalSeverityOverride(effective.severity) {
			item.Severity = effective.severity
		}
		item.SignalPriority = effective.priority
		out = append(out, item)
	}
	return out
}

// ApplySignalPolicy applies the active global/context signal overrides to
// detector output. It is exported for server-side detail detectors that live
// outside the dataplane manager methods.
func ApplySignalPolicy(items []ClusterDashboardSignal, policy DataplanePolicy, contextName string) []ClusterDashboardSignal {
	return applySignalPolicy(items, policy, contextName)
}

type effectiveSignalPolicy struct {
	enabled    bool
	severity   string
	priority   int
	exclusions *SignalExclusionSet
}

func effectiveSignalSettings(policy DataplanePolicy, contextName, signalType string) effectiveSignalPolicy {
	def := dashboardSignalDefinitionForType(signalType)
	out := effectiveSignalPolicy{
		enabled:  true,
		priority: def.Priority,
	}
	applySignalOverrideToEffective(&out, policy.Signals.Overrides[signalType])
	if contextName != "" {
		applySignalOverrideToEffective(&out, policy.Signals.ContextOverrides[contextName][signalType])
	}
	return out
}

func applySignalOverrideToEffective(out *effectiveSignalPolicy, override SignalOverride) {
	if override.Enabled != nil {
		out.enabled = *override.Enabled
	}
	if isSignalSeverityOverride(override.Severity) {
		out.severity = override.Severity
	}
	if override.Priority != nil {
		out.priority = *override.Priority
	}
	if override.Exclusions != nil {
		out.exclusions = override.Exclusions
	}
}

func DashboardSignalCatalog(policy DataplanePolicy, contextName string) []SignalCatalogItem {
	keys := make([]string, 0, len(dashboardSignalDefinitions))
	for signalType := range dashboardSignalDefinitions {
		keys = append(keys, signalType)
	}
	sort.Slice(keys, func(i, j int) bool {
		ei := effectiveSignalSettings(policy, contextName, keys[i])
		ej := effectiveSignalSettings(policy, contextName, keys[j])
		if ei.priority != ej.priority {
			return ei.priority < ej.priority
		}
		return dashboardSignalDefinitions[keys[i]].Label < dashboardSignalDefinitions[keys[j]].Label
	})

	out := make([]SignalCatalogItem, 0, len(keys))
	for _, signalType := range keys {
		def := dashboardSignalDefinitionForType(signalType)
		effective := effectiveSignalSettings(policy, contextName, signalType)
		defaultSeverity := defaultDashboardSignalSeverity(signalType)
		effectiveSeverity := defaultSeverity
		if isSignalSeverityOverride(effective.severity) {
			effectiveSeverity = effective.severity
		}
		item := SignalCatalogItem{
			Type:              signalType,
			Label:             def.Label,
			SummaryCounter:    def.SummaryCounter,
			ActualData:        def.ActualData,
			CalculatedData:    def.CalculatedData,
			LikelyCause:       def.LikelyCause,
			SuggestedAction:   def.SuggestedAction,
			DefaultEnabled:    true,
			DefaultSeverity:   defaultSeverity,
			DefaultPriority:   def.Priority,
			EffectiveEnabled:  effective.enabled,
			EffectiveSeverity: effectiveSeverity,
			EffectivePriority: effective.priority,
		}
		if override, ok := policy.Signals.Overrides[signalType]; ok {
			copy := cloneSignalOverride(override)
			item.GlobalOverride = &copy
		}
		if contextName != "" {
			if override, ok := policy.Signals.ContextOverrides[contextName][signalType]; ok {
				copy := cloneSignalOverride(override)
				item.ContextOverride = &copy
			}
		}
		out = append(out, item)
	}
	return out
}

func defaultDashboardSignalSeverity(signalType string) string {
	switch signalType {
	case "abnormal_job", "abnormal_cronjob", "stale_transitional_helm_release", "pod_missing_secret_reference", "pod_image_pull_failure", "pod_crash_loop_waiting", "ingress_backend_service_missing", "ingress_backend_port_missing":
		return "high"
	case "empty_namespace", "long_running_job", "cronjob_no_recent_success", "hpa_needs_attention", "pod_unschedulable", "resource_quota_pressure", "pvc_needs_attention", "pvc_node_bound_storage", "pv_node_bound_storage", "service_no_matching_cached_pods", "service_no_ready_endpoints", "ingress_backend_no_ready_endpoints", "ingress_pending_address", "ingress_needs_attention", "container_near_limit", "node_resource_pressure", "pod_young_frequent_restarts", "deployment_unavailable", "deployment_missing_template_reference", "daemonset_missing_template_reference", "statefulset_missing_template_reference", "replicaset_missing_template_reference", "job_missing_template_reference", "cronjob_missing_template_reference":
		return "medium"
	default:
		return "low"
	}
}

var dashboardSignalDefinitions = map[string]dashboardSignalDefinition{
	"pod_restarts": {
		Type:            "pod_restarts",
		Label:           "Pod restarts",
		FilterLabel:     "Pod restarts",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "restart count exceeds configured threshold",
		LikelyCause:     "The pod may be repeatedly crashing, failing health checks, or restarting after node/runtime interruptions.",
		SuggestedAction: "Open pod logs and events, inspect container restart reasons, and check whether the owning workload recently rolled out or is failing probes.",
		Priority:        0,
	},
	"pod_image_pull_failure": {
		Type:            "pod_image_pull_failure",
		Label:           "Pod image pull failures",
		FilterLabel:     "Image pull failure",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "container status waiting reason indicates image pull or registry access failure",
		LikelyCause:     "The image name, tag, registry credentials, image pull secret, network path, or registry availability may be wrong or unavailable.",
		SuggestedAction: "Inspect pod events and imagePullSecrets, verify the image reference and registry credentials, then restart or roll out the owning workload after fixing the reference.",
		Priority:        0,
	},
	"pod_crash_loop_waiting": {
		Type:            "pod_crash_loop_waiting",
		Label:           "Pods in CrashLoopBackOff",
		FilterLabel:     "CrashLoopBackOff",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "container status waiting reason is CrashLoopBackOff",
		LikelyCause:     "A container is repeatedly exiting during startup or probe execution and Kubernetes is backing off restarts.",
		SuggestedAction: "Open current and previous logs, inspect last termination reason and probes, and verify config/secrets/dependencies needed at startup.",
		Priority:        0,
	},
	"pod_unschedulable": {
		Type:            "pod_unschedulable",
		Label:           "Pods unschedulable",
		FilterLabel:     "Unschedulable pods",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "PodScheduled condition is False with reason Unschedulable",
		LikelyCause:     "The pod may not fit available nodes because of resource requests, node selectors, affinity, taints/tolerations, PVC node affinity, or quota constraints.",
		SuggestedAction: "Inspect pod events and scheduling constraints, compare requests with node capacity, and check taints, affinity, PVC binding, and namespace quota before changing replicas.",
		Priority:        0,
	},
	"stale_transitional_helm_release": {
		Type:            "stale_transitional_helm_release",
		Label:           "Stuck Helm releases",
		FilterLabel:     "Stuck Helm release",
		SummaryCounter:  "stuck_helm_releases",
		CalculatedData:  "transitional Helm status for longer than configured stale duration, or transitional with unknown update time",
		LikelyCause:     "A Helm upgrade, rollback, or uninstall likely stalled on hooks, failing resources, or an interrupted release operation.",
		SuggestedAction: "Inspect the release status, recent Helm history, and related workload events. Resolve the blocking resource or hook, then finish or roll back the release cleanly.",
		Priority:        1,
	},
	"abnormal_job": {
		Type:            "abnormal_job",
		Label:           "Abnormal jobs",
		FilterLabel:     "Job failures",
		SummaryCounter:  "abnormal_jobs",
		CalculatedData:  "failed status or failed attempts observed",
		LikelyCause:     "The job probably has failing pods, image/config problems, missing dependencies, or logic that exits unsuccessfully.",
		SuggestedAction: "Open the job and pod logs, inspect events, and fix the failing input, dependency, or image issue before rerunning.",
		Priority:        2,
	},
	"long_running_job": {
		Type:            "long_running_job",
		Label:           "Long-running jobs",
		FilterLabel:     "Job running long",
		SummaryCounter:  "abnormal_jobs",
		CalculatedData:  "running for longer than configured duration",
		LikelyCause:     "The job may be blocked on external work, stuck waiting on resources, or looping without making progress.",
		SuggestedAction: "Inspect active pods, logs, and related dependencies. If it is intentionally long-running, consider moving it to a different workload type or adjusting expectations.",
		Priority:        2,
	},
	"abnormal_cronjob": {
		Type:            "abnormal_cronjob",
		Label:           "Abnormal CronJobs",
		FilterLabel:     "CronJob overlap",
		SummaryCounter:  "abnormal_cronjobs",
		CalculatedData:  "unusually large active job count",
		LikelyCause:     "The schedule may be producing overlapping runs, repeatedly failing, or never completing successfully.",
		SuggestedAction: "Review recent job history, concurrency policy, schedule, and pod failures. Reduce overlap or fix the underlying job failure before the backlog grows.",
		Priority:        3,
	},
	"cronjob_no_recent_success": {
		Type:            "cronjob_no_recent_success",
		Label:           "CronJobs without recent success",
		FilterLabel:     "No recent CronJob success",
		SummaryCounter:  "abnormal_cronjobs",
		CalculatedData:  "no recorded successful run after configured duration",
		LikelyCause:     "The schedule may be producing overlapping runs, repeatedly failing, or never completing successfully.",
		SuggestedAction: "Review recent job history, concurrency policy, schedule, and pod failures. Reduce overlap or fix the underlying job failure before the backlog grows.",
		Priority:        3,
	},
	"hpa_needs_attention": {
		Type:            "hpa_needs_attention",
		Label:           "HPA warnings",
		FilterLabel:     "HPA scaling issue",
		SummaryCounter:  "hpa_warnings",
		CalculatedData:  "HPA status condition or replica bounds need attention",
		LikelyCause:     "The autoscaler may be unable to read metrics, unable to reach its scale target, pinned at maxReplicas, or below minReplicas.",
		SuggestedAction: "Inspect HPA conditions, metric targets, and the referenced workload. Check metrics-server/custom metrics health before changing replica bounds.",
		Priority:        4,
	},
	"resource_quota_pressure": {
		Type:            "resource_quota_pressure",
		Label:           "Quota pressure",
		FilterLabel:     "Quota near limit",
		SummaryCounter:  "quota_warnings",
		CalculatedData:  "quota usage is above configured warning threshold",
		LikelyCause:     "The namespace is approaching its configured quota because workload growth or a runaway job is consuming the remaining budget.",
		SuggestedAction: "Inspect which resource is close to the hard limit, then either scale usage back down or raise the quota if the growth is intentional.",
		Priority:        4,
	},
	"pvc_needs_attention": {
		Type:            "pvc_needs_attention",
		Label:           "PVC warnings",
		FilterLabel:     "PVC health issue",
		SummaryCounter:  "pvc_warnings",
		CalculatedData:  "PVC phase or resize signal needs attention",
		LikelyCause:     "The storage class, provisioner, matching PersistentVolume, or resize flow may be blocked, or the claim is stuck in a failed/released binding state.",
		SuggestedAction: "Inspect PVC events, storage class, requested capacity, bound volume, and provisioner health. Resolve binding or resize failures before changing workloads that depend on the claim.",
		Priority:        5,
	},
	"potentially_unused_pvc": {
		Type:            "potentially_unused_pvc",
		Label:           "Potentially unused PVCs",
		FilterLabel:     "Possibly unused PVC",
		SummaryCounter:  "potentially_unused_pvcs",
		CalculatedData:  "no pods present in cached namespace snapshot",
		LikelyCause:     "The claim may belong to a removed workload, a failed rollout, or a namespace that no longer has active consumers.",
		SuggestedAction: "Check what last mounted it and whether data must be kept. Delete or archive it only after confirming retention expectations.",
		Priority:        5,
	},
	"pvc_node_bound_storage": {
		Type:            "pvc_node_bound_storage",
		Label:           "PVCs tied to nodes",
		FilterLabel:     "PVC node-bound",
		SummaryCounter:  "pvc_warnings",
		CalculatedData:  "bound PV has node affinity, node-local source type, or commonly node-local storage class",
		LikelyCause:     "The claim is backed by storage that cannot freely move across nodes. If the node is drained, removed, or unavailable, pods using this PVC may be stuck on scheduling or mount.",
		SuggestedAction: "Check the bound PV, storage class, and pod scheduling constraints. Plan node maintenance carefully and verify backups or migration before moving workloads that use this claim.",
		Priority:        5,
	},
	"pv_node_bound_storage": {
		Type:            "pv_node_bound_storage",
		Label:           "PVs tied to nodes",
		FilterLabel:     "PV node-bound",
		SummaryCounter:  "pvc_warnings",
		CalculatedData:  "PV has node affinity, node-local source type, or commonly node-local storage class",
		LikelyCause:     "The volume is tied to a particular node or node-local provisioner. Workloads using it may not reschedule cleanly if that node becomes unavailable.",
		SuggestedAction: "Inspect the PV node affinity, storage class, and reclaim/backup expectations before draining or replacing the node.",
		Priority:        5,
	},
	"service_no_ready_endpoints": {
		Type:            "service_no_ready_endpoints",
		Label:           "Service endpoints",
		FilterLabel:     "No ready endpoints",
		SummaryCounter:  "service_warnings",
		CalculatedData:  "0 ready endpoints",
		LikelyCause:     "The service selector may not match any ready pods, or all selected pods are currently not ready.",
		SuggestedAction: "Inspect the service endpoints and selector labels, then open the selected workloads or pods to restore ready backends.",
		Priority:        6,
	},
	"service_no_matching_cached_pods": {
		Type:            "service_no_matching_cached_pods",
		Label:           "Service selector",
		FilterLabel:     "No matching cached Pods",
		SummaryCounter:  "service_warnings",
		CalculatedData:  "Service selector matches 0 cached Pods with complete Pod coverage",
		LikelyCause:     "The Service selector labels likely differ from the labels on the intended workload Pods.",
		SuggestedAction: "Compare the Service selector with workload template and Pod labels, then correct the selector or labels.",
		Priority:        6,
	},
	"ingress_pending_address": {
		Type:            "ingress_pending_address",
		Label:           "Ingress pending address",
		FilterLabel:     "Ingress address pending",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "ingress address or routing health needs attention",
		LikelyCause:     "The ingress controller may not have admitted the route yet, or the backend/service wiring is incomplete.",
		SuggestedAction: "Inspect ingress events, address assignment, TLS/backend references, and the services behind the route.",
		Priority:        6,
	},
	"ingress_needs_attention": {
		Type:            "ingress_needs_attention",
		Label:           "Ingress routing",
		FilterLabel:     "Ingress routing issue",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "ingress address or routing health needs attention",
		LikelyCause:     "The ingress controller may not have admitted the route yet, or the backend/service wiring is incomplete.",
		SuggestedAction: "Inspect ingress events, address assignment, TLS/backend references, and the services behind the route.",
		Priority:        6,
	},
	"ingress_backend_service_missing": {
		Type:            "ingress_backend_service_missing",
		Label:           "Ingress backend Service",
		FilterLabel:     "Backend Service missing",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "backend Service absent from a complete cached Service snapshot",
		LikelyCause:     "The Ingress references a Service that was renamed, removed, or never created in the namespace.",
		SuggestedAction: "Open the Ingress backend configuration and create or correct the referenced Service.",
		Priority:        1,
	},
	"ingress_backend_port_missing": {
		Type:            "ingress_backend_port_missing",
		Label:           "Ingress backend port",
		FilterLabel:     "Backend port missing",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "named or numeric backend port absent from cached Service ports",
		LikelyCause:     "The Ingress backend port no longer matches a port exposed by the referenced Service.",
		SuggestedAction: "Align the Ingress backend port with an existing Service port name or number.",
		Priority:        1,
	},
	"ingress_backend_no_ready_endpoints": {
		Type:            "ingress_backend_no_ready_endpoints",
		Label:           "Ingress backend endpoints",
		FilterLabel:     "Backend has no ready endpoints",
		SummaryCounter:  "ingress_warnings",
		CalculatedData:  "backend Service has 0 ready endpoints with complete EndpointSlice observation",
		LikelyCause:     "The backend Service exists and exposes the requested port, but its selected workloads are absent or not ready.",
		SuggestedAction: "Inspect the backend Service selector, Pods, workloads, and EndpointSlices to restore ready endpoints.",
		Priority:        4,
	},
	"potentially_unused_serviceaccount": {
		Type:            "potentially_unused_serviceaccount",
		Label:           "Potentially unused service accounts",
		FilterLabel:     "Possibly unused SA",
		SummaryCounter:  "potentially_unused_serviceaccounts",
		CalculatedData:  "non-default service account with no pods present in cached namespace snapshot",
		LikelyCause:     "The service account may have been created for a workload that no longer runs in this namespace.",
		SuggestedAction: "Verify whether any pods or controllers still reference it. Remove it if unused, especially if it carries extra permissions.",
		Priority:        7,
	},
	"role_permission_surface": {
		Type:            "role_permission_surface",
		Label:           "Roles",
		FilterLabel:     "Broad/empty Role rules",
		SummaryCounter:  "role_warnings",
		CalculatedData:  "empty or broad rule surface",
		LikelyCause:     "The role may be a placeholder with no rules or a broad permission surface that deserves review.",
		SuggestedAction: "Review the rules and confirm the role is intentionally broad; otherwise narrow or remove it.",
		Priority:        7,
	},
	"rolebinding_subject_surface": {
		Type:            "rolebinding_subject_surface",
		Label:           "RoleBindings",
		FilterLabel:     "Broad/empty binding subjects",
		SummaryCounter:  "rolebinding_warnings",
		CalculatedData:  "empty or broad subject surface",
		LikelyCause:     "The binding may have no subjects or grant access to an unusually broad subject set.",
		SuggestedAction: "Review subjects and the referenced role, then remove stale subjects or split broad access into narrower bindings.",
		Priority:        7,
	},
	"empty_configmap": {
		Type:            "empty_configmap",
		Label:           "Empty ConfigMaps",
		FilterLabel:     "Empty ConfigMap",
		SummaryCounter:  "empty_configmaps",
		ActualData:      "0 data keys",
		LikelyCause:     "The object may be a placeholder, partially applied manifest, or leftover config no workload actually uses.",
		SuggestedAction: "Confirm whether a workload mounts or references it. Populate the expected data or remove it if it is obsolete.",
		Priority:        8,
	},
	"empty_secret": {
		Type:            "empty_secret",
		Label:           "Empty Secrets",
		FilterLabel:     "Empty Secret",
		SummaryCounter:  "empty_secrets",
		ActualData:      "0 data keys",
		LikelyCause:     "The secret may be an incomplete rollout artifact, placeholder, or stale object left behind by an old deployment.",
		SuggestedAction: "Verify whether anything references it. Restore the expected data or delete it if it is no longer used.",
		Priority:        8,
	},
	"empty_namespace": {
		Type:            "empty_namespace",
		Label:           "Empty namespaces",
		FilterLabel:     "Empty namespace",
		SummaryCounter:  "empty_namespaces",
		ActualData:      "0 workload, network, storage, and Helm resources in cached snapshots",
		LikelyCause:     "The workload may have been removed earlier, or the namespace was created temporarily and never cleaned up.",
		SuggestedAction: "Check recent ownership and deploy history. If it is no longer needed, remove the namespace after confirming no retained data or policies still depend on it.",
		Priority:        9,
	},
	"container_near_limit": {
		Type:            "container_near_limit",
		Label:           "Pods near CPU or memory limit",
		FilterLabel:     "Container near limit",
		SummaryCounter:  "container_near_limit",
		CalculatedData:  "pod usage is at or above the configured percentage of the container limit",
		LikelyCause:     "Actual workload traffic may have grown past what container limits allow, or the limits may be set too tight for the observed steady state.",
		SuggestedAction: "Review pod usage trends and container limits; raise limits if the usage is legitimate or investigate the workload for a leak or load spike.",
		Priority:        3,
	},
	"node_resource_pressure": {
		Type:            "node_resource_pressure",
		Label:           "Nodes under CPU or memory pressure",
		FilterLabel:     "Node resource pressure",
		SummaryCounter:  "node_resource_pressure",
		CalculatedData:  "node usage is at or above the configured percentage of allocatable capacity",
		LikelyCause:     "Too many workloads may have been scheduled on the node, a workload may be consuming more resources than budgeted, or allocatable capacity may be reduced by system daemons.",
		SuggestedAction: "Review scheduled pods on the node, rebalance workloads, or scale the cluster; check for runaway processes if a single workload is dominating usage.",
		Priority:        2,
	},
	"pod_young_frequent_restarts": {
		Type:            "pod_young_frequent_restarts",
		Label:           "Pods restarting frequently in short lifetime",
		FilterLabel:     "Frequent early restarts",
		SummaryCounter:  "pod_restart_signals",
		CalculatedData:  "pod accumulated frequent restarts within configured young-pod window",
		LikelyCause:     "The pod may be crash-looping on startup, failing probes right away, or tripping over image/config errors during initial rollout.",
		SuggestedAction: "Open pod logs and recent events, inspect container last-termination reasons, and verify that image, config, secrets, and probes are ready before the containers start.",
		Priority:        0,
	},
	"pod_succeeded_with_issues": {
		Type:            "pod_succeeded_with_issues",
		Label:           "Pods Succeeded with recorded issues",
		FilterLabel:     "Succeeded pod issues",
		CalculatedData:  "phase Succeeded while conditions, container states, or Warning events indicate problems",
		LikelyCause:     "Short-lived pods (init containers, Jobs) can reach Succeeded even when earlier conditions or events captured problems that still matter for troubleshooting.",
		SuggestedAction: "Treat Succeeded as completion, not health: review the recorded conditions, container last-termination reasons, and Warning events to understand what happened.",
		Priority:        5,
	},
	"pod_missing_secret_reference": {
		Type:            "pod_missing_secret_reference",
		Label:           "Pods with missing Secret references",
		FilterLabel:     "Pod missing Secret",
		CalculatedData:  "pod warning events mention a referenced Secret could not be found or retrieved",
		LikelyCause:     "The pod spec, environment, volume, or image pull secret references a Secret that is absent, misspelled, or not available in the namespace.",
		SuggestedAction: "Create or restore the Secret, fix the pod/workload reference, or remove the reference if it is obsolete. Then restart or roll out the owning workload.",
		Priority:        1,
	},
	"deployment_unavailable": {
		Type:            "deployment_unavailable",
		Label:           "Deployments unavailable for extended time",
		FilterLabel:     "Deployment unavailable",
		SummaryCounter:  "workload_warnings",
		CalculatedData:  "Available=False longer than configured threshold, or no available replicas for a mature deployment",
		LikelyCause:     "The rollout may be stuck on failing pods, image or config errors, unschedulable replicas, or a bad probe/template change that prevents any replica from becoming available.",
		SuggestedAction: "Inspect the latest rollout, the active ReplicaSet, pod events, and probe configuration. Roll back or fix the failing template/dependency to restore available replicas.",
		Priority:        1,
	},
	"deployment_missing_template_reference": {
		Type:            "deployment_missing_template_reference",
		Label:           "Deployments with missing template references",
		FilterLabel:     "Deployment missing refs",
		CalculatedData:  "deployment pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The Deployment template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, update the Deployment template reference, then restart the rollout if pods are stuck on the old template.",
		Priority:        1,
	},
	"daemonset_missing_template_reference": {
		Type:            "daemonset_missing_template_reference",
		Label:           "DaemonSets with missing template references",
		FilterLabel:     "DaemonSet missing refs",
		CalculatedData:  "daemonset pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The DaemonSet template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, update the DaemonSet template reference, then restart the rollout if pods are stuck on the old template.",
		Priority:        1,
	},
	"statefulset_missing_template_reference": {
		Type:            "statefulset_missing_template_reference",
		Label:           "StatefulSets with missing template references",
		FilterLabel:     "StatefulSet missing refs",
		CalculatedData:  "statefulset pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The StatefulSet template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, update the StatefulSet template reference, then restart or continue the rollout if pods are stuck on the old template.",
		Priority:        1,
	},
	"replicaset_missing_template_reference": {
		Type:            "replicaset_missing_template_reference",
		Label:           "ReplicaSets with missing template references",
		FilterLabel:     "ReplicaSet missing refs",
		CalculatedData:  "replicaset pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The ReplicaSet template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, then inspect the owning workload before editing or deleting the ReplicaSet directly.",
		Priority:        1,
	},
	"job_missing_template_reference": {
		Type:            "job_missing_template_reference",
		Label:           "Jobs with missing template references",
		FilterLabel:     "Job missing refs",
		CalculatedData:  "job pod template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The Job template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, then recreate or rerun the Job if failed pods captured the old template.",
		Priority:        1,
	},
	"cronjob_missing_template_reference": {
		Type:            "cronjob_missing_template_reference",
		Label:           "CronJobs with missing template references",
		FilterLabel:     "CronJob missing refs",
		CalculatedData:  "cronjob job template imagePullSecrets and Secret/ConfigMap volumes reference objects absent from the namespace",
		LikelyCause:     "The CronJob job template references a Secret or ConfigMap that was deleted, renamed, not yet applied, or created in a different namespace.",
		SuggestedAction: "Create or restore the missing object, update the CronJob template if needed, then watch the next run or start a manual run to confirm recovery.",
		Priority:        1,
	},
}
