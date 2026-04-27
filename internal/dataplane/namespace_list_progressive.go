package dataplane

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/korex-labs/kview/internal/kube/dto"
	namespaces "github.com/korex-labs/kview/internal/kube/resource/namespaces"
	"github.com/korex-labs/kview/internal/runtime"
)

const nsEnrichActivityTTL = 3 * time.Minute

// NamespaceListEnrichmentPoll is the JSON body for GET /api/namespaces/enrichment.
type NamespaceListEnrichmentPoll struct {
	Revision       uint64                     `json:"revision"`
	Stale          bool                       `json:"stale,omitempty"`
	LatestRevision uint64                     `json:"latestRevision,omitempty"`
	Complete       bool                       `json:"complete"`
	Stage          string                     `json:"stage,omitempty"`
	DetailRows     int                        `json:"detailRows"`
	RelatedRows    int                        `json:"relatedRows"`
	TotalRows      int                        `json:"totalRows"`
	EnrichTargets  int                        `json:"enrichTargets"`
	Updates        []dto.NamespaceListItemDTO `json:"updates"`
	Active         string                     `json:"active,omitempty"`
}

func (m *manager) selectNamespaceSweepNames(cluster string, order []string, focused []string, policy NamespaceEnrichmentPolicy) []string {
	sweep := policy.Sweep
	if !policy.Enabled || !sweep.Enabled || sweep.MaxNamespacesPerCycle <= 0 || sweep.MaxNamespacesPerHour <= 0 {
		return nil
	}
	if sweep.PauseWhenSchedulerBusy && m.schedulerHasWork(cluster) {
		return nil
	}
	if sweep.PauseOnRateLimitOrConnectivity && m.clusterHasSweepBlockingIssue(cluster) {
		return nil
	}
	now := time.Now().UTC()

	focusedSet := make(map[string]struct{}, len(focused))
	for _, name := range focused {
		focusedSet[name] = struct{}{}
	}

	m.nsSweepMu.Lock()
	defer m.nsSweepMu.Unlock()
	hourStart := m.nsSweepHourStart[cluster]
	if hourStart.IsZero() || now.Sub(hourStart) >= time.Hour {
		m.nsSweepHourStart[cluster] = now
		m.nsSweepHourCount[cluster] = 0
	}
	remainingHour := sweep.MaxNamespacesPerHour - m.nsSweepHourCount[cluster]
	if remainingHour <= 0 {
		return nil
	}
	limit := sweep.MaxNamespacesPerCycle
	if remainingHour < limit {
		limit = remainingHour
	}

	lastByNS := m.nsSweepLast[cluster]
	if lastByNS == nil {
		lastByNS = map[string]time.Time{}
		m.nsSweepLast[cluster] = lastByNS
	}
	minAge := time.Duration(sweep.MinReenrichIntervalMinutes) * time.Minute
	type candidate struct {
		name string
		last time.Time
		pos  int
	}
	candidates := make([]candidate, 0, len(order))
	for pos, name := range order {
		if name == "" {
			continue
		}
		if _, ok := focusedSet[name]; ok {
			continue
		}
		if !sweep.IncludeSystemNamespaces && isSystemNamespace(name) {
			continue
		}
		last := lastByNS[name]
		if !last.IsZero() && now.Sub(last) < minAge {
			continue
		}
		candidates = append(candidates, candidate{name: name, last: last, pos: pos})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.last.IsZero() != b.last.IsZero() {
			return a.last.IsZero()
		}
		if !a.last.Equal(b.last) {
			return a.last.Before(b.last)
		}
		return a.pos < b.pos
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	out := make([]string, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, c.name)
	}
	m.nsSweepHourCount[cluster] += len(out)
	return out
}

func (m *manager) schedulerHasWork(cluster string) bool {
	if m.scheduler == nil {
		return false
	}
	work := m.scheduler.LiveWorkSnapshot(time.Now())
	for _, row := range work.Running {
		if row.Cluster == cluster {
			return true
		}
	}
	for _, row := range work.Queued {
		if row.Cluster == cluster {
			return true
		}
	}
	return false
}

