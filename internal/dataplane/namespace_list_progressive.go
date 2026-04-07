package dataplane

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"kview/internal/kube"
	"kview/internal/kube/dto"
	"kview/internal/runtime"
)

// nsEnrichIdleQuiet is how long the API must be "quiet" (no user activity hits) before enrichment runs.
const nsEnrichIdleQuiet = 2 * time.Second

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

	workNames := buildEnrichmentWorkOrder(order, hints)
	if len(workNames) == 0 {
		return 0
	}

	m.nsEnrich.mu.Lock()
	if old, ok := m.nsEnrich.byCluster[cluster]; ok {
		if sameStringSlice(old.order, order) && sameStringSlice(old.workNames, workNames) {
			old.updateBaseRows(order, merged)
			rev := old.rev
			m.nsEnrich.mu.Unlock()
			return rev
		}
		old.cancel()
		delete(m.nsEnrich.byCluster, cluster)
	}
	m.nsEnrich.nextRev++
	rev := m.nsEnrich.nextRev
	ctx, cancel := context.WithCancel(context.Background())
	sess := &nsEnrichSession{
		rev:        rev,
		ctx:        ctx,
		cancel:     cancel,
		order:      order,
		workNames:  workNames,
		merged:     merged,
		total:      len(workNames),
		activityID: namespaceEnrichActivityID(cluster),
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
				"cluster":        cluster,
				"revision":       strconv.FormatUint(rev, 10),
				"enrichTargets":  strconv.Itoa(len(workNames)),
				"stage":          "idle_wait",
				"listNamespaces": strconv.Itoa(len(order)),
			},
		}
		_ = reg.Register(context.Background(), act)
	}

	go m.runNamespaceListEnrichment(ctx, cluster, sess)
	return rev
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

	runErr = m.waitAPIQuiet(ctx, nsEnrichIdleQuiet)
	if runErr != nil {
		sess.mu.Lock()
		sess.complete = true
		sess.mu.Unlock()
		return
	}

	m.patchNsEnrichActivity(sess.activityID, func(a *runtime.Activity) {
		if a.Metadata == nil {
			a.Metadata = map[string]string{}
		}
		a.Metadata["stage"] = "enriching"
	})

	sem := make(chan struct{}, nsEnrichMaxParallel)
	g, gctx := errgroup.WithContext(ctx)

	for _, name := range sess.workNames {
		name := name
		g.Go(func() error {
			select {
			case <-gctx.Done():
				return gctx.Err()
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			c, _, err := m.clients.GetClientsForContext(gctx, cluster)
			if err != nil {
				sess.mu.Lock()
				sess.detailDone++
				sess.relatedDone++
				sess.mu.Unlock()
				return nil
			}

			fields, err := kube.GetNamespaceListFields(gctx, c, name)
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

			workCtx := ContextWithWorkSource(gctx, WorkSourceEnrichment)
			planeAny, perr := m.PlaneForCluster(workCtx, cluster)
			if perr != nil {
				sess.mu.Lock()
				sess.relatedDone++
				sess.mu.Unlock()
				return nil
			}
			plane := planeAny.(*clusterPlane)
			podsSnap, _ := plane.PodsSnapshot(workCtx, m.scheduler, m.clients, name, WorkPriorityLow)
			depsSnap, _ := plane.DeploymentsSnapshot(workCtx, m.scheduler, m.clients, name, WorkPriorityLow)
			metrics := buildNamespaceListRowProjection(podsSnap, depsSnap)

			sess.mu.Lock()
			cur := sess.merged[name]
			mergeNamespaceRowInto(&cur, metrics)
			sess.merged[name] = cur
			sess.relatedDone++
			sess.mu.Unlock()
			return nil
		})
	}

	runErr = g.Wait()
	sess.mu.Lock()
	sess.complete = true
	sess.mu.Unlock()
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

	sess.mu.Lock()
	updates := make([]dto.NamespaceListItemDTO, 0, len(sess.order))
	for _, name := range sess.order {
		updates = append(updates, sess.merged[name])
	}
	detailDone := sess.detailDone
	relatedDone := sess.relatedDone
	enrichTotal := sess.total
	listTotal := len(sess.order)
	enrichTargets := len(sess.workNames)
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
