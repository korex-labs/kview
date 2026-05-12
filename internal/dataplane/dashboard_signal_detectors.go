package dataplane

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type dashboardSignalDetector struct {
	Type   string
	Detect func(now time.Time, namespace string, snapshots dashboardSnapshotSet) []ClusterDashboardSignal
}

var dashboardSignalDetectors = []dashboardSignalDetector{
	{Type: "empty_namespace", Detect: detectEmptyNamespaceSignals},
	{Type: "pod_restarts", Detect: detectPodRestartSignals},
	{Type: "abnormal_job", Detect: detectAbnormalJobSignals},
	{Type: "long_running_job", Detect: detectLongRunningJobSignals},
	{Type: "abnormal_cronjob", Detect: detectAbnormalCronJobSignals},
	{Type: "cronjob_no_recent_success", Detect: detectCronJobNoRecentSuccessSignals},
	{Type: "hpa_needs_attention", Detect: detectHPANeedsAttentionSignals},
	{Type: "stale_transitional_helm_release", Detect: detectStaleTransitionalHelmReleaseSignals},
	{Type: "service_no_ready_endpoints", Detect: detectServiceNoReadyEndpointsSignals},
	{Type: "ingress_pending_address", Detect: detectIngressPendingAddressSignals},
	{Type: "ingress_needs_attention", Detect: detectIngressNeedsAttentionSignals},
	{Type: "pvc_needs_attention", Detect: detectPVCNeedsAttentionSignals},
	{Type: "pvc_node_bound_storage", Detect: detectPVCNodeBoundStorageSignals},
	{Type: "role_permission_surface", Detect: detectRolePermissionSurfaceSignals},
	{Type: "rolebinding_subject_surface", Detect: detectRoleBindingSubjectSurfaceSignals},
	{Type: "resource_quota_pressure", Detect: detectResourceQuotaPressureSignals},
	{Type: "empty_configmap", Detect: detectEmptyConfigMapSignals},
	{Type: "empty_secret", Detect: detectEmptySecretSignals},
	{Type: "potentially_unused_pvc", Detect: detectPotentiallyUnusedPVCSignals},
	{Type: "potentially_unused_serviceaccount", Detect: detectPotentiallyUnusedServiceAccountSignals},
	{Type: "container_near_limit", Detect: detectContainerNearLimitSignals},
}

func detectEmptyNamespaceSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !isEmptyLookingNamespace(s) {
		return nil
	}
	return []ClusterDashboardSignal{
		dashboardSignalItem("empty_namespace", "Namespace", ns, "", "medium", 70, "No workload, network, storage, or Helm resources in cached snapshots.", "medium", "namespaces"),
	}
}

func detectPodRestartSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.podsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	threshold := s.restartThreshold
	if threshold <= 0 {
		threshold = signalRestartMinThreshold
	}
	for _, p := range s.pods.Items {
		if p.Restarts >= threshold {
			out = append(out, dashboardPodRestartSignal(ns, p, threshold))
		}
	}
	return out
}

func detectAbnormalJobSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.jobsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, j := range EnrichJobListItemsForAPI(s.jobs.Items) {
		if j.NeedsAttention {
			f := dashboardSignalItem("abnormal_job", "Job", ns, j.Name, "high", 90, "Job is failed or has failed attempts.", "high", "jobs")
			f.ActualData = fmt.Sprintf("status %s, active %d, succeeded %d, failed %d", j.Status, j.Active, j.Succeeded, j.Failed)
			f.CalculatedData = "failed attempts or failed terminal status observed"
			out = append(out, f)
		}
	}
	return out
}

func detectLongRunningJobSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.jobsOK {
		return nil
	}
	duration := s.longRunningJobDuration
	if duration <= 0 {
		duration = signalLongRunningJobDuration
	}
	var out []ClusterDashboardSignal
	for _, j := range EnrichJobListItemsForAPI(s.jobs.Items) {
		if !j.NeedsAttention && j.Status == "Running" && j.AgeSec >= int64(duration.Seconds()) {
			f := dashboardSignalItem("long_running_job", "Job", ns, j.Name, "medium", 62, fmt.Sprintf("Job has been running for more than %s.", humanizeSignalDuration(duration)), "medium", "jobs")
			f.ActualData = fmt.Sprintf("status %s, age %s, active %d", j.Status, humanizeSignalDuration(time.Duration(j.AgeSec)*time.Second), j.Active)
			f.CalculatedData = fmt.Sprintf("configured long-running threshold is %s", humanizeSignalDuration(duration))
			out = append(out, f)
		}
	}
	return out
}

func detectAbnormalCronJobSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.cjsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, cj := range EnrichCronJobListItemsForAPI(s.cjs.Items) {
		if cj.Active >= 8 {
			f := dashboardSignalItem("abnormal_cronjob", "CronJob", ns, cj.Name, "high", 88, "CronJob has an unusually large number of active jobs.", "high", "cronjobs")
			f.ActualData = fmt.Sprintf("active jobs %d, schedule %s", cj.Active, cj.Schedule)
			f.CalculatedData = "active job count is above the normal list-health range"
			out = append(out, f)
		}
	}
	return out
}

func detectCronJobNoRecentSuccessSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.cjsOK {
		return nil
	}
	duration := s.cronJobNoSuccessAge
	if duration <= 0 {
		duration = signalCronJobNoSuccessDuration
	}
	var out []ClusterDashboardSignal
	for _, cj := range EnrichCronJobListItemsForAPI(s.cjs.Items) {
		if !cj.Suspend && cj.AgeSec >= int64(duration.Seconds()) && cj.LastSuccessfulTime == 0 {
			f := dashboardSignalItem("cronjob_no_recent_success", "CronJob", ns, cj.Name, "medium", 60, fmt.Sprintf("CronJob has no successful run recorded after more than %s.", humanizeSignalDuration(duration)), "medium", "cronjobs")
			f.ActualData = fmt.Sprintf("last successful run missing, age %s, schedule %s", humanizeSignalDuration(time.Duration(cj.AgeSec)*time.Second), cj.Schedule)
			f.CalculatedData = fmt.Sprintf("successful run absent past %s threshold", humanizeSignalDuration(duration))
			out = append(out, f)
		}
	}
	return out
}

func detectHPANeedsAttentionSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.hpasOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, hpa := range s.hpas.Items {
		if !hpa.NeedsAttention {
			continue
		}
		reason := "HorizontalPodAutoscaler needs attention."
		if len(hpa.AttentionReasons) > 0 {
			reason = strings.Join(hpa.AttentionReasons, "; ")
		}
		severity, score := hpaSignalSeverityAndScore(hpa)
		f := dashboardSignalItem("hpa_needs_attention", "HorizontalPodAutoscaler", ns, hpa.Name, severity, score, reason, "high", "horizontalpodautoscalers")
		f.ActualData = reason
		if hpa.MaxReplicas > 0 {
			f.CalculatedData = fmt.Sprintf("current %d, desired %d, min %d, max %d", hpa.CurrentReplicas, hpa.DesiredReplicas, hpa.MinReplicas, hpa.MaxReplicas)
		}
		out = append(out, f)
	}
	return out
}

func hpaSignalSeverityAndScore(hpa dto.HorizontalPodAutoscalerDTO) (string, int) {
	if len(hpa.AttentionReasons) == 1 && hpa.AttentionReasons[0] == "replicas are pinned at maxReplicas" {
		return "low", 34
	}
	return "medium", 65
}

func detectStaleTransitionalHelmReleaseSignals(now time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.helmOK {
		return nil
	}
	duration := s.staleHelmReleaseAge
	if duration <= 0 {
		duration = signalStaleHelmReleaseDuration
	}
	var out []ClusterDashboardSignal
	for _, rel := range s.helmReleases.Items {
		if !isTransitionalHelmStatus(rel.Status) {
			continue
		}
		age := "last update time is unknown"
		stale := rel.Updated == 0
		if rel.Updated > 0 {
			d := now.Sub(time.Unix(rel.Updated, 0))
			stale = d >= duration
			age = fmt.Sprintf("status has been transitional for more than %s", humanizeSignalDuration(duration))
		}
		if stale {
			f := dashboardSignalItem("stale_transitional_helm_release", "HelmRelease", ns, rel.Name, "high", 86, age, "medium", "helm")
			f.ActualData = fmt.Sprintf("status %s, revision %d", rel.Status, rel.Revision)
			f.CalculatedData = fmt.Sprintf("stale threshold %s", humanizeSignalDuration(duration))
			out = append(out, f)
		}
	}
	return out
}

func detectServiceNoReadyEndpointsSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.svcsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, svc := range EnrichServiceListItemsForAPI(s.svcs.Items) {
		if svc.NeedsAttention {
			f := dashboardSignalItem("service_no_ready_endpoints", "Service", ns, svc.Name, "medium", 66, "Service has no ready endpoints.", "medium", "services")
			f.ActualData = fmt.Sprintf("ready %d, not ready %d endpoints", svc.EndpointsReady, svc.EndpointsNotReady)
			f.CalculatedData = fmt.Sprintf("%s service exposure, endpoint health %s", svc.ExposureHint, svc.EndpointHealthBucket)
			out = append(out, f)
		}
	}
	return out
}

func detectIngressPendingAddressSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.ingsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, ing := range EnrichIngressListItemsForAPI(s.ings.Items) {
		if ing.NeedsAttention && ing.AddressState == "pending" {
			f := dashboardSignalItem("ingress_pending_address", "Ingress", ns, ing.Name, "medium", 64, "Ingress has no assigned address yet.", "medium", "ingresses")
			f.ActualData = fmt.Sprintf("%d host%s, 0 addresses", len(ing.Hosts), pluralSuffix(len(ing.Hosts)))
			f.CalculatedData = fmt.Sprintf("address state %s, TLS %s", ing.AddressState, ing.TLSHint)
			out = append(out, f)
		}
	}
	return out
}

func detectIngressNeedsAttentionSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.ingsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, ing := range EnrichIngressListItemsForAPI(s.ings.Items) {
		if ing.NeedsAttention && ing.AddressState != "pending" {
			f := dashboardSignalItem("ingress_needs_attention", "Ingress", ns, ing.Name, "medium", 64, "Ingress routing needs attention.", "medium", "ingresses")
			f.ActualData = fmt.Sprintf("%d host%s, %d address%s", len(ing.Hosts), pluralSuffix(len(ing.Hosts)), len(ing.Addresses), pluralSuffix(len(ing.Addresses)))
			f.CalculatedData = fmt.Sprintf("routing health %s, TLS %s", ing.RoutingHealthBucket, ing.TLSHint)
			out = append(out, f)
		}
	}
	return out
}

func detectPVCNeedsAttentionSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.pvcsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, pvc := range EnrichPVCListItemsForAPI(s.pvcs.Items) {
		if !pvc.NeedsAttention {
			continue
		}
		severity := "medium"
		score := 63
		reason := "PersistentVolumeClaim is not bound or has a pending resize signal."
		if pvc.HealthBucket == deployBucketDegraded {
			severity = "high"
			score = 84
			reason = "PersistentVolumeClaim is in a degraded phase."
		}
		f := dashboardSignalItem("pvc_needs_attention", "PersistentVolumeClaim", ns, pvc.Name, severity, score, reason, "medium", "persistentvolumeclaims")
		f.ActualData = fmt.Sprintf("phase %s, requested %s, capacity %s", pvc.Phase, pvc.RequestedStorage, pvc.Capacity)
		if pvc.ResizePending {
			f.CalculatedData = "requested storage differs from current capacity"
		} else {
			f.CalculatedData = fmt.Sprintf("binding health %s", pvc.HealthBucket)
		}
		out = append(out, f)
	}
	return out
}

func detectPVCNodeBoundStorageSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.pvcsOK {
		return nil
	}
	pvsByName := map[string]dto.PersistentVolumeDTO{}
	if s.pvsOK {
		for _, pv := range s.pvs.Items {
			pvsByName[pv.Name] = pv
		}
	}
	var out []ClusterDashboardSignal
	for _, pvc := range s.pvcs.Items {
		pv, hasPV := pvsByName[pvc.VolumeName]
		evidence := nodeBoundStorageEvidence(pvc.StorageClassName, pv, hasPV)
		if !evidence.bound {
			continue
		}

		reason := "PersistentVolumeClaim is backed by storage tied to a specific node."
		f := dashboardSignalItem("pvc_node_bound_storage", "PersistentVolumeClaim", ns, pvc.Name, "medium", 64, reason, evidence.confidence, "persistentvolumeclaims")
		f.ActualData = fmt.Sprintf("storageClass %s, volume %s", valueOrUnknown(pvc.StorageClassName), valueOrUnknown(pvc.VolumeName))
		f.CalculatedData = evidence.summary()
		out = append(out, f)

		if hasPV && strings.TrimSpace(pv.Name) != "" {
			pvSignal := dashboardSignalItem("pv_node_bound_storage", "PersistentVolume", "", pv.Name, "medium", 62, "PersistentVolume is tied to a specific node.", evidence.confidence, "persistentvolumes")
			pvSignal.Scope = "cluster"
			pvSignal.ScopeLocation = ""
			pvSignal.Namespace = ""
			pvSignal.ActualData = fmt.Sprintf("claim %s/%s, storageClass %s", ns, pvc.Name, valueOrUnknown(pv.StorageClassName))
			pvSignal.CalculatedData = evidence.summary()
			out = append(out, pvSignal)
		}
	}
	return out
}

func detectClusterPVNodeBoundStorageSignals(pvs PersistentVolumesSnapshot) []ClusterDashboardSignal {
	var out []ClusterDashboardSignal
	for _, pv := range pvs.Items {
		evidence := nodeBoundStorageEvidence(pv.StorageClassName, pv, true)
		if !evidence.bound {
			continue
		}
		f := dashboardSignalItem("pv_node_bound_storage", "PersistentVolume", "", pv.Name, "medium", 62, "PersistentVolume is tied to a specific node.", evidence.confidence, "persistentvolumes")
		f.Scope = "cluster"
		f.ScopeLocation = ""
		f.Namespace = ""
		f.ActualData = fmt.Sprintf("claim %s, storageClass %s", valueOrUnknown(pv.ClaimRef), valueOrUnknown(pv.StorageClassName))
		f.CalculatedData = evidence.summary()
		out = append(out, f)
	}
	return out
}

type nodeBoundStorageSignalEvidence struct {
	bound        bool
	storageHint  string
	sourceHint   string
	nodeAffinity []string
	confidence   string
}

func (e nodeBoundStorageSignalEvidence) summary() string {
	parts := make([]string, 0, 3)
	if e.storageHint != "" {
		parts = append(parts, e.storageHint)
	}
	if e.sourceHint != "" {
		parts = append(parts, e.sourceHint)
	}
	if len(e.nodeAffinity) > 0 {
		nodes := append([]string(nil), e.nodeAffinity...)
		sort.Strings(nodes)
		parts = append(parts, "node affinity "+strings.Join(nodes, ", "))
	}
	if len(parts) == 0 {
		return "storage appears node-local"
	}
	return strings.Join(parts, "; ")
}

func nodeBoundStorageEvidence(storageClass string, pv dto.PersistentVolumeDTO, hasPV bool) nodeBoundStorageSignalEvidence {
	out := nodeBoundStorageSignalEvidence{confidence: "medium"}
	if isNodeLocalStorageClass(storageClass) {
		out.bound = true
		out.storageHint = fmt.Sprintf("storageClass %s is commonly node-local", storageClass)
	}
	if hasPV {
		if isNodeLocalVolumeSource(pv.VolumeSourceType) {
			out.bound = true
			out.sourceHint = fmt.Sprintf("PV source %s", pv.VolumeSourceType)
		}
		if len(pv.NodeAffinity) > 0 {
			out.bound = true
			out.nodeAffinity = append([]string(nil), pv.NodeAffinity...)
			out.confidence = "high"
		}
		if out.storageHint == "" && isNodeLocalStorageClass(pv.StorageClassName) {
			out.bound = true
			out.storageHint = fmt.Sprintf("storageClass %s is commonly node-local", pv.StorageClassName)
		}
	}
	return out
}