func (m *manager) clusterHasSweepBlockingIssue(cluster string) bool {
	m.mu.RLock()
	plane := m.planes[cluster]
	m.mu.RUnlock()
	if plane == nil {
		return false
	}
	blocked := func(err *NormalizedError) bool {
		if err == nil {
			return false
		}
		switch err.Class {
		case NormalizedErrorClassRateLimited,
			NormalizedErrorClassTimeout,
			NormalizedErrorClassTransient,
			NormalizedErrorClassProxyFailure,
			NormalizedErrorClassConnectivity:
			return true
		default:
			return false
		}
	}
	if snap, ok := peekClusterSnapshot(&plane.nsStore); ok && blocked(snap.Err) {
		return true
	}
	if snap, ok := peekClusterSnapshot(&plane.nodesStore); ok && blocked(snap.Err) {
		return true
	}
	return false
}

func (m *manager) markNamespaceSwept(cluster, namespace string) {
	if cluster == "" || namespace == "" {
		return
	}
	m.nsSweepMu.Lock()
	defer m.nsSweepMu.Unlock()
	if m.nsSweepLast[cluster] == nil {
		m.nsSweepLast[cluster] = map[string]time.Time{}
	}
	m.nsSweepLast[cluster][namespace] = time.Now().UTC()
}

func isSystemNamespace(name string) bool {
	return name == "default" ||
		name == "kube-system" ||
		name == "kube-public" ||
		name == "kube-node-lease" ||
		strings.HasPrefix(name, "openshift-")
}

type nsEnrichmentCoordinator struct {
	mu        sync.Mutex
	byCluster map[string]*nsEnrichSession
	nextRev   uint64
}

type nsEnrichSession struct {
	rev    uint64
	ctx    context.Context
	cancel context.CancelFunc

	mu sync.Mutex

	// order is full list snapshot order (for poll payload).
	order []string
	// workNames is the scored subset that receives GET + snapshot enrichment.
	workNames []string
	// favouriteInsightNames is the subset of workNames that should receive broader
	// namespace-insights prewarming to speed up drawer opens.
	favouriteInsightNames []string
	// sweepNames is the optional cold trickle subset outside focused/recent/favourite hints.
	sweepNames []string
	// merged holds list row + progressive patches (detail then related).
	merged map[string]dto.NamespaceListItemDTO

	detailDone  int
	relatedDone int
	total       int
	complete    bool

	activityID string
}

func newNsEnrichmentCoordinator() *nsEnrichmentCoordinator {
	return &nsEnrichmentCoordinator{
		byCluster: make(map[string]*nsEnrichSession),
	}
}

