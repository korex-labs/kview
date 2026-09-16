import type {
  DashboardClusterItem,
  DataplaneExplanationItem,
  DataplaneExplanationNamespaceSweep,
  DataplaneExplanationObserver,
  DataplaneListMeta,
  ResourceMapResponse,
} from "../../types/api";

export type DataplaneExplanationDetail = {
  label: string;
  value: string;
};

export type DataplaneExplanationSection = {
  /** Stable, surface-owned key used for rendering and accessibility ids. */
  key: string;
  label: string;
  status: string;
  summary: string;
  details: DataplaneExplanationDetail[];
};

export type DataplaneExplanationModel = {
  sections: DataplaneExplanationSection[];
};

/** Authoritative explanation sections supplied by the surface opening the dialog. */
export type DataplaneExplanationSurface = {
  sections: DataplaneExplanationSection[];
};

function words(value: string | undefined, fallback = "Unknown"): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function known(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && normalized !== "unknown" && normalized !== "unavailable");
}

function snapshotSection(meta: DataplaneListMeta): DataplaneExplanationSection {
  const qualityValues = [meta.freshness, meta.coverage, meta.degradation, meta.completeness];
  const qualityKnown = qualityValues.some(known);
  const partial = [meta.coverage, meta.completeness].some((value) => value?.toLowerCase() === "partial");
  const stale = meta.freshness?.toLowerCase() === "stale";
  const degradation = meta.degradation?.trim().toLowerCase();
  const coarseState = meta.state?.trim().toLowerCase();

  const facts: string[] = [];
  if (known(meta.freshness)) facts.push(`${words(meta.freshness)} snapshot`);
  if (known(meta.coverage)) facts.push(`${words(meta.coverage)} scope`);
  if (known(meta.completeness)) facts.push(`${words(meta.completeness)} detail`);
  if (known(meta.degradation) && degradation !== "none") facts.push(`${words(meta.degradation)} degradation`);
  const qualitySummary = facts.length > 0 ? `${facts.join(". ")}.` : "Snapshot quality is unknown.";

  let status: string;
  let summary = qualitySummary;
  switch (coarseState) {
    case "denied":
      status = "Access limited";
      summary = "Cluster permissions denied the authoritative list; available snapshot evidence may be limited.";
      break;
    case "degraded":
      status = "Degraded";
      break;
    case "partial_proxy":
      status = "Partial";
      summary = `This is a partial proxy derived from other snapshot evidence. ${qualitySummary}`;
      break;
    case "empty":
      status = "Empty";
      break;
    case "unknown":
    case "unavailable":
      status = "Unknown";
      break;
    case "ok":
      if (degradation === "minor" || degradation === "severe") status = "Degraded";
      else if (partial) status = "Partial";
      else if (stale) status = "Stale";
      else status = "Ready";
      break;
    default:
      if (!qualityKnown) status = "Unknown";
      else if (degradation === "minor" || degradation === "severe") status = "Degraded";
      else if (partial) status = "Partial";
      else if (stale) status = "Stale";
      else status = "Ready";
  }

  const details: DataplaneExplanationDetail[] = [
    { label: "State", value: words(meta.state) },
    { label: "Freshness", value: words(meta.freshness) },
    { label: "Coverage", value: words(meta.coverage) },
    { label: "Degradation", value: words(meta.degradation) },
    { label: "Completeness", value: words(meta.completeness) },
  ];
  if (meta.observed) details.push({ label: "Observed", value: meta.observed });
  if (meta.revision) details.push({ label: "Revision", value: meta.revision });

  return { key: "snapshot", label: "Snapshot", status, summary, details };
}

/** List-specific adapter kept outside the dialog so other surfaces retain their own vocabulary. */
export function buildDataplaneListExplanationSurface(meta: DataplaneListMeta): DataplaneExplanationSurface {
  return { sections: [snapshotSection(meta)] };
}

