package dataplane

import (
	"context"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

// NamespaceInsightsProjection is a dataplane-backed namespace observability view.
type NamespaceInsightsProjection struct {
	Insights dto.NamespaceInsightsDTO
	Meta     SnapshotMetadata
	Err      *NormalizedError
}

// NamespaceInsightsProjection builds namespace observability details from dataplane snapshots only.
func (m *manager) NamespaceInsightsProjection(ctx context.Context, clusterName, namespace string) (NamespaceInsightsProjection, error) {
	var out NamespaceInsightsProjection

	proj, err := m.NamespaceSummaryProjection(ctx, clusterName, namespace)
	out.Meta = proj.Meta
	out.Err = proj.Err
	out.Insights.Summary = proj.Resources
	if err != nil {
		return out, err
	}

	planeAny, _ := m.PlaneForCluster(ctx, clusterName)
	plane := planeAny.(*clusterPlane)
	ctx = ContextWithWorkSourceIfUnset(ctx, WorkSourceProjection)
	prio := WorkPriorityHigh

	podsSnap, podsErr := plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	depsSnap, depsErr := plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	svcsSnap, svcsErr := plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	ingSnap, ingErr := plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	pvcsSnap, pvcsErr := plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	cmsSnap, cmsErr := plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	secsSnap, secsErr := plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	dsSnap, dsErr := plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	stsSnap, stsErr := plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	rsSnap, rsErr := plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	jobsSnap, jobsErr := plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	cjSnap, cjErr := plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	hpaSnap, hpaErr := plane.HPAsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	saSnap, saErr := plane.ServiceAccountsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	rolesSnap, rolesErr := plane.RolesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	roleBindingsSnap, roleBindingsErr := plane.RoleBindingsSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	helmSnap, helmErr := plane.HelmReleasesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	rqSnap, rqErr := plane.ResourceQuotasSnapshot(ctx, m.scheduler, m.clients, namespace, prio)
	lrSnap, lrErr := plane.LimitRangesSnapshot(ctx, m.scheduler, m.clients, namespace, prio)

	if rqErr == nil {
		out.Insights.ResourceQuotas = append(out.Insights.ResourceQuotas, rqSnap.Items...)
	}
	if lrErr == nil {
		out.Insights.LimitRanges = append(out.Insights.LimitRanges, lrSnap.Items...)
	}

	signals := newDashboardSignalStore()
	signals.Add(detectDashboardSignals(time.Now(), namespace, dashboardSnapshotSet{
		pods:           podsSnap,
		podsOK:         podsErr == nil,
		deps:           depsSnap,
		depsOK:         depsErr == nil,
		ds:             dsSnap,
		dsOK:           dsErr == nil,
		sts:            stsSnap,
		stsOK:          stsErr == nil,
		rs:             rsSnap,
		rsOK:           rsErr == nil,
		jobs:           jobsSnap,
		jobsOK:         jobsErr == nil,
		cjs:            cjSnap,
		cjsOK:          cjErr == nil,
		hpas:           hpaSnap,
		hpasOK:         hpaErr == nil,
		svcs:           svcsSnap,
		svcsOK:         svcsErr == nil,
		ings:           ingSnap,
		ingsOK:         ingErr == nil,
		pvcs:           pvcsSnap,
		pvcsOK:         pvcsErr == nil,
		cms:            cmsSnap,
		cmsOK:          cmsErr == nil,
		secs:           secsSnap,
		secsOK:         secsErr == nil,
		sas:            saSnap,
		sasOK:          saErr == nil,
		roles:          rolesSnap,
		rolesOK:        rolesErr == nil,
		roleBindings:   roleBindingsSnap,
		roleBindingsOK: roleBindingsErr == nil,
		helmReleases:   helmSnap,
		helmOK:         helmErr == nil,
		resourceQuotas: rqSnap,
		quotasOK:       rqErr == nil,
		limitRanges:    lrSnap,
		limitRangesOK:  lrErr == nil,
	})...)
	sorted := signals.Summary(signals.Len(), ClusterDashboardListOptions{SignalsLimit: signals.Len()})
	out.Insights.Signals = namespaceInsightSignalsFromDashboard(sorted.Items)
	out.Insights.ResourceSignals = namespaceInsightResourceSignalsFromDashboard(signals.ResourceSignals())
	return out, nil
}

func namespaceInsightSignalsFromDashboard(items []ClusterDashboardSignal) []dto.NamespaceInsightSignalDTO {
	out := make([]dto.NamespaceInsightSignalDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dto.NamespaceInsightSignalDTO{
			Kind:            item.Kind,
			Namespace:       item.Namespace,
			Name:            item.Name,
			Severity:        item.Severity,
			Score:           item.Score,
			Reason:          item.Reason,
			LikelyCause:     item.LikelyCause,
			SuggestedAction: item.SuggestedAction,
			Confidence:      item.Confidence,
			Section:         item.Section,
			SignalType:      item.SignalType,
			ResourceKind:    item.ResourceKind,
			ResourceName:    item.ResourceName,
			Scope:           item.Scope,
			ScopeLocation:   item.ScopeLocation,
			ActualData:      item.ActualData,
			CalculatedData:  item.CalculatedData,
		})
	}
	return out
}

func namespaceInsightResourceSignalsFromDashboard(items []dashboardSignalResourceSignals) []dto.NamespaceResourceSignalsDTO {
	out := make([]dto.NamespaceResourceSignalsDTO, 0, len(items))
	for _, item := range items {
		out = append(out, dto.NamespaceResourceSignalsDTO{
			ResourceKind:  item.ResourceKind,
			ResourceName:  item.ResourceName,
			Scope:         item.Scope,
			ScopeLocation: item.ScopeLocation,
			Signals:       namespaceInsightSignalsFromDashboard(item.Signals),
		})
	}
	return out
}