// BeginNamespaceListProgressiveEnrichment cancels any prior run for the cluster and, after the API is
// idle, enriches only namespaces selected by hints (current, recent, favourites). Others stay list-only.
// Returns 0 when there is no client provider, no namespaces, or no eligible enrichment targets.
func (m *manager) BeginNamespaceListProgressiveEnrichment(cluster string, items []dto.NamespaceListItemDTO, hints NamespaceEnrichHints) uint64 {
	if m.clients == nil || len(items) == 0 {
		return 0
	}
	policy := m.Policy().NamespaceEnrichment
	if !policy.Enabled {
		return 0
	}

	order := make([]string, 0, len(items))
	merged := make(map[string]dto.NamespaceListItemDTO, len(items))
	for _, it := range items {
		if it.Name == "" {
			continue
		}
		order = append(order, it.Name)
		merged[it.Name] = it
	}
	if len(order) == 0 {
		return 0
	}

	focusedHints := applyNamespaceEnrichmentPolicyHints(hints, policy)
	workNames := buildEnrichmentWorkOrder(order, focusedHints, policy.MaxTargets)
	favouriteInsightNames := filterFavouriteInsightWarmTargets(workNames, focusedHints)
	sweepNames := m.selectNamespaceSweepNames(cluster, order, workNames, policy)
	if len(workNames) == 0 && len(sweepNames) == 0 {
		return 0
	}

	m.nsEnrich.mu.Lock()
	if old, ok := m.nsEnrich.byCluster[cluster]; ok {
		if sameStringSlice(old.order, order) &&
			sameStringSlice(old.workNames, workNames) &&
			sameStringSlice(old.favouriteInsightNames, favouriteInsightNames) &&
			sameStringSlice(old.sweepNames, sweepNames) {
			old.updateBaseRows(order, merged)
			rev := old.rev
			m.nsEnrich.mu.Unlock()
			return rev
		}
		merged = old.mergeExistingRowsInto(order, merged)
		old.cancel()
		delete(m.nsEnrich.byCluster, cluster)
	}
	m.nsEnrich.nextRev++
	rev := m.nsEnrich.nextRev
	ctx, cancel := context.WithCancel(context.Background())
	sess := &nsEnrichSession{
		rev:                   rev,
		ctx:                   ctx,
		cancel:                cancel,
		order:                 order,
		workNames:             workNames,
		favouriteInsightNames: favouriteInsightNames,
		sweepNames:            sweepNames,
		merged:                merged,
		total:                 len(workNames) + len(sweepNames),
		activityID:            namespaceEnrichActivityID(cluster),
	}
	m.nsEnrich.byCluster[cluster] = sess
	m.nsEnrich.mu.Unlock()

	if reg := m.activityReg(); reg != nil && sess.activityID != "" {
		now := time.Now().UTC()
		act := runtime.Activity{
			ID:           sess.activityID,
			Kind:         runtime.ActivityKindWorker,
			Type:         runtime.ActivityTypeNamespaceListEnrich,
			Title:        fmt.Sprintf("Namespace list enrichment · %s", cluster),
			Status:       runtime.ActivityStatusRunning,
			CreatedAt:    now,
			UpdatedAt:    now,
			StartedAt:    now,
			ResourceType: "kubernetes:namespaceListRows",
			Metadata: map[string]string{
				"cluster":                 cluster,
				"revision":                strconv.FormatUint(rev, 10),
				"enrichTargets":           strconv.Itoa(sess.total),
				"focusedTargets":          strconv.Itoa(len(workNames)),
				"favouriteInsightTargets": strconv.Itoa(len(favouriteInsightNames)),
				"sweepTargets":            strconv.Itoa(len(sweepNames)),
				"warmKinds":               strconv.Itoa(len(policy.WarmResourceKinds)),
				"stage":                   initialNamespaceEnrichStage(workNames, sweepNames),
				"listNamespaces":          strconv.Itoa(len(order)),
			},
		}
		_ = reg.Register(context.Background(), act)
	}

	go m.runNamespaceListEnrichment(ctx, cluster, sess)
	return rev
}

func (m *manager) hasNamespaceEnrichmentInFlight(cluster string) bool {
	m.nsEnrich.mu.Lock()
	defer m.nsEnrich.mu.Unlock()
	sess, ok := m.nsEnrich.byCluster[cluster]
	return ok && sess != nil && !sess.isComplete()
}

func (s *nsEnrichSession) isComplete() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.complete
}

func initialNamespaceEnrichStage(workNames, sweepNames []string) string {
	if len(workNames) > 0 {
		return "focused_idle_wait"
	}
	if len(sweepNames) > 0 {
		return "sweep_idle_wait"
	}
	return "idle_wait"
}

func (s *nsEnrichSession) updateBaseRows(order []string, base map[string]dto.NamespaceListItemDTO) {
	s.mu.Lock()
	defer s.mu.Unlock()

	merged := make(map[string]dto.NamespaceListItemDTO, len(base))
	for _, name := range order {
		next := base[name]
		if cur, ok := s.merged[name]; ok && cur.RowEnriched {
			mergeNamespaceRowInto(&next, cur)
		}
		merged[name] = next
	}
	s.order = append(s.order[:0], order...)
	s.merged = merged
}

func (s *nsEnrichSession) mergeExistingRowsInto(order []string, base map[string]dto.NamespaceListItemDTO) map[string]dto.NamespaceListItemDTO {
	s.mu.Lock()
	defer s.mu.Unlock()

	merged := make(map[string]dto.NamespaceListItemDTO, len(base))
	for _, name := range order {
		next := base[name]
		if cur, ok := s.merged[name]; ok && cur.RowEnriched {
			mergeNamespaceRowInto(&next, cur)
		}
		merged[name] = next
	}
	return merged
}

func namespaceEnrichActivityID(cluster string) string {
	return "ns-enrich-" + activityIDComponent(cluster)
}

func activityIDComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "default"
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "default"
	}
	return out
}

func sameStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (m *manager) patchNsEnrichActivity(actID string, mut func(*runtime.Activity)) {
	reg := m.activityReg()
	if reg == nil || actID == "" {
		return
	}
	a, ok, _ := reg.Get(context.Background(), actID)
	if !ok {
		return
	}
	mut(&a)
	a.UpdatedAt = time.Now().UTC()
	_ = reg.Update(context.Background(), a)
}