function worstSurfaceStatus(statuses: string[]): string {
  const rank: Record<string, number> = {
    Ready: 0,
    Empty: 0,
    Unknown: 1,
    Stale: 2,
    Partial: 3,
    Degraded: 4,
    "Access limited": 5,
  };
  return statuses.reduce((worst, status) => (rank[status] ?? 0) > (rank[worst] ?? 0) ? status : worst, "Ready");
}

/** Dashboard adapter: visibility and aggregate coverage retain dashboard vocabulary. */
export function buildDashboardExplanationSurface(
  item: Pick<DashboardClusterItem, "visibility" | "coverage">,
): DataplaneExplanationSurface {
  const { visibility, coverage } = item;
  const namespaceStatus = snapshotSection(visibility.namespaces).status;
  const nodeStatus = snapshotSection(visibility.nodes).status;
  const visibilityDetails: DataplaneExplanationDetail[] = [
    { label: "Namespaces", value: `${visibility.namespaces.total} total / ${visibility.namespaces.unhealthy} unhealthy` },
    { label: "Namespace scope", value: words(visibility.namespaces.coverage) },
    { label: "Namespace observer", value: words(visibility.namespaces.observerState) },
    { label: "Nodes", value: String(visibility.nodes.total) },
    { label: "Node scope", value: words(visibility.nodes.coverage) },
    { label: "Node observer", value: words(visibility.nodes.observerState) },
  ];
  if (visibility.namespacesObservedAt) visibilityDetails.push({ label: "Namespaces observed", value: visibility.namespacesObservedAt });
  if (visibility.nodesObservedAt) visibilityDetails.push({ label: "Nodes observed", value: visibility.nodesObservedAt });
  if (visibility.trustNote) visibilityDetails.push({ label: "Trust note", value: visibility.trustNote });

  const rowCoveragePartial = coverage.rowProjectionCachedNamespaces < coverage.visibleNamespaces;
  const totalsCompleteness = coverage.resourceTotalsCompleteness.trim().toLowerCase();
  const coverageStatus = totalsCompleteness === "unknown"
    ? "Unknown"
    : totalsCompleteness === "partial" || rowCoveragePartial
      ? "Partial"
      : words(coverage.resourceTotalsCompleteness);
  const coverageDetails: DataplaneExplanationDetail[] = [
    { label: "Visible namespaces", value: String(coverage.visibleNamespaces) },
    { label: "Cached row projections", value: String(coverage.rowProjectionCachedNamespaces) },
    { label: "Without row projection", value: String(coverage.listOnlyNamespaces) },
    { label: "Detail fetches completed", value: String(coverage.detailEnrichedNamespaces) },
    { label: "Cached related projections", value: String(coverage.relatedEnrichedNamespaces) },
    { label: "Awaiting row projection", value: String(coverage.awaitingRelatedRowProjection) },
    { label: "Resource totals completeness", value: words(coverage.resourceTotalsCompleteness) },
  ];
  if (coverage.enrichmentTargets != null) coverageDetails.push({ label: "Current enrichment targets", value: String(coverage.enrichmentTargets) });
  if (coverage.hasActiveEnrichmentSession) coverageDetails.push({ label: "Current enrichment session", value: "Active" });
  if (coverage.persistenceHydrating) coverageDetails.push({ label: "Persistence hydration", value: "In progress" });
  if (coverage.resourceTotalsNote) coverageDetails.push({ label: "Resource totals note", value: coverage.resourceTotalsNote });
  if (coverage.note) coverageDetails.push({ label: "Coverage note", value: coverage.note });

  return { sections: [
    {
      key: "dashboard-visibility",
      label: "Dashboard visibility",
      status: worstSurfaceStatus([namespaceStatus, nodeStatus]),
      summary: `Namespaces: ${namespaceStatus}, ${words(visibility.namespaces.freshness)}, ${words(visibility.namespaces.completeness)}. Nodes: ${nodeStatus}, ${words(visibility.nodes.freshness)}, ${words(visibility.nodes.completeness)}.`,
      details: visibilityDetails,
    },
    {
      key: "dashboard-coverage",
      label: "Dashboard coverage",
      status: coverageStatus,
      summary: `Cached row projections are available for ${coverage.rowProjectionCachedNamespaces} of ${coverage.visibleNamespaces} visible namespaces. Resource totals include ${coverage.namespacesInResourceTotals} of ${coverage.visibleNamespaces} visible namespaces.`,
      details: coverageDetails,
    },
  ] };
}

