package dataplane

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"kview/internal/kube/dto"
)

const (
	podListHintOK        = "ok"
	podListHintAttention = "attention"
	podListHintProblem   = "problem"

	listRestartNone   = "none"
	listRestartLow    = "low"
	listRestartMedium = "medium"
	listRestartHigh   = "high"

	deployBucketHealthy     = "healthy"
	deployBucketProgressing = "progressing"
	deployBucketDegraded    = "degraded"
	deployBucketUnknown     = "unknown"
)

// ListRestartSeverity maps total pod restarts to a coarse bucket for list APIs (zero → none).
func ListRestartSeverity(restarts int32) string {
	if restarts <= 0 {
		return listRestartNone
	}
	switch {
	case restarts >= 20:
		return listRestartHigh
	case restarts >= 5:
		return listRestartMedium
	default:
		return listRestartLow
	}
}

// EnrichPodListItemsForAPI returns a shallow copy slice with snapshot-derived list hints per row.
func EnrichPodListItemsForAPI(items []dto.PodListItemDTO) []dto.PodListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.PodListItemDTO, len(items))
	for i := range items {
		p := items[i]
		p.RestartSeverity = ListRestartSeverity(p.Restarts)
		p.ListHealthHint = podListHealthHint(p)
		out[i] = p
	}
	return out
}

func podListHealthHint(p dto.PodListItemDTO) string {
	if p.Phase == "Failed" || p.Phase == "Pending" {
		return podListHintProblem
	}
	if p.Restarts >= 10 {
		return podListHintProblem
	}
	if podListNotReady(p.Ready) {
		return podListHintProblem
	}
	if p.Restarts >= 3 {
		return podListHintAttention
	}
	if p.LastEvent != nil && p.LastEvent.Type == "Warning" {
		return podListHintAttention
	}
	return podListHintOK
}

func podListNotReady(ready string) bool {
	parts := strings.Split(ready, "/")
	if len(parts) != 2 {
		return false
	}
	a, e1 := strconv.Atoi(parts[0])
	b, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil {
		return false
	}
	return b > 0 && a < b
}

// EnrichDeploymentListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichDeploymentListItemsForAPI(items []dto.DeploymentListItemDTO) []dto.DeploymentListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.DeploymentListItemDTO, len(items))
	for i := range items {
		d := items[i]
		bucket, attention := deploymentListSignals(d)
		d.HealthBucket = bucket
		d.RolloutNeedsAttention = attention
		out[i] = d
	}
	return out
}

func deploymentListSignals(d dto.DeploymentListItemDTO) (bucket string, needsAttention bool) {
	switch d.Status {
	case "Available":
		return deployBucketHealthy, false
	case "Progressing":
		return deployBucketProgressing, false
	case "Paused", "ScaledDown":
		return deployBucketUnknown, false
	}
	if d.UpToDate > 0 && d.Available < d.UpToDate {
		return deployBucketDegraded, true
	}
	if podListNotReady(d.Ready) {
		return deployBucketDegraded, true
	}
	return deployBucketUnknown, false
}

// EnrichDaemonSetListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichDaemonSetListItemsForAPI(items []dto.DaemonSetDTO) []dto.DaemonSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.DaemonSetDTO, len(items))
	for i := range items {
		ds := items[i]
		ds.HealthBucket, ds.NeedsAttention = daemonSetListSignals(ds)
		out[i] = ds
	}
	return out
}

func daemonSetListSignals(ds dto.DaemonSetDTO) (bucket string, needsAttention bool) {
	switch {
	case ds.Desired == 0:
		return deployBucketHealthy, false
	case ds.Ready == ds.Desired:
		return deployBucketHealthy, false
	case ds.Current < ds.Desired || ds.Updated < ds.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichStatefulSetListItemsForAPI returns a shallow copy with snapshot-derived rollout hints.
func EnrichStatefulSetListItemsForAPI(items []dto.StatefulSetDTO) []dto.StatefulSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.StatefulSetDTO, len(items))
	for i := range items {
		sts := items[i]
		sts.HealthBucket, sts.NeedsAttention = statefulSetListSignals(sts)
		out[i] = sts
	}
	return out
}