func (m *manager) patchNsEnrichActivityProgress(actID string, sess *nsEnrichSession, stage string) {
	m.patchNsEnrichActivity(actID, func(a *runtime.Activity) {
		if a.Metadata == nil {
			a.Metadata = map[string]string{}
		}
		sess.mu.Lock()
		d, r, tot := sess.detailDone, sess.relatedDone, sess.total
		sess.mu.Unlock()
		a.Metadata["stage"] = stage
		a.Metadata["detailDone"] = strconv.Itoa(d)
		a.Metadata["relatedDone"] = strconv.Itoa(r)
		a.Metadata["enrichTargets"] = strconv.Itoa(tot)
	})
}

func (m *manager) finalizeNsEnrichActivity(actID string, sess *nsEnrichSession, runErr error) {
	reg := m.activityReg()
	if reg == nil || actID == "" {
		return
	}
	a, ok, _ := reg.Get(context.Background(), actID)
	if !ok {
		return
	}
	if a.Metadata != nil && a.Metadata["revision"] != strconv.FormatUint(sess.rev, 10) {
		return
	}
	now := time.Now().UTC()
	sess.mu.Lock()
	d, r, tot, complete := sess.detailDone, sess.relatedDone, sess.total, sess.complete
	sess.mu.Unlock()

	if a.Metadata == nil {
		a.Metadata = map[string]string{}
	}
	a.Metadata["detailDone"] = strconv.Itoa(d)
	a.Metadata["relatedDone"] = strconv.Itoa(r)
	a.Metadata["enrichTargets"] = strconv.Itoa(tot)

	switch {
	case runErr != nil:
		if errors.Is(runErr, context.Canceled) {
			a.Status = runtime.ActivityStatusStopped
			a.Metadata["outcome"] = "cancelled"
		} else {
			a.Status = runtime.ActivityStatusFailed
			a.Metadata["outcome"] = "error"
		}
	case complete && runErr == nil:
		a.Status = runtime.ActivityStatusStopped
		a.Metadata["outcome"] = "complete"
		a.Metadata["stage"] = "complete"
	default:
		a.Status = runtime.ActivityStatusFailed
		a.Metadata["outcome"] = "incomplete"
	}
	a.UpdatedAt = now
	_ = reg.Update(context.Background(), a)
	runtime.ScheduleActivityTTLRemoval(reg, actID, a.UpdatedAt, nsEnrichActivityTTL)
}

func (m *manager) runNamespaceListEnrichment(ctx context.Context, cluster string, sess *nsEnrichSession) {
	var runErr error
	defer func() { m.finalizeNsEnrichActivity(sess.activityID, sess, runErr) }()

	policy := m.Policy().NamespaceEnrichment
	if len(sess.workNames) > 0 {
		m.patchNsEnrichActivityProgress(sess.activityID, sess, "focused_idle_wait")
		runErr = m.waitAPIQuiet(ctx, time.Duration(policy.IdleQuietMs)*time.Millisecond)
		if runErr != nil {
			sess.mu.Lock()
			sess.complete = true
			sess.mu.Unlock()
			return
		}

		m.patchNsEnrichActivityProgress(sess.activityID, sess, "focused_enriching")
		runErr = m.runNamespaceEnrichmentBatch(ctx, cluster, sess, sess.workNames, policy.MaxParallel, "focused_enriching")
		if runErr != nil {
			sess.mu.Lock()
			sess.complete = true
			sess.mu.Unlock()
			return
		}
	}

	if len(sess.sweepNames) > 0 && policy.Sweep.Enabled {
		if policy.Sweep.PauseOnUserActivity {
			m.patchNsEnrichActivityProgress(sess.activityID, sess, "sweep_idle_wait")
			runErr = m.waitAPIQuiet(ctx, time.Duration(policy.Sweep.IdleQuietMs)*time.Millisecond)
			if runErr != nil {
				sess.mu.Lock()
				sess.complete = true
				sess.mu.Unlock()
				return
			}
		}
		m.patchNsEnrichActivityProgress(sess.activityID, sess, "sweep_enriching")
		runErr = m.runNamespaceEnrichmentBatch(ctx, cluster, sess, sess.sweepNames, policy.Sweep.MaxParallel, "sweep_enriching")
	}
	sess.mu.Lock()
	sess.complete = true
	sess.mu.Unlock()
}