/** Resource Map adapter: relationship-family evidence stays separate from cache freshness. */
export function buildResourceMapExplanationSurface(response: ResourceMapResponse): DataplaneExplanationSurface {
  const relationshipStatus = response.truncated
    ? "Truncated"
    : response.coverage.coverage === "partial" || response.coverage.completeness === "partial"
      ? "Partial"
      : response.coverage.coverage === "unknown" || response.coverage.completeness === "unknown"
        ? "Unknown"
        : "Complete";
  const relationshipDetails: DataplaneExplanationDetail[] = [
    { label: "Target", value: `${words(response.target.availability)} / ${response.target.resolved ? "Resolved" : "Unresolved"}` },
    { label: "Coverage", value: words(response.coverage.coverage) },
    { label: "Completeness", value: words(response.coverage.completeness) },
  ];
  const aggregateReasons = response.coverage.reasons?.filter(Boolean).join(", ");
  if (aggregateReasons) relationshipDetails.push({ label: "Coverage reasons", value: aggregateReasons });
  if (response.coverage.ambiguousTarget) relationshipDetails.push({ label: "Target resolution", value: "Ambiguous" });
  for (const [family, coverage] of Object.entries(response.coverage.families).sort(([a], [b]) => a.localeCompare(b))) {
    const reasons = coverage.reasons?.filter(Boolean).join(", ");
    relationshipDetails.push({
      label: `${words(family)} family`,
      value: `${words(coverage.coverage)} coverage / ${words(coverage.completeness)} completeness${reasons ? ` · ${reasons}` : ""}`,
    });
  }
  if (response.truncated) {
    relationshipDetails.push({ label: "Truncation", value: response.truncationReasons?.join(", ") || "API limits reached" });
  }
  relationshipDetails.push(
    { label: "Depth limit", value: String(response.limits.depth) },
    { label: "Node / edge limits", value: `${response.limits.maxNodes} / ${response.limits.maxEdges}` },
    { label: "Scan-record limit", value: String(response.limits.maxScanRecords) },
  );

  const cache = response.cache;
  const snapshotWord = cache.snapshotsPresent === 1 ? "snapshot" : "snapshots";
  const missingWord = cache.snapshotsMissing === 1 ? "snapshot" : "snapshots";
  return { sections: [
    {
      key: "resource-map-relationships",
      label: "Relationship projection",
      status: relationshipStatus,
      summary: `${words(response.coverage.coverage)} coverage with ${words(response.coverage.completeness)} relationship evidence${response.truncated ? "; the returned graph is truncated" : ""}.`,
      details: relationshipDetails,
    },
    {
      key: "resource-map-cache",
      label: "Map cache",
      status: words(cache.freshness),
      summary: `${cache.snapshotsPresent} cached ${snapshotWord} present and ${cache.snapshotsMissing} ${missingWord} missing.`,
      details: [
        { label: "Freshness", value: words(cache.freshness) },
        { label: "Observed", value: cache.observedAt || "Unknown" },
        { label: "Oldest observation", value: cache.oldestObservedAt || "Unknown" },
        { label: "Scanned records", value: String(cache.scannedRecords) },
        { label: "Nodes", value: `${cache.returnedNodes} returned / ${cache.totalNodes} projected` },
        { label: "Edges", value: `${cache.returnedEdges} returned / ${cache.totalEdges} projected` },
      ],
    },
  ] };
}

