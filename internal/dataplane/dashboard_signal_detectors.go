package dataplane

import (
	"fmt"
	"time"
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
	{Type: "stale_transitional_helm_release", Detect: detectStaleTransitionalHelmReleaseSignals},
	{Type: "service_no_ready_endpoints", Detect: detectServiceNoReadyEndpointsSignals},
	{Type: "ingress_pending_address", Detect: detectIngressPendingAddressSignals},
	{Type: "ingress_needs_attention", Detect: detectIngressNeedsAttentionSignals},
	{Type: "pvc_needs_attention", Detect: detectPVCNeedsAttentionSignals},
	{Type: "role_permission_surface", Detect: detectRolePermissionSurfaceSignals},
	{Type: "rolebinding_subject_surface", Detect: detectRoleBindingSubjectSurfaceSignals},
	{Type: "resource_quota_pressure", Detect: detectResourceQuotaPressureSignals},
	{Type: "empty_configmap", Detect: detectEmptyConfigMapSignals},
	{Type: "empty_secret", Detect: detectEmptySecretSignals},
	{Type: "potentially_unused_pvc", Detect: detectPotentiallyUnusedPVCSignals},
	{Type: "potentially_unused_serviceaccount", Detect: detectPotentiallyUnusedServiceAccountSignals},
}

func detectEmptyNamespaceSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !isEmptyLookingNamespace(s) {
		return nil
	}
	return []ClusterDashboardSignal{
		dashboardSignalItem("empty_namespace", "Namespace", ns, "", "medium", 70, "No workload, network, storage, config, or Helm resources in cached snapshots.", "medium", "namespaces"),
	}
}

func detectPodRestartSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.podsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, p := range s.pods.Items {
		if p.Restarts >= 5 {
			out = append(out, dashboardPodRestartSignal(ns, p))
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
			out = append(out, dashboardSignalItem("abnormal_job", "Job", ns, j.Name, "high", 90, "Job is failed or has failed attempts.", "high", "jobs"))
		}
	}
	return out
}

func detectLongRunningJobSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.jobsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, j := range EnrichJobListItemsForAPI(s.jobs.Items) {
		if !j.NeedsAttention && j.Status == "Running" && j.AgeSec >= int64((6*time.Hour).Seconds()) {
			out = append(out, dashboardSignalItem("long_running_job", "Job", ns, j.Name, "medium", 62, "Job has been running for more than 6 hours.", "medium", "jobs"))
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
		if cj.NeedsAttention {
			out = append(out, dashboardSignalItem("abnormal_cronjob", "CronJob", ns, cj.Name, "high", 88, "CronJob has an unusually large number of active jobs.", "high", "cronjobs"))
		}
	}
	return out
}

func detectCronJobNoRecentSuccessSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.cjsOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, cj := range EnrichCronJobListItemsForAPI(s.cjs.Items) {
		if !cj.NeedsAttention && !cj.Suspend && cj.AgeSec >= int64((24*time.Hour).Seconds()) && cj.LastSuccessfulTime == 0 {
			out = append(out, dashboardSignalItem("cronjob_no_recent_success", "CronJob", ns, cj.Name, "medium", 60, "CronJob has no successful run recorded after more than 24 hours.", "medium", "cronjobs"))
		}
	}
	return out
}

func detectStaleTransitionalHelmReleaseSignals(now time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.helmOK {
		return nil
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
			stale = d >= 15*time.Minute
			age = "status has been transitional for more than 15 minutes"
		}
		if stale {
			out = append(out, dashboardSignalItem("stale_transitional_helm_release", "HelmRelease", ns, rel.Name, "high", 86, age, "medium", "helm"))
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
			out = append(out, dashboardSignalItem("service_no_ready_endpoints", "Service", ns, svc.Name, "medium", 66, "Service has no ready endpoints.", "medium", "services"))
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
			out = append(out, dashboardSignalItem("ingress_pending_address", "Ingress", ns, ing.Name, "medium", 64, "Ingress has no assigned address yet.", "medium", "ingresses"))
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
			out = append(out, dashboardSignalItem("ingress_needs_attention", "Ingress", ns, ing.Name, "medium", 64, "Ingress routing needs attention.", "medium", "ingresses"))
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
		out = append(out, dashboardSignalItem("pvc_needs_attention", "PersistentVolumeClaim", ns, pvc.Name, severity, score, reason, "medium", "persistentvolumeclaims"))
	}
	return out
}

func detectRolePermissionSurfaceSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.rolesOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, role := range EnrichRoleListItemsForAPI(s.roles.Items) {
		if role.NeedsAttention {
			out = append(out, dashboardSignalItem("role_permission_surface", "Role", ns, role.Name, "low", 42, "Role has an empty or broad rule surface.", "medium", "roles"))
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
			out = append(out, dashboardSignalItem("rolebinding_subject_surface", "RoleBinding", ns, rb.Name, "low", 40, "RoleBinding has an empty or broad subject surface.", "medium", "rolebindings"))
		}
	}
	return out
}

func detectResourceQuotaPressureSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.quotasOK {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, quota := range s.resourceQuotas.Items {
		for _, entry := range quota.Entries {
			if entry.Ratio == nil || *entry.Ratio < 0.8 {
				continue
			}
			ratio := *entry.Ratio
			severity := "medium"
			score := 68
			if ratio >= 0.9 {
				severity = "high"
				score = 92
			}
			f := dashboardSignalItem("resource_quota_pressure", "ResourceQuota", ns, quota.Name, severity, score, "Resource quota "+entry.Key+" is nearing its hard limit.", "high", "namespaces")
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
	var out []ClusterDashboardSignal
	for _, pvc := range EnrichPVCListItemsForAPI(s.pvcs.Items) {
		if !pvc.NeedsAttention && pvc.AgeSec >= int64((24*time.Hour).Seconds()) {
			out = append(out, dashboardSignalItem("potentially_unused_pvc", "PersistentVolumeClaim", ns, pvc.Name, "low", 30, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "persistentvolumeclaims"))
		}
	}
	return out
}

func detectPotentiallyUnusedServiceAccountSignals(_ time.Time, ns string, s dashboardSnapshotSet) []ClusterDashboardSignal {
	if !s.sasOK || !s.podsOK || len(s.pods.Items) > 0 {
		return nil
	}
	var out []ClusterDashboardSignal
	for _, sa := range s.sas.Items {
		if sa.Name != "default" && sa.AgeSec >= int64((24*time.Hour).Seconds()) {
			out = append(out, dashboardSignalItem("potentially_unused_serviceaccount", "ServiceAccount", ns, sa.Name, "low", 25, "Potentially unused: no pods are present in the cached namespace snapshot.", "low", "serviceaccounts"))
		}
	}
	return out
}