func statefulSetListSignals(sts dto.StatefulSetDTO) (bucket string, needsAttention bool) {
	switch {
	case sts.Desired == 0:
		return deployBucketHealthy, false
	case sts.Ready == sts.Desired && sts.Desired > 0:
		return deployBucketHealthy, false
	case sts.Current < sts.Desired || sts.Updated < sts.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichReplicaSetListItemsForAPI returns a shallow copy with snapshot-derived readiness hints.
func EnrichReplicaSetListItemsForAPI(items []dto.ReplicaSetDTO) []dto.ReplicaSetDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ReplicaSetDTO, len(items))
	for i := range items {
		rs := items[i]
		rs.HealthBucket, rs.NeedsAttention = replicaSetListSignals(rs)
		out[i] = rs
	}
	return out
}

func replicaSetListSignals(rs dto.ReplicaSetDTO) (bucket string, needsAttention bool) {
	switch {
	case rs.Desired == 0:
		return deployBucketHealthy, false
	case rs.Ready == rs.Desired && rs.Desired > 0:
		return deployBucketHealthy, false
	case rs.Ready < rs.Desired:
		return deployBucketProgressing, false
	default:
		return deployBucketDegraded, true
	}
}

// EnrichJobListItemsForAPI returns a shallow copy with snapshot-derived status hints.
func EnrichJobListItemsForAPI(items []dto.JobDTO) []dto.JobDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.JobDTO, len(items))
	for i := range items {
		j := items[i]
		j.HealthBucket, j.NeedsAttention = jobListSignals(j)
		out[i] = j
	}
	return out
}

func jobListSignals(j dto.JobDTO) (bucket string, needsAttention bool) {
	switch j.Status {
	case "Complete":
		return deployBucketHealthy, false
	case "Failed":
		return deployBucketDegraded, true
	case "Running":
		return deployBucketProgressing, false
	default:
		if j.Failed > 0 {
			return deployBucketDegraded, true
		}
		if j.Active > 0 {
			return deployBucketProgressing, false
		}
		return deployBucketUnknown, false
	}
}

// EnrichCronJobListItemsForAPI returns a shallow copy with snapshot-derived status hints.
func EnrichCronJobListItemsForAPI(items []dto.CronJobDTO) []dto.CronJobDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.CronJobDTO, len(items))
	for i := range items {
		cj := items[i]
		cj.HealthBucket, cj.NeedsAttention = cronJobListSignals(cj)
		out[i] = cj
	}
	return out
}

func cronJobListSignals(cj dto.CronJobDTO) (bucket string, needsAttention bool) {
	switch {
	case cj.Suspend:
		return deployBucketHealthy, false
	case cj.Active >= 8:
		return deployBucketDegraded, true
	case cj.Active > 0:
		return deployBucketProgressing, false
	default:
		return deployBucketHealthy, false
	}
}

// EnrichServiceListItemsForAPI returns a shallow copy with endpoint and exposure hints.
func EnrichServiceListItemsForAPI(items []dto.ServiceListItemDTO) []dto.ServiceListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ServiceListItemDTO, len(items))
	for i := range items {
		svc := items[i]
		svc.EndpointHealthBucket, svc.NeedsAttention = serviceListSignals(svc)
		svc.ExposureHint = serviceExposureHint(svc)
		out[i] = svc
	}
	return out
}

func serviceListSignals(svc dto.ServiceListItemDTO) (bucket string, needsAttention bool) {
	switch {
	case svc.Type == "ExternalName":
		return deployBucketHealthy, false
	case svc.EndpointsReady > 0 && svc.EndpointsNotReady == 0:
		return deployBucketHealthy, false
	case svc.EndpointsReady > 0 && svc.EndpointsNotReady > 0:
		return deployBucketProgressing, true
	case svc.EndpointsReady == 0 && svc.EndpointsNotReady > 0:
		return deployBucketDegraded, true
	default:
		return deployBucketDegraded, true
	}
}

func serviceExposureHint(svc dto.ServiceListItemDTO) string {
	switch svc.Type {
	case "LoadBalancer":
		return "public"
	case "NodePort":
		return "node"
	case "ExternalName":
		return "external"
	default:
		return "internal"
	}
}

// EnrichIngressListItemsForAPI returns a shallow copy with routing/address/TLS hints.
func EnrichIngressListItemsForAPI(items []dto.IngressListItemDTO) []dto.IngressListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.IngressListItemDTO, len(items))
	for i := range items {
		ing := items[i]
		ing.RoutingHealthBucket, ing.NeedsAttention = ingressListSignals(ing)
		ing.AddressState = ingressAddressState(ing)
		ing.TLSHint = ingressTLSHint(ing)
		out[i] = ing
	}
	return out
}