function unavailableSection(key: string, label: string): DataplaneExplanationSection {
  return {
    key,
    label,
    status: "Not loaded",
    summary: "Runtime evidence is not loaded for this context.",
    details: [],
  };
}

function loadingSection(key: string, label: string): DataplaneExplanationSection {
  return {
    key,
    label,
    status: "Loading",
    summary: "Loading runtime evidence for this context.",
    details: [],
  };
}

function surfaceSections(surface: DataplaneExplanationSurface): DataplaneExplanationSection[] {
  return surface.sections.map((section, index) => ({
    ...section,
    key: `surface:${section.key}:${index}`,
  }));
}

function observerRank(observer: DataplaneExplanationObserver): number {
  if (observer.kind === "namespaces") return 0;
  if (observer.kind === "nodes") return 1;
  return 2;
}

function observerSection(item: DataplaneExplanationItem): DataplaneExplanationSection {
  if (item.observers.length === 0) return unavailableSection("runtime:observers", "Observers");
  const observers = [...item.observers].sort((a, b) => observerRank(a) - observerRank(b) || a.kind.localeCompare(b.kind));
  const enabled = observers.filter((observer) => observer.enabled).length;
  const unknown = observers.filter((observer) => observer.enabled && !observer.state).length;
  return {
    key: "runtime:observers",
    label: "Observers",
    status: unknown > 0 ? "Unknown" : enabled > 0 ? "Loaded" : "Disabled",
    summary: unknown > 0
      ? `${unknown} enabled observer${unknown === 1 ? " has" : "s have"} no runtime state.`
      : `${enabled} of ${observers.length} observers enabled.`,
    details: observers.map((observer) => ({
      label: words(observer.kind),
      value: observer.enabled ? words(observer.state) : "Disabled",
    })),
  };
}

function sweepSummary(sweep: DataplaneExplanationNamespaceSweep): string {
  const staleOrUnknown = sweep.cachedStaleNamespaces + sweep.cachedUnknownNamespaces;
  let cacheSummary = `Cached namespace summaries are available for ${sweep.cachedEnrichmentNamespaces} of ${sweep.totalNamespaces} namespaces`;
  if (staleOrUnknown > 0) cacheSummary += ` (${staleOrUnknown} stale or unknown)`;
  cacheSummary += ".";

  if (!sweep.enabled) {
    const disabled = sweep.pausedReason
      ? `Namespace sweep is disabled: ${sweep.pausedReason}.`
      : "Namespace sweep is disabled by policy.";
    return `${cacheSummary} ${disabled}`;
  }

  if (sweep.inFlight) {
    return (sweep.enrichTargets ?? 0) > 0
      ? `${cacheSummary} Current run: ${sweep.relatedDone ?? 0}/${sweep.enrichTargets} targets completed.`
      : cacheSummary;
  }
  return sweep.pausedReason ? `${cacheSummary} ${sweep.pausedReason}.` : cacheSummary;
}

function sweepStatus(sweep: DataplaneExplanationNamespaceSweep): string {
  if (!sweep.enabled) return "Disabled";
  if (sweep.inFlight) return "Running";

  const reason = sweep.pausedReason?.trim().toLowerCase();
  if (reason === "coverage fresh") return "Fresh";
  if (reason === "eligible when idle") return "Available";
  if (reason?.includes("waiting") || reason?.includes("idle wait") || reason === "enrichment already running") {
    return "Waiting";
  }
  if (reason) return "Paused";
  return "Unknown";
}