func isNodeLocalVolumeSource(sourceType string) bool {
	switch strings.ToLower(strings.TrimSpace(sourceType)) {
	case "local", "hostpath":
		return true
	default:
		return false
	}
}

func isNodeLocalStorageClass(name string) bool {
	normalized := strings.ToLower(strings.TrimSpace(name))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	normalized = strings.ReplaceAll(normalized, ".", "-")
	switch normalized {
	case "local", "local-storage", "local-path", "hostpath", "host-path", "localpath", "microk8s-hostpath", "openebs-hostpath", "rancher-io-local-path":
		return true
	default:
		return strings.Contains(normalized, "local-path") || strings.Contains(normalized, "hostpath") || strings.Contains(normalized, "host-path")
	}
}

func valueOrUnknown(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	return value
}

func detectRolePermissionSurfaceSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.rolesOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, role := range EnrichRoleListItemsForAPI(s.roles.Items) {
		if role.NeedsAttention {
			f := dashboardSignalItem("role_permission_surface", "Role", ns, role.Name, "low", 42, "Role has an empty or broad rule surface.", "medium", "roles")
			f.ActualData = fmt.Sprintf("%d rule%s", role.RulesCount, pluralSuffix(role.RulesCount))
			f.CalculatedData = fmt.Sprintf("permission breadth %s", role.PrivilegeBreadth)
			out = append(out, f)
		}
	}
	return out
}

func detectRoleBindingSubjectSurfaceSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.roleBindingsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, rb := range EnrichRoleBindingListItemsForAPI(s.roleBindings.Items) {
		if rb.NeedsAttention {
			f := dashboardSignalItem("rolebinding_subject_surface", "RoleBinding", ns, rb.Name, "low", 40, "RoleBinding has an empty or broad subject surface.", "medium", "rolebindings")
			f.ActualData = fmt.Sprintf("%d subject%s, %s reference", rb.SubjectsCount, pluralSuffix(rb.SubjectsCount), rb.BindingHint)
			f.CalculatedData = fmt.Sprintf("subject breadth %s", rb.SubjectBreadth)
			out = append(out, f)
		}
	}
	return out
}

func detectResourceQuotaPressureSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.quotasOK {
		return nil
	}
	warnRatio := s.quotaWarnRatio
	if warnRatio <= 0 {
		warnRatio = quotaWarnRatio
	}
	critRatio := s.quotaCritRatio
	if critRatio <= 0 {
		critRatio = quotaCritRatio
	}
	var out []ClusterDashboardSignal
	for _, quota := range s.resourceQuotas.Items {
		for _, entry := range quota.Entries {
			if entry.Ratio == nil || *entry.Ratio < warnRatio {
				continue
			}
			ratio := *entry.Ratio
			severity := "medium"
			score := 68
			if ratio >= critRatio {
				severity = "high"
				score = 92
			}
			f := dashboardSignalItem("resource_quota_pressure", "ResourceQuota", ns, quota.Name, severity, score, "Resource quota "+entry.Key+" is nearing its hard limit.", "high", "namespaces")
			f.HistoryKey = "resource_quota_pressure|" + ns + "|" + quota.Name + "|" + entry.Key
			f.ActualData = fmt.Sprintf("%s: %s / %s", entry.Key, entry.Used, entry.Hard)
			f.CalculatedData = fmt.Sprintf("%.0f%% of hard limit", ratio*100)
			out = append(out, f)
		}
	}
	return out
}

func detectEmptyConfigMapSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.cmsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, cm := range s.cms.Items {
		if cm.KeysCount == 0 {
			out = append(out, dashboardSignalItem("empty_configmap", "ConfigMap", ns, cm.Name, "low", 35, "ConfigMap has no data keys.", "high", "configmaps"))
		}
	}
	return out
}

func detectEmptySecretSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.secsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, sec := range s.secs.Items {
		if sec.KeysCount == 0 {
			out = append(out, dashboardSignalItem("empty_secret", "Secret", ns, sec.Name, "low", 35, "Secret has no data keys.", "high", "secrets"))
		}
	}
	return out
}

func detectPotentiallyUnusedPVCSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.pvcsOK || !s.podsOK || len(s.pods.Items) > 0 {
		return nil
	}
	minAge := s.unusedResourceAge
	if minAge <= 0 {
		minAge = signalUnusedResourceAgeDuration
	}
	var out []ClusterDashboardSignal
	for _, pvc := range EnrichPVCListItemsForAPI(s.pvcs.Items) {
		if !pvc.NeedsAttention && pvc.AgeSec >= int64(minAge.Seconds()) {
			f := dashboardSignalItem("potentially_unused_pvc", "PersistentVolumeClaim", ns, pvc.Name, "low", 30, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "persistentvolumeclaims")
			f.ActualData = fmt.Sprintf("0 pods in namespace snapshot, PVC age %s", humanizeSignalDuration(time.Duration(pvc.AgeSec)*time.Second))
			f.CalculatedData = fmt.Sprintf("unused-candidate age threshold %s", humanizeSignalDuration(minAge))
			out = append(out, f)
		}
	}
	return out
}

func detectPotentiallyUnusedServiceAccountSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.sasOK || !s.podsOK || len(s.pods.Items) > 0 {
		return nil
	}
	minAge := s.unusedResourceAge
	if minAge <= 0 {
		minAge = signalUnusedResourceAgeDuration
	}
	var out []ClusterDashboardSignal
	for _, sa := range s.sas.Items {
		if sa.Name != "default" && sa.AgeSec >= int64(minAge.Seconds()) {
			f := dashboardSignalItem("potentially_unused_serviceaccount", "ServiceAccount", ns, sa.Name, "low", 25, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "serviceaccounts")
			f.ActualData = fmt.Sprintf("0 pods in namespace snapshot, service account age %s", humanizeSignalDuration(time.Duration(sa.AgeSec)*time.Second))
			f.CalculatedData = fmt.Sprintf("unused-candidate age threshold %s", humanizeSignalDuration(minAge))
			out = append(out, f)
		}
	}
	return out
}

func humanizeSignalDuration(d time.Duration) string {
	if d <= 0 {
		return "0 minutes"
	}
	if d%(24*time.Hour) == 0 {
		days := int(d / (24 * time.Hour))
		if days == 1 {
			return "24 hours"
		}
		return fmt.Sprintf("%d days", days)
	}
	if d%time.Hour == 0 {
		hours := int(d / time.Hour)
		if hours == 1 {
			return "1 hour"
		}
		return fmt.Sprintf("%d hours", hours)
	}
	if d%time.Minute == 0 {
		minutes := int(d / time.Minute)
		if minutes == 1 {
			return "1 minute"
		}
		return fmt.Sprintf("%d minutes", minutes)
	}
	return d.Round(time.Second).String()
}

// detectContainerNearLimitSignals flags pods whose aggregated usage is close to
// their aggregated CPU or memory limit. Uses pod-level CPU/MemoryLimit totals
// populated by the pod list resource layer; pods with no limits set or no
// matching metrics sample are skipped. The threshold comes from
// policy.Signals.Detectors.ContainerNearLimit.Percent (default 90%), stored on the set.
func detectContainerNearLimitSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.podsOK || !s.podMetricsOK {
		return nil
	}
	threshold := s.containerNearLimitPct
	if threshold <= 0 {
		return nil
	}
	metricsByKey := make(map[string]dto.PodMetricsDTO, len(s.podMetrics.Items))
	for _, pm := range s.podMetrics.Items {
		metricsByKey[pm.Namespace+"/"+pm.Name] = pm
	}
	if len(metricsByKey) == 0 {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, pod := range s.pods.Items {
		if pod.CPULimitMilli <= 0 && pod.MemoryLimitBytes <= 0 {
			continue
		}
		pm, ok := metricsByKey[pod.Namespace+"/"+pod.Name]
		if !ok {
			continue
		}
		var usageCPU, usageMem int64
		for _, cm := range pm.Containers {
			usageCPU += cm.CPUMilli
			usageMem += cm.MemoryBytes
		}
		cpuPct := percentOfMilli(usageCPU, pod.CPULimitMilli)
		memPct := percentOfBytes(usageMem, pod.MemoryLimitBytes)
		if cpuPct < float64(threshold) && memPct < float64(threshold) {
			continue
		}
		reason := containerNearLimitReason(cpuPct, memPct, threshold)
		severity := "medium"
		score := 70
		if cpuPct >= 100 || memPct >= 100 {
			severity = "high"
			score = 85
		}
		f := dashboardSignalItem("container_near_limit", "Pod", ns, pod.Name, severity, score, reason, "high", "pods")
		f.ActualData = fmt.Sprintf("cpu %.0f%%, memory %.0f%% of limit", cpuPct, memPct)
		f.CalculatedData = fmt.Sprintf("threshold %d%%", threshold)
		out = append(out, f)
	}
	return out
}