func ingressListSignals(ing dto.IngressListItemDTO) (bucket string, needsAttention bool) {
	switch {
	case len(ing.Hosts) == 0:
		return deployBucketDegraded, true
	case len(ing.Addresses) == 0:
		return deployBucketProgressing, true
	default:
		return deployBucketHealthy, false
	}
}

func ingressAddressState(ing dto.IngressListItemDTO) string {
	if len(ing.Addresses) == 0 {
		return "pending"
	}
	return "ready"
}

func ingressTLSHint(ing dto.IngressListItemDTO) string {
	if ing.TLSCount > 0 {
		return "enabled"
	}
	return "none"
}

// EnrichPVCListItemsForAPI returns a shallow copy with health and resize hints.
func EnrichPVCListItemsForAPI(items []dto.PersistentVolumeClaimDTO) []dto.PersistentVolumeClaimDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.PersistentVolumeClaimDTO, len(items))
	for i := range items {
		pvc := items[i]
		pvc.HealthBucket, pvc.NeedsAttention = pvcListSignals(pvc)
		pvc.ResizePending = pvc.RequestedStorage != "" && pvc.Capacity != "" && pvc.RequestedStorage != pvc.Capacity
		out[i] = pvc
	}
	return out
}

func pvcListSignals(pvc dto.PersistentVolumeClaimDTO) (bucket string, needsAttention bool) {
	switch pvc.Phase {
	case "Bound":
		return deployBucketHealthy, false
	case "Pending":
		return deployBucketProgressing, true
	case "Lost":
		return deployBucketDegraded, true
	default:
		return deployBucketUnknown, false
	}
}

// EnrichHelmReleaseListItemsForAPI returns a shallow copy with release stability hints.
func EnrichHelmReleaseListItemsForAPI(items []dto.HelmReleaseDTO) []dto.HelmReleaseDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.HelmReleaseDTO, len(items))
	for i := range items {
		rel := items[i]
		rel.StabilityBucket, rel.Transitional, rel.NeedsAttention = helmReleaseListSignals(rel, time.Now())
		out[i] = rel
	}
	return out
}

func helmReleaseListSignals(rel dto.HelmReleaseDTO, now time.Time) (bucket string, transitional bool, needsAttention bool) {
	switch rel.Status {
	case "deployed", "superseded":
		return deployBucketHealthy, false, false
	case "failed":
		return deployBucketDegraded, false, true
	case "pending-install", "pending-upgrade", "pending-rollback", "uninstalling":
		return deployBucketProgressing, true, helmReleaseTransitionLooksStuck(rel, now)
	case "unknown":
		return deployBucketUnknown, false, true
	default:
		return deployBucketUnknown, false, false
	}
}

func helmReleaseTransitionLooksStuck(rel dto.HelmReleaseDTO, now time.Time) bool {
	if rel.Updated <= 0 || now.IsZero() {
		return false
	}
	return now.Sub(time.Unix(rel.Updated, 0)) >= time.Hour
}

// EnrichConfigMapListItemsForAPI returns a shallow copy with content hints.
func EnrichConfigMapListItemsForAPI(items []dto.ConfigMapDTO) []dto.ConfigMapDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ConfigMapDTO, len(items))
	for i := range items {
		cm := items[i]
		cm.ContentHint, cm.NeedsAttention = configContentHint(cm.KeysCount)
		out[i] = cm
	}
	return out
}

func configContentHint(keys int) (hint string, needsAttention bool) {
	switch {
	case keys <= 0:
		return "empty", true
	case keys <= 2:
		return "small", false
	default:
		return "normal", false
	}
}

// EnrichSecretListItemsForAPI returns a shallow copy with content and secret type hints.
func EnrichSecretListItemsForAPI(items []dto.SecretDTO) []dto.SecretDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.SecretDTO, len(items))
	for i := range items {
		sec := items[i]
		sec.ContentHint, sec.NeedsAttention = configContentHint(sec.KeysCount)
		sec.TypeHint = secretTypeHint(sec.Type)
		out[i] = sec
	}
	return out
}

func secretTypeHint(secretType string) string {
	switch secretType {
	case "kubernetes.io/tls":
		return "tls"
	case "kubernetes.io/dockerconfigjson", "kubernetes.io/dockercfg":
		return "registry"
	case "kubernetes.io/service-account-token":
		return "service-account"
	case "kubernetes.io/basic-auth", "kubernetes.io/ssh-auth":
		return "auth"
	case "Opaque":
		return "opaque"
	default:
		if secretType == "" {
			return "unknown"
		}
		return "custom"
	}
}