export function buildDataplaneExplanationModel(
  surface: DataplaneExplanationSurface,
  runtime?: DataplaneExplanationItem,
  options: { loading?: boolean } = {},
): DataplaneExplanationModel {
  const callerSections = surfaceSections(surface);
  if (options.loading) {
    return {
      sections: [
        loadingSection("runtime:profile", "Profile"),
        ...callerSections,
        loadingSection("runtime:observers", "Observers"),
        loadingSection("runtime:scheduler", "Scheduler"),
        loadingSection("runtime:sweep", "Namespace sweep"),
      ],
    };
  }
  if (!runtime?.loaded) {
    return {
      sections: [
        unavailableSection("runtime:profile", "Profile"),
        ...callerSections,
        unavailableSection("runtime:observers", "Observers"),
        unavailableSection("runtime:scheduler", "Scheduler"),
        unavailableSection("runtime:sweep", "Namespace sweep"),
      ],
    };
  }

  const profile: DataplaneExplanationSection = {
    key: "runtime:profile",
    label: "Profile",
    status: runtime.profile ? words(runtime.profile) : "Unknown",
    summary: runtime.profile ? `Runtime policy uses the ${runtime.profile} profile.` : "Runtime profile is unknown.",
    details: [],
  };
  const pressureDetails: DataplaneExplanationDetail[] = runtime.pressure ? [
    { label: "Running", value: `${runtime.pressure.running}/${runtime.pressure.maxSlots}` },
    { label: "Queued", value: String(runtime.pressure.queued) },
    { label: "Low priority queued", value: String(runtime.pressure.lowPriorityQueued) },
    { label: "Longest queue wait", value: `${runtime.pressure.longestQueueWaitMs} ms` },
  ] : [];
  const scheduler: DataplaneExplanationSection = runtime.scheduler ? {
    key: "runtime:scheduler",
    label: "Scheduler",
    status: words(runtime.scheduler.state),
    summary: runtime.scheduler.reason || `Background admission is ${runtime.scheduler.backgroundAdmission || "unknown"}.`,
    details: [
      { label: "Background admission", value: words(runtime.scheduler.backgroundAdmission) },
      { label: "Consecutive failures", value: String(runtime.scheduler.consecutiveFailures) },
      { label: "Recent failures", value: String(runtime.scheduler.recentFailures) },
      { label: "Recent successes", value: String(runtime.scheduler.recentSuccesses) },
      ...pressureDetails,
    ],
  } : runtime.pressure ? {
    key: "runtime:scheduler",
    label: "Scheduler",
    status: "Pressure known",
    summary: `Runtime pressure is ${runtime.pressure.running} running of ${runtime.pressure.maxSlots} slots with ${runtime.pressure.queued} queued. Scheduler health is not loaded.`,
    details: pressureDetails,
  } : unavailableSection("runtime:scheduler", "Scheduler");
  const sweep: DataplaneExplanationSection = runtime.namespaceSweep ? {
    key: "runtime:sweep",
    label: "Namespace sweep",
    status: sweepStatus(runtime.namespaceSweep),
    summary: sweepSummary(runtime.namespaceSweep),
    details: [
      { label: "Cached summaries", value: String(runtime.namespaceSweep.cachedEnrichmentNamespaces) },
      { label: "No cached summary", value: String(runtime.namespaceSweep.noCachedEnrichmentNamespaces) },
      { label: "Hot", value: String(runtime.namespaceSweep.cachedHotNamespaces) },
      { label: "Warm", value: String(runtime.namespaceSweep.cachedWarmNamespaces) },
      { label: "Cold", value: String(runtime.namespaceSweep.cachedColdNamespaces) },
      { label: "Stale", value: String(runtime.namespaceSweep.cachedStaleNamespaces) },
      { label: "Unknown", value: String(runtime.namespaceSweep.cachedUnknownNamespaces) },
      { label: "Swept this runtime", value: String(runtime.namespaceSweep.enrichedNamespaces) },
      { label: "Due for re-sweep", value: String(runtime.namespaceSweep.staleNamespaces) },
      { label: "No runtime sweep record", value: String(runtime.namespaceSweep.neverScannedNamespaces) },
      { label: "System excluded", value: String(runtime.namespaceSweep.systemNamespacesSkipped) },
    ],
  } : unavailableSection("runtime:sweep", "Namespace sweep");

  return { sections: [profile, ...callerSections, observerSection(runtime), scheduler, sweep] };
}