func (m *manager) runNamespaceEnrichmentBatch(ctx context.Context, cluster string, sess *nsEnrichSession, names []string, maxParallel int, stage string) error {
	if len(names) == 0 {
		return nil
	}
	if maxParallel <= 0 {
		maxParallel = 1
	}
	policy := m.Policy().NamespaceEnrichment
	sem := make(chan struct{}, maxParallel)
	g, gctx := errgroup.WithContext(ctx)

	for _, name := range names {
		name := name
		g.Go(func() error {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			if policy.EnrichDetails {
				c, _, err := m.clients.GetClientsForContext(gctx, cluster)
				if err != nil {
					sess.mu.Lock()
					sess.detailDone++
					sess.relatedDone++
					sess.mu.Unlock()
					m.patchNsEnrichActivityProgress(sess.activityID, sess, stage)
					return nil
				}

				fields, err := namespaces.GetNamespaceListFields(gctx, c, name)
				sess.mu.Lock()
				row := sess.merged[name]
				if err == nil {
					row.Phase = fields.Phase
					row.AgeSec = fields.AgeSec
					row.HasUnhealthyConditions = fields.HasUnhealthyConditions
				}
				sess.merged[name] = row
				sess.detailDone++
				sess.mu.Unlock()
			} else {
				sess.mu.Lock()
				sess.detailDone++
				sess.mu.Unlock()
				m.patchNsEnrichActivityProgress(sess.activityID, sess, stage)
			}

			workCtx := ContextWithWorkSource(gctx, WorkSourceEnrichment)
			planeAny, perr := m.PlaneForCluster(workCtx, cluster)
			if perr != nil {
				sess.mu.Lock()
				sess.relatedDone++
				sess.mu.Unlock()
				m.patchNsEnrichActivityProgress(sess.activityID, sess, stage)
				return nil
			}
			plane := planeAny.(*clusterPlane)
			var podsSnap PodsSnapshot
			var depsSnap DeploymentsSnapshot
			if policy.EnrichPods {
				podsSnap, _ = plane.PodsSnapshot(workCtx, m.scheduler, m.clients, name, WorkPriorityLow)
			}
			if policy.EnrichDeployments {
				depsSnap, _ = plane.DeploymentsSnapshot(workCtx, m.scheduler, m.clients, name, WorkPriorityLow)
			}
			m.warmNamespaceEnrichmentResourceKinds(workCtx, plane, name, policy.WarmResourceKinds)
			if sess.shouldWarmFavouriteInsights(name) {
				m.warmNamespaceInsightsResourceKinds(workCtx, plane, name)
			}
			metrics, ok := buildCachedNamespaceListRowProjection(plane, name)
			if !ok {
				metrics = buildNamespaceListRowProjection(podsSnap, depsSnap)
			}

			sess.mu.Lock()
			cur := sess.merged[name]
			mergeNamespaceRowInto(&cur, metrics)
			sess.merged[name] = cur
			sess.relatedDone++
			sess.mu.Unlock()
			m.markNamespaceSwept(cluster, name)
			m.patchNsEnrichActivityProgress(sess.activityID, sess, stage)
			return nil
		})
	}

	return g.Wait()
}

func filterFavouriteInsightWarmTargets(workNames []string, hints NamespaceEnrichHints) []string {
	if len(workNames) == 0 || len(hints.Favorite) == 0 {
		return nil
	}
	out := make([]string, 0, len(workNames))
	for _, name := range workNames {
		if _, ok := hints.Favorite[name]; ok {
			out = append(out, name)
		}
	}
	return out
}

func (s *nsEnrichSession) shouldWarmFavouriteInsights(name string) bool {
	for _, candidate := range s.favouriteInsightNames {
		if candidate == name {
			return true
		}
	}
	return false
}