// EnrichServiceAccountListItemsForAPI returns a shallow copy with token/pull-secret posture hints.
func EnrichServiceAccountListItemsForAPI(items []dto.ServiceAccountListItemDTO) []dto.ServiceAccountListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ServiceAccountListItemDTO, len(items))
	for i := range items {
		sa := items[i]
		sa.TokenMountPolicy = serviceAccountTokenMountPolicy(sa.AutomountServiceAccountToken)
		sa.PullSecretHint = serviceAccountPullSecretHint(sa.ImagePullSecretsCount)
		out[i] = sa
	}
	return out
}

func serviceAccountTokenMountPolicy(auto *bool) string {
	if auto == nil {
		return "default"
	}
	if *auto {
		return "enabled"
	}
	return "disabled"
}

func serviceAccountPullSecretHint(count int) string {
	if count <= 0 {
		return "none"
	}
	return "configured"
}

// EnrichNodeListItemsForAPI returns a shallow copy with node readiness and pod-density hints.
func EnrichNodeListItemsForAPI(items []dto.NodeListItemDTO) []dto.NodeListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.NodeListItemDTO, len(items))
	for i := range items {
		node := items[i]
		if !node.Derived || node.HealthBucket == "" {
			node.HealthBucket, node.NeedsAttention = nodeListSignals(node)
		}
		node.PodDensityRatio, node.PodDensityBucket = nodePodDensity(node)
		if node.PodDensityBucket == deployBucketDegraded {
			node.NeedsAttention = true
		}
		out[i] = node
	}
	return out
}

func MergeDirectAndDerivedNodeListItems(direct, derived []dto.NodeListItemDTO) []dto.NodeListItemDTO {
	if len(direct) == 0 {
		out := append([]dto.NodeListItemDTO(nil), derived...)
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		return out
	}
	out := make([]dto.NodeListItemDTO, 0, len(direct)+len(derived))
	seen := make(map[string]int, len(direct)+len(derived))
	for _, node := range direct {
		if node.Name == "" {
			continue
		}
		seen[node.Name] = len(out)
		out = append(out, node)
	}
	for _, node := range derived {
		if node.Name == "" {
			continue
		}
		if idx, ok := seen[node.Name]; ok {
			out[idx] = mergeNodeListItemSignals(out[idx], node)
			continue
		}
		seen[node.Name] = len(out)
		out = append(out, node)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func mergeNodeListItemSignals(direct, derived dto.NodeListItemDTO) dto.NodeListItemDTO {
	if derived.PodsCount > direct.PodsCount {
		direct.PodsCount = derived.PodsCount
	}
	if derived.NamespaceCount > direct.NamespaceCount {
		direct.NamespaceCount = derived.NamespaceCount
	}
	if derived.ProblematicPods > direct.ProblematicPods {
		direct.ProblematicPods = derived.ProblematicPods
	}
	if derived.RestartCount > direct.RestartCount {
		direct.RestartCount = derived.RestartCount
	}
	return direct
}

func nodeListSignals(node dto.NodeListItemDTO) (bucket string, needsAttention bool) {
	switch node.Status {
	case "Ready":
		return deployBucketHealthy, false
	case "NotReady":
		return deployBucketDegraded, true
	case "Unknown":
		return deployBucketProgressing, true
	default:
		return deployBucketUnknown, false
	}
}

func nodePodDensity(node dto.NodeListItemDTO) (ratio float64, bucket string) {
	total, err := strconv.Atoi(strings.TrimSpace(node.PodsAllocatable))
	if err != nil || total <= 0 {
		return 0, deployBucketUnknown
	}
	ratio = float64(node.PodsCount) / float64(total)
	switch {
	case ratio >= 0.9:
		return ratio, deployBucketDegraded
	case ratio >= 0.75:
		return ratio, deployBucketProgressing
	default:
		return ratio, deployBucketHealthy
	}
}

// EnrichRoleListItemsForAPI returns a shallow copy with coarse rules-count breadth hints.
func EnrichRoleListItemsForAPI(items []dto.RoleListItemDTO) []dto.RoleListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.RoleListItemDTO, len(items))
	for i := range items {
		role := items[i]
		role.PrivilegeBreadth, role.NeedsAttention = rolePrivilegeBreadth(role.RulesCount)
		out[i] = role
	}
	return out
}

