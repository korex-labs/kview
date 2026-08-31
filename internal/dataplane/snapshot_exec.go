package dataplane

import (
	"context"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type clusterSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients) ([]I, error)
	// extractRelationships collects hidden item metadata after a successful
	// fetch. It may return aliased, unsorted, duplicate records; snapshot
	// execution owns the defensive copy and normalization boundary. Nil
	// preserves legacy behavior.
	extractRelationships      func([]I) []dto.ResourceRelationshipRecord
	extraRelationshipFamilies []dto.ResourceRelationshipFamily
	// skipPersistence opts out of bbolt save/hydrate for snapshot kinds that
	// are high-churn and short-TTL (e.g. metrics.k8s.io). Leaving this false
	// preserves the default persistence path for every existing kind.
	skipPersistence bool
}

type namespacedSnapshotDescriptor[I any] struct {
	kind        ResourceKind
	ttl         time.Duration
	capGroup    string
	capResource string
	capScope    CapabilityScope
	fetch       func(context.Context, *cluster.Clients, string) ([]I, error)
	// extractRelationships has the same raw-output contract as the cluster descriptor.
	extractRelationships      func([]I) []dto.ResourceRelationshipRecord
	extraRelationshipFamilies []dto.ResourceRelationshipFamily
	// skipPersistence opts out of bbolt save/hydrate; see the cluster
	// descriptor for rationale.
	skipPersistence bool
}

func (p *clusterPlane) snapshotMetaUnknown(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassUnknown,
		Coverage:     CoverageClassUnknown,
		Degradation:  DegradationClassSevere,
		Completeness: CompletenessClassUnknown,
	}
}

func (p *clusterPlane) snapshotMetaCold(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassCold,
		Coverage:     CoverageClassUnknown,
		Degradation:  DegradationClassMinor,
		Completeness: CompletenessClassUnknown,
	}
}

func (p *clusterPlane) snapshotMetaHot(now time.Time) SnapshotMetadata {
	return SnapshotMetadata{
		ObservedAt:   now,
		Freshness:    FreshnessClassHot,
		Coverage:     CoverageClassFull,
		Degradation:  DegradationClassNone,
		Completeness: CompletenessClassComplete,
	}
}

func executeClusterSnapshot[I any](
	p *clusterPlane,
	ctx context.Context,
	sched *workScheduler,
	prio WorkPriority,
	clients ClientsProvider,
	store *snapshotStore[Snapshot[I]],
	desc clusterSnapshotDescriptor[I],
) (Snapshot[I], error) {
	source := workSourceOrAPI(ctx)
	ttl := desc.ttl
	if sched != nil {
		ttl = effectiveSnapshotTTL(desc.ttl, source, prio, desc.kind, sched.HealthSnapshot(p.name), sched.ClusterPressureSnapshot(p.name))
	}
	if cached, ok := store.getFresh(ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var staleCached Snapshot[I]
	var haveStaleCached bool
	if desc.skipPersistence {
		staleCached, haveStaleCached = peekClusterSnapshot(store)
	}
	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil && !desc.skipPersistence {
		var loaded Snapshot[I]
		if ok, err := sp.Load(p.name, desc.kind, "", &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      desc.kind,
		Namespace: "",
	}

	var out Snapshot[I]
	executed := false
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		executed = true
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, desc.kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Err = nil
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		items, err := desc.fetch(runCtx, c)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Items = nil
			out.Meta = p.snapshotMetaCold(now)
			p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, "", "list", desc.capScope, err)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		out.Err = nil
		out.Items = items
		if desc.extractRelationships != nil {
			out.Relationships, out.RelationshipMetadata = normalizeSnapshotRelationships(items, desc.extractRelationships, desc.extraRelationshipFamilies)
		}
		out.Meta = p.snapshotMetaHot(now)
		p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, "", "list", desc.capScope, nil)
		if p.stats != nil {
			p.stats.recordFetchResult(source, desc.kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	// A joined caller waits for the scheduler owner but does not execute this
	// call's closure, so its local out value is empty. Never let that follower
	// overwrite an existing snapshot with the zero value.
	if !executed {
		if joined, ok := peekClusterSnapshot(store); ok {
			return joined, runErr
		}
		return out, runErr
	}
	if runErr != nil && len(out.Items) == 0 && haveStaleCached {
		fallback := staleCachedSnapshotFallback(staleCached, out)
		setClusterSnapshot(store, fallback)
		return fallback, runErr
	}
	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setClusterSnapshot(store, fallback)
		return fallback, runErr
	}
	setClusterSnapshot(store, out)
	if runErr == nil && out.Err == nil && !desc.skipPersistence {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, desc.kind, "", out)
		}
	}
	return out, runErr
}