func (m *manager) warmNamespaceEnrichmentResourceKinds(ctx context.Context, plane *clusterPlane, namespace string, kinds []string) {
	if plane == nil || namespace == "" || len(kinds) == 0 {
		return
	}
	for _, raw := range kinds {
		switch ResourceKind(raw) {
		case ResourceKindPods:
			_, _ = plane.PodsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindDeployments:
			_, _ = plane.DeploymentsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindDaemonSets:
			_, _ = plane.DaemonSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindStatefulSets:
			_, _ = plane.StatefulSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindReplicaSets:
			_, _ = plane.ReplicaSetsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindJobs:
			_, _ = plane.JobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindCronJobs:
			_, _ = plane.CronJobsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindHPAs:
			_, _ = plane.HPAsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindServices:
			_, _ = plane.ServicesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindIngresses:
			_, _ = plane.IngressesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindPVCs:
			_, _ = plane.PVCsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindConfigMaps:
			_, _ = plane.ConfigMapsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindSecrets:
			_, _ = plane.SecretsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindServiceAccounts:
			_, _ = plane.ServiceAccountsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindRoles:
			_, _ = plane.RolesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindRoleBindings:
			_, _ = plane.RoleBindingsSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindHelmReleases:
			_, _ = plane.HelmReleasesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindResourceQuotas:
			_, _ = plane.ResourceQuotasSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		case ResourceKindLimitRanges:
			_, _ = plane.LimitRangesSnapshot(ctx, m.scheduler, m.clients, namespace, WorkPriorityLow)
		}
	}
}

func (m *manager) warmNamespaceInsightsResourceKinds(ctx context.Context, plane *clusterPlane, namespace string) {
	m.warmNamespaceEnrichmentResourceKinds(ctx, plane, namespace, []string{
		string(ResourceKindPods),
		string(ResourceKindDeployments),
		string(ResourceKindDaemonSets),
		string(ResourceKindStatefulSets),
		string(ResourceKindReplicaSets),
		string(ResourceKindJobs),
		string(ResourceKindCronJobs),
		string(ResourceKindHPAs),
		string(ResourceKindServices),
		string(ResourceKindIngresses),
		string(ResourceKindPVCs),
		string(ResourceKindConfigMaps),
		string(ResourceKindSecrets),
		string(ResourceKindServiceAccounts),
		string(ResourceKindRoles),
		string(ResourceKindRoleBindings),
		string(ResourceKindHelmReleases),
		string(ResourceKindResourceQuotas),
		string(ResourceKindLimitRanges),
	})
}

func (m *manager) waitAPIQuiet(ctx context.Context, minQuiet time.Duration) error {
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
			last := m.uiActivityUnix.Load()
			if last == 0 {
				return nil
			}
			if time.Since(time.Unix(0, last)) >= minQuiet {
				return nil
			}
		}
	}
}

// NamespaceListEnrichmentPoll returns merged rows for the given cluster/revision.
func (m *manager) NamespaceListEnrichmentPoll(cluster string, revision uint64) NamespaceListEnrichmentPoll {
	out := NamespaceListEnrichmentPoll{
		Revision: revision,
		Active:   cluster,
	}

	m.nsEnrich.mu.Lock()
	sess, ok := m.nsEnrich.byCluster[cluster]
	if !ok || sess.rev != revision {
		latest := uint64(0)
		if ok {
			latest = sess.rev
		}
		m.nsEnrich.mu.Unlock()
		out.Stale = true
		out.LatestRevision = latest
		out.Complete = false
		return out
	}
	m.nsEnrich.mu.Unlock()

	var plane *clusterPlane
	if planeAny, err := m.PlaneForCluster(context.Background(), cluster); err == nil {
		plane, _ = planeAny.(*clusterPlane)
	}

	sess.mu.Lock()
	updates := make([]dto.NamespaceListItemDTO, 0, len(sess.order))
	for _, name := range sess.order {
		row := sess.merged[name]
		if cached, ok := buildCachedNamespaceListRowProjection(plane, name); ok {
			mergeNamespaceRowInto(&row, cached)
			sess.merged[name] = row
		}
		updates = append(updates, row)
	}
	detailDone := sess.detailDone
	relatedDone := sess.relatedDone
	enrichTotal := sess.total
	listTotal := len(sess.order)
	enrichTargets := sess.total
	complete := sess.complete
	var stage string
	if !complete {
		if detailDone < enrichTotal {
			stage = "detail"
		} else {
			stage = "related"
		}
	} else {
		stage = "complete"
	}
	sess.mu.Unlock()

	out.Updates = updates
	out.TotalRows = listTotal
	out.EnrichTargets = enrichTargets
	out.DetailRows = detailDone
	out.RelatedRows = relatedDone
	if complete {
		out.Complete = true
		out.Stage = "complete"
	} else {
		out.Complete = false
		out.Stage = stage
	}
	return out
}