func rolePrivilegeBreadth(rules int) (breadth string, needsAttention bool) {
	switch {
	case rules <= 0:
		return "empty", true
	case rules >= 12:
		return "broad", true
	case rules >= 5:
		return "medium", false
	default:
		return "narrow", false
	}
}

// EnrichRoleBindingListItemsForAPI returns a shallow copy with role-ref and subject breadth hints.
func EnrichRoleBindingListItemsForAPI(items []dto.RoleBindingListItemDTO) []dto.RoleBindingListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.RoleBindingListItemDTO, len(items))
	for i := range items {
		rb := items[i]
		rb.BindingHint = roleBindingHint(rb.RoleRefKind)
		rb.SubjectBreadth, rb.NeedsAttention = subjectBreadth(rb.SubjectsCount)
		out[i] = rb
	}
	return out
}

func roleBindingHint(kind string) string {
	switch kind {
	case "ClusterRole":
		return "cluster-role"
	case "Role":
		return "namespace-role"
	default:
		return "unknown"
	}
}

func subjectBreadth(subjects int) (breadth string, needsAttention bool) {
	switch {
	case subjects <= 0:
		return "empty", true
	case subjects >= 10:
		return "broad", true
	case subjects >= 4:
		return "medium", false
	default:
		return "narrow", false
	}
}

// EnrichPersistentVolumeListItemsForAPI returns a shallow copy with binding and lifecycle hints.
func EnrichPersistentVolumeListItemsForAPI(items []dto.PersistentVolumeDTO) []dto.PersistentVolumeDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.PersistentVolumeDTO, len(items))
	for i := range items {
		pv := items[i]
		pv.HealthBucket, pv.NeedsAttention = persistentVolumeListSignals(pv)
		pv.BindingHint = persistentVolumeBindingHint(pv)
		out[i] = pv
	}
	return out
}

func persistentVolumeListSignals(pv dto.PersistentVolumeDTO) (bucket string, needsAttention bool) {
	switch pv.Phase {
	case "Bound":
		return deployBucketHealthy, false
	case "Available":
		return deployBucketProgressing, false
	case "Released", "Failed":
		return deployBucketDegraded, true
	default:
		return deployBucketUnknown, false
	}
}

func persistentVolumeBindingHint(pv dto.PersistentVolumeDTO) string {
	if strings.TrimSpace(pv.ClaimRef) != "" {
		return "bound"
	}
	if pv.Phase == "Released" {
		return "released"
	}
	if pv.Phase == "Available" {
		return "available"
	}
	return "unbound"
}

// EnrichClusterRoleListItemsForAPI returns a shallow copy with coarse rules-count breadth hints.
func EnrichClusterRoleListItemsForAPI(items []dto.ClusterRoleListItemDTO) []dto.ClusterRoleListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ClusterRoleListItemDTO, len(items))
	for i := range items {
		role := items[i]
		role.PrivilegeBreadth, role.NeedsAttention = rolePrivilegeBreadth(role.RulesCount)
		out[i] = role
	}
	return out
}

// EnrichClusterRoleBindingListItemsForAPI returns a shallow copy with role-ref and subject breadth hints.
func EnrichClusterRoleBindingListItemsForAPI(items []dto.ClusterRoleBindingListItemDTO) []dto.ClusterRoleBindingListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.ClusterRoleBindingListItemDTO, len(items))
	for i := range items {
		rb := items[i]
		rb.BindingHint = roleBindingHint(rb.RoleRefKind)
		rb.SubjectBreadth, rb.NeedsAttention = subjectBreadth(rb.SubjectsCount)
		out[i] = rb
	}
	return out
}

// EnrichCRDListItemsForAPI returns a shallow copy with establishment and version breadth hints.
func EnrichCRDListItemsForAPI(items []dto.CRDListItemDTO) []dto.CRDListItemDTO {
	if len(items) == 0 {
		return items
	}
	out := make([]dto.CRDListItemDTO, len(items))
	for i := range items {
		crd := items[i]
		crd.VersionBreadth = crdVersionBreadth(crd.Versions)
		if crd.Established {
			crd.HealthBucket = deployBucketHealthy
		} else {
			crd.HealthBucket = deployBucketDegraded
			crd.NeedsAttention = true
		}
		out[i] = crd
	}
	return out
}

func crdVersionBreadth(versions string) string {
	parts := strings.FieldsFunc(versions, func(r rune) bool {
		return r == ',' || r == ' '
	})
	count := 0
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			count++
		}
	}
	switch {
	case count <= 0:
		return "none"
	case count == 1:
		return "single"
	default:
		return "multi"
	}
}