// detectNodeResourcePressureSignals flags nodes whose CPU or memory usage is
// at or above the configured percentage of allocatable capacity. Runs once at
// cluster scope (not per namespace). Uses the cached cluster-scope node
// metrics snapshot and nodes snapshot so it never triggers a live fetch.
func detectNodeResourcePressureSignals(_ time.Time, plane *clusterPlane, nodesSnap NodesSnapshot, thresholdPct int) []ClusterDashboardSignal {
	if plane == nil || thresholdPct <= 0 || len(nodesSnap.Items) == 0 {
		return nil
	}
	nodeMetricsSnap, ok := peekClusterSnapshot(&plane.nodeMetricsStore)
	if !ok || nodeMetricsSnap.Err != nil || len(nodeMetricsSnap.Items) == 0 {
		return nil
	}
	byName := make(map[string]dto.NodeMetricsDTO, len(nodeMetricsSnap.Items))
	for _, nm := range nodeMetricsSnap.Items {
		byName[nm.Name] = nm
	}
	var out []ClusterDashboardSignal
	for _, n := range nodesSnap.Items {
		nm, ok := byName[n.Name]
		if !ok {
			continue
		}
		cpuAlloc := parseCPUMilli(n.CPUAllocatable)
		memAlloc := parseMemoryBytes(n.MemoryAllocatable)
		cpuPct := percentOfMilli(nm.CPUMilli, cpuAlloc)
		memPct := percentOfBytes(nm.MemoryBytes, memAlloc)
		if cpuPct < float64(thresholdPct) && memPct < float64(thresholdPct) {
			continue
		}
		reason := nodeResourcePressureReason(cpuPct, memPct, thresholdPct)
		severity := "medium"
		score := 72
		if cpuPct >= 95 || memPct >= 95 {
			severity = "high"
			score = 90
		}
		f := dashboardSignalItem("node_resource_pressure", "Node", "", n.Name, severity, score, reason, "high", "nodes")
		f.Scope = "cluster"
		f.ScopeLocation = ""
		f.ActualData = fmt.Sprintf("cpu %.0f%%, memory %.0f%% of allocatable", cpuPct, memPct)
		f.CalculatedData = fmt.Sprintf("threshold %d%%", thresholdPct)
		out = append(out, f)
	}
	return out
}

func nodeResourcePressureReason(cpuPct, memPct float64, threshold int) string {
	cpuHit := cpuPct >= float64(threshold)
	memHit := memPct >= float64(threshold)
	switch {
	case cpuHit && memHit:
		return "Node CPU and memory usage are near or above allocatable capacity."
	case cpuHit:
		return "Node CPU usage is near or above allocatable capacity."
	default:
		return "Node memory usage is near or above allocatable capacity."
	}
}

func containerNearLimitReason(cpuPct, memPct float64, threshold int) string {
	cpuHit := cpuPct >= float64(threshold)
	memHit := memPct >= float64(threshold)
	switch {
	case cpuHit && memHit:
		return "Pod CPU and memory usage are near or above configured limits."
	case cpuHit:
		return "Pod CPU usage is near or above configured limit."
	default:
		return "Pod memory usage is near or above configured limit."
	}
}