func executeNamespacedSnapshot[I any](
	p *clusterPlane,
	ctx context.Context,
	sched *workScheduler,
	prio WorkPriority,
	clients ClientsProvider,
	namespace string,
	store *namespacedSnapshotStore[Snapshot[I]],
	desc namespacedSnapshotDescriptor[I],
) (Snapshot[I], error) {
	source := workSourceOrAPI(ctx)
	ttl := desc.ttl
	if sched != nil {
		ttl = effectiveSnapshotTTL(desc.ttl, source, prio, desc.kind, sched.HealthSnapshot(p.name), sched.ClusterPressureSnapshot(p.name))
	}
	if cached, ok := store.getFresh(namespace, ttl); ok {
		if p.stats != nil {
			p.stats.recordRequest(source, desc.kind, true)
		}
		return cached, nil
	}
	if p.stats != nil {
		p.stats.recordRequest(source, desc.kind, false)
	}

	var staleCached Snapshot[I]
	var haveStaleCached bool
	if desc.skipPersistence {
		staleCached, haveStaleCached = peekNamespacedSnapshot(store, namespace)
	}
	var persisted Snapshot[I]
	var havePersisted bool
	if sp := p.currentPersistence(); sp != nil && !desc.skipPersistence {
		var loaded Snapshot[I]
		if ok, err := sp.Load(p.name, desc.kind, namespace, &loaded); err == nil && ok && markPersistedSnapshot(&loaded, p.currentPolicy().PersistenceMaxAge()) {
			persisted = loaded
			havePersisted = true
		}
	}

	key := workKey{
		Cluster:   p.name,
		Class:     WorkClassSnapshot,
		Kind:      desc.kind,
		Namespace: namespace,
	}

	var out Snapshot[I]
	executed := false
	runErr := sched.Run(ctx, prio, key, func(runCtx context.Context) error {
		executed = true
		if p.stats != nil {
			p.stats.recordFetchAttempt(source, desc.kind)
		}
		now := time.Now().UTC()
		if clients == nil {
			out.Err = nil
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, nil)
			}
			return nil
		}

		c, _, err := clients.GetClientsForContext(runCtx, p.name)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Meta = p.snapshotMetaUnknown(now)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		items, err := desc.fetch(runCtx, c, namespace)
		if err != nil {
			n := NormalizeError(err)
			out.Err = &n
			out.Items = nil
			out.Meta = p.snapshotMetaCold(now)
			p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, namespace, "list", desc.capScope, err)
			if p.stats != nil {
				p.stats.recordFetchResult(source, desc.kind, 0, err)
			}
			return err
		}

		out.Err = nil
		out.Items = items
		if desc.extractRelationships != nil {
			out.Relationships, out.RelationshipMetadata = normalizeSnapshotRelationships(items, desc.extractRelationships, desc.extraRelationshipFamilies)
		}
		out.Meta = p.snapshotMetaHot(now)
		p.capRegistry.LearnReadResult(p.name, desc.capGroup, desc.capResource, namespace, "list", desc.capScope, nil)
		if p.stats != nil {
			p.stats.recordFetchResult(source, desc.kind, estimateSnapshotPayloadBytes(out), nil)
		}
		return nil
	})

	// A joined caller waits for the scheduler owner but does not execute this
	// call's closure, so its local out value is empty. Preserve the latest
	// namespace snapshot instead of replacing it with an empty cache cell.
	if !executed {
		if joined, ok := peekNamespacedSnapshot(store, namespace); ok {
			return joined, runErr
		}
		return out, runErr
	}
	if runErr != nil && len(out.Items) == 0 && haveStaleCached {
		fallback := staleCachedSnapshotFallback(staleCached, out)
		setNamespacedSnapshot(store, namespace, fallback)
		return fallback, runErr
	}
	if runErr != nil && len(out.Items) == 0 && havePersisted {
		fallback := persistedSnapshotFallback(persisted, out)
		setNamespacedSnapshot(store, namespace, fallback)
		return fallback, runErr
	}
	setNamespacedSnapshot(store, namespace, out)
	if runErr == nil && out.Err == nil && !desc.skipPersistence {
		if sp := p.currentPersistence(); sp != nil {
			_ = sp.Save(p.name, desc.kind, namespace, out)
		}
	}
	return out, runErr
}

