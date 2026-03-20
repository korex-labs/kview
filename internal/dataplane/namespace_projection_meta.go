package dataplane

// composeNamespaceSummaryProjectionMeta composes SnapshotMetadata for namespace summary.
// Coverage stays partial and completeness inexact because Helm (and any future non-snapshot
// slices) are not owned by the dataplane yet. Coarse state is computed separately from
// normalized errors + meaningful item counts.
func composeNamespaceSummaryProjectionMeta(metas ...SnapshotMetadata) SnapshotMetadata {
	contract := ProjectionContract{
		Coverage:     CoverageClassPartial,
		Completeness: CompletenessClassInexact,
	}
	return contract.Apply(
		ObservedAtFromSnapshots(metas...),
		WorstFreshnessFromSnapshots(metas...),
		WorstDegradationFromSnapshots(metas...),
	)
}