func normalizeSnapshotRelationships[I any](
	items []I,
	extract func([]I) []dto.ResourceRelationshipRecord,
	extraFamilies []dto.ResourceRelationshipFamily,
) ([]dto.ResourceRelationshipRecord, *dto.ResourceRelationshipSnapshotMetadata) {
	records := dto.NormalizeResourceRelationshipRecords(extract(items))
	full := dto.ResourceRelationshipCoverageDTO{
		Coverage:     dto.ResourceRelationshipCoverageFull,
		Completeness: dto.ResourceRelationshipCompletenessComplete,
	}
	metadata := &dto.ResourceRelationshipSnapshotMetadata{
		Version: dto.ResourceRelationshipSnapshotMetadataVersion,
		FamilyCoverage: map[dto.ResourceRelationshipFamily]dto.ResourceRelationshipCoverageDTO{
			dto.ResourceRelationshipFamilyOwner: full,
		},
		SourceItems:     len(items),
		EvidenceRecords: len(records),
	}
	declaredFamilies := map[dto.ResourceRelationshipFamily]struct{}{
		dto.ResourceRelationshipFamilyOwner: {},
	}
	for _, family := range extraFamilies {
		declaredFamilies[family] = struct{}{}
		metadata.FamilyCoverage[family] = full
	}
	if len(items) == 0 {
		return records, metadata
	}
	sourceIdentities := make(map[string]struct{}, len(items))
	proofPossible := true
	for i := range items {
		provider, ok := any(items[i]).(dto.ResourceRelationshipMetadataProvider)
		if !ok {
			proofPossible = false
			continue
		}
		identity := provider.ResourceRelationshipMetadata().Resource
		if identity.Validate() != nil {
			proofPossible = false
			continue
		}
		key := identity.CanonicalIdentity()
		if _, duplicate := sourceIdentities[key]; duplicate {
			proofPossible = false
		}
		sourceIdentities[key] = struct{}{}
	}
	for family := range declaredFamilies {
		worst := full
		perResource := make(map[string]dto.ResourceRelationshipCoverageDTO, len(records))
		for _, record := range records {
			if record.Resource.Validate() != nil {
				proofPossible = false
				continue
			}
			key := record.Resource.CanonicalIdentity()
			if _, authoritative := sourceIdentities[key]; !authoritative {
				proofPossible = false
				continue
			}
			coverage, ok := record.FamilyCoverage[family]
			if !ok {
				continue
			}
			if aggregate, exists := perResource[key]; exists {
				coverage.Coverage = worseRelationshipCoverage(aggregate.Coverage, coverage.Coverage)
				coverage.Completeness = worseRelationshipCompleteness(aggregate.Completeness, coverage.Completeness)
			}
			perResource[key] = coverage
		}
		fullyCovered := 0
		fullyComplete := 0
		for key := range sourceIdentities {
			coverage, observed := perResource[key]
			if !observed {
				continue
			}
			worst.Coverage = worseRelationshipCoverage(worst.Coverage, coverage.Coverage)
			worst.Completeness = worseRelationshipCompleteness(worst.Completeness, coverage.Completeness)
			if coverage.Coverage == dto.ResourceRelationshipCoverageFull {
				fullyCovered++
			}
			if coverage.Completeness == dto.ResourceRelationshipCompletenessComplete {
				fullyComplete++
			}
		}
		if !proofPossible || fullyCovered < len(items) {
			worst.Coverage = worseRelationshipCoverage(worst.Coverage, dto.ResourceRelationshipCoveragePartial)
		}
		if !proofPossible || fullyComplete < len(items) {
			worst.Completeness = worseRelationshipCompleteness(worst.Completeness, dto.ResourceRelationshipCompletenessPartial)
		}
		metadata.FamilyCoverage[family] = worst
	}
	return records, metadata
}

func worseRelationshipCoverage(left, right dto.ResourceRelationshipCoverage) dto.ResourceRelationshipCoverage {
	rank := func(value dto.ResourceRelationshipCoverage) (dto.ResourceRelationshipCoverage, int) {
		switch value {
		case dto.ResourceRelationshipCoverageFull:
			return value, 2
		case dto.ResourceRelationshipCoveragePartial:
			return value, 1
		default:
			return dto.ResourceRelationshipCoverageUnknown, 0
		}
	}
	left, leftRank := rank(left)
	right, rightRank := rank(right)
	if rightRank < leftRank {
		return right
	}
	return left
}

func worseRelationshipCompleteness(left, right dto.ResourceRelationshipCompleteness) dto.ResourceRelationshipCompleteness {
	rank := func(value dto.ResourceRelationshipCompleteness) (dto.ResourceRelationshipCompleteness, int) {
		switch value {
		case dto.ResourceRelationshipCompletenessComplete:
			return value, 2
		case dto.ResourceRelationshipCompletenessPartial:
			return value, 1
		default:
			return dto.ResourceRelationshipCompletenessUnknown, 0
		}
	}
	left, leftRank := rank(left)
	right, rightRank := rank(right)
	if rightRank < leftRank {
		return right
	}
	return left
}
