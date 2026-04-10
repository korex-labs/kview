/**
 * Shared API response and DTO types for type-safe apiGet/apiPost usage.
 * Response wrappers match backend JSON shape (item/items).
 */

/** Single resource response: { item?: T } (backend may add e.g. "active") */
export type ApiItemResponse<T> = { item?: T };

/** List response: { items?: T[] } */
export type ApiListResponse<T> = { items?: T[] };

/**
 * Dataplane-backed list metadata (writeDataplaneListResponse shape; namespaces list uses same meta + top-level observed).
 */
export type DataplaneListMeta = {
  state?: string;
  freshness?: string;
  coverage?: string;
  degradation?: string;
  completeness?: string;
  /** Monotonic string revision for dataplane-backed lists (matches /api/dataplane/revision). */
  revision?: string;
  /** Snapshot time when provided at list root (e.g. namespaces) or folded in from `observed`. */
  observed?: string;
};

/** Typical JSON for namespaced dataplane list APIs */
export type ApiDataplaneListResponse<T> = {
  active?: string;
  items?: T[];
  observed?: string;
  meta?: {
    freshness: string;
    coverage: string;
    degradation: string;
    completeness: string;
    state: string;
  };
};

/** Build a single meta object for UI; returns null when the response carries no dataplane meta. */
export function dataplaneListMetaFromResponse(res: {
  meta?: Partial<DataplaneListMeta>;
  observed?: string;
}): DataplaneListMeta | null {
  const m = res.meta;
  if (!m && !res.observed) return null;
  return {
    state: m?.state,
    freshness: m?.freshness,
    coverage: m?.coverage,
    degradation: m?.degradation,
    completeness: m?.completeness,
    revision: m?.revision != null ? String(m.revision) : undefined,
    observed: res.observed,
  };
}

/** ResourceListPage / useListQuery fetch shape */
export type ResourceListFetchResult<TRow> = {
  rows: TRow[];
  dataplaneMeta?: DataplaneListMeta | null;
};

/** GET /api/namespaces/enrichment?revision= */
export type ApiNamespacesEnrichmentPoll = {
  revision: number;
  stale?: boolean;
  latestRevision?: number;
  complete: boolean;
  stage?: string;
  detailRows: number;
  relatedRows: number;
  totalRows: number;
  /** Count of namespaces selected for progressive enrichment (scored subset). */
  enrichTargets?: number;
  updates: Array<{
    name: string;
    phase: string;
    ageSec: number;
    hasUnhealthyConditions: boolean;
    rowEnriched?: boolean;
    summaryState?: string;
    podCount?: number;
    deploymentCount?: number;
    problematicCount?: number;
    podsWithRestarts?: number;
    restartHotspot?: boolean;
    resourceQuotaCount?: number;
    limitRangeCount?: number;
    quotaWarning?: boolean;
    quotaCritical?: boolean;
    quotaMaxRatio?: number;
  }>;
  active?: string;
};

/** /api/contexts response */
export type ApiContextsResponse = { contexts?: Array<{ name: string }> };

export type ApiDataplaneSearchItem = {
  cluster: string;
  kind: string;
  namespace?: string;
  name: string;
  observedAt?: string;
};

export type ApiDataplaneSearchResponse = {
  active: string;
  query: string;
  limit: number;
  offset: number;
  hasMore: boolean;
  items?: ApiDataplaneSearchItem[];
};

/** /api/namespaces list response (list of namespace objects with name) */
export type ApiNamespacesListResponse = {
  active?: string;
  limited?: boolean;
  observed?: string;
  rowProjection?: {
    enrichedRows: number;
    totalRows: number;
    cap: number;
    note?: string;
    revision?: number;
    loading?: boolean;
    stage?: string;
    detailRows?: number;
    relatedRows?: number;
  };
  meta?: {
    freshness: string;
    coverage: string;
    degradation: string;
    completeness: string;
    state: string;
  };
  items?: Array<{
    name: string;
    phase: string;
    ageSec: number;
    hasUnhealthyConditions: boolean;
    rowEnriched?: boolean;
    summaryState?: string;
    podCount?: number;
    deploymentCount?: number;
    problematicCount?: number;
    podsWithRestarts?: number;
    restartHotspot?: boolean;
    resourceQuotaCount?: number;
    limitRangeCount?: number;
    quotaWarning?: boolean;
    quotaCritical?: boolean;
    quotaMaxRatio?: number;
  }>;
};

/** Pod restart hotspot row (dashboard / namespace summary) */
export type PodRestartHotspotDTO = {
  namespace: string;
  name: string;
  restarts: number;
  restartRatePerDay?: number;
  ageSec?: number;
  phase: string;
  node?: string;
  lastEventReason?: string;
  severity: string;
};

/** /api/dashboard/cluster response (Stage 5C bounded overview) */
export type ApiDashboardClusterResponse = {
  active?: string;
  item?: {
    plane: {
      profile: string;
      discoveryMode: string;
      activationMode: string;
      profilesImplemented: string[];
      discoveryImplemented: string[];
      scope: {
        namespaces: string;
        resourceKinds: string;
      };
    };
    visibility: {
      namespaces: {
        total: number;
        unhealthy: number;
        freshness: string;
        coverage: string;
        degradation: string;
        completeness: string;
        state: string;
        observerState: string;
      };
      nodes: {
        total: number;
        freshness: string;
        coverage: string;
        degradation: string;
        completeness: string;
        state: string;
        observerState: string;
      };
      namespacesObservedAt?: string;
      nodesObservedAt?: string;
      trustNote?: string;
    };
    coverage: {
      visibleNamespaces: number;
      listOnlyNamespaces: number;
      detailEnrichedNamespaces: number;
      relatedEnrichedNamespaces: number;
      awaitingRelatedRowProjection: number;
      enrichmentTargets?: number;
      hasActiveEnrichmentSession?: boolean;
      rowProjectionCachedNamespaces: number;
      resourceTotalsCompleteness: string;
      namespacesInResourceTotals: number;
      resourceTotalsNote?: string;
      note?: string;
    };
    resources: {
      pods: number;
      deployments: number;
      daemonSets: number;
      statefulSets: number;
      replicaSets: number;
      jobs: number;
      cronJobs: number;
      services: number;
      ingresses: number;
      persistentVolumeClaims: number;
      configMaps: number;
      secrets: number;
      serviceAccounts: number;
      roles: number;
      roleBindings: number;
      helmReleases: number;
      resourceQuotas: number;
      limitRanges: number;
      totalNamespaces: number;
      note?: string;
      aggregateFreshness?: string;
      aggregateDegradation?: string;
    };
    hotspots: {
      unhealthyNamespaces: number;
      degradedDeployments: number;
      podsWithElevatedRestarts: number;
      problematicResources: number;
      topProblematicNamespaces?: Array<{ namespace: string; score: number }>;
      topPodRestartHotspots?: PodRestartHotspotDTO[];
      restartHotspotsTotal: number;
      restartHotspotsOffset: number;
      restartHotspotsLimit: number;
      restartHotspotsQuery?: string;
      restartHotspotsHasMore?: boolean;
      note?: string;
      aggregateFreshness?: string;
      aggregateDegradation?: string;
      highSeverityHotspotsInTopN: number;
    };
    findings?: {
      total: number;
      high: number;
      medium: number;
      low: number;
      emptyNamespaces: number;
      stuckHelmReleases: number;
      abnormalJobs: number;
      abnormalCronJobs: number;
      emptyConfigMaps: number;
      emptySecrets: number;
      potentiallyUnusedPVCs: number;
      potentiallyUnusedServiceAccounts: number;
      quotaWarnings: number;
      serviceWarnings: number;
      ingressWarnings: number;
      pvcWarnings: number;
      roleWarnings: number;
      roleBindingWarnings: number;
      top?: Array<{
        kind: string;
        namespace?: string;
        name?: string;
        severity: string;
        score: number;
        reason: string;
        likelyCause?: string;
        suggestedAction?: string;
        confidence?: string;
        section?: string;
      }>;
      items?: Array<{
        kind: string;
        namespace?: string;
        name?: string;
        severity: string;
        score: number;
        reason: string;
        likelyCause?: string;
        suggestedAction?: string;
        confidence?: string;
        section?: string;
      }>;
      itemsTotal: number;
      itemsOffset: number;
      itemsLimit: number;
      itemsFilter?: string;
      itemsQuery?: string;
      itemsHasMore?: boolean;
      note?: string;
      aggregateFreshness?: string;
      aggregateDegradation?: string;
    };
    workloadHints?: {
      totalNamespacesVisible: number;
      namespacesWithWorkloadCache: number;
      topPodRestartHotspots?: PodRestartHotspotDTO[];
      podsWithElevatedRestarts: number;
      highSeverityHotspotsInTopN: number;
      aggregateFreshness?: string;
      aggregateDegradation?: string;
    };
    dataplane: {
      startedAt?: string;
      uptimeSec: number;
      requests: {
        total: number;
        freshHits: number;
        misses: number;
        fetches: number;
        errors: number;
        hitRatio: number;
        fetchRatio: number;
      };
      cache: {
        snapshotsStored: number;
        currentBytes: number;
        avgBytesPerSnapshot: number;
      };
      traffic: {
        liveBytes: number;
        hydratedBytes: number;
        avgBytesPerFetch: number;
        requestsPerMin: number;
        liveBytesPerMin: number;
      };
      execution: {
        runs: number;
        avgRunMs: number;
        maxRunMs: number;
        preemptions: number;
      };
      sources?: Array<{
        source: string;
        requests: number;
        freshHits: number;
        misses: number;
        fetches: number;
        errors: number;
      }>;
      kinds?: Array<{
        kind: string;
        fetches: number;
        currentBytes: number;
        snapshots: number;
        liveBytes: number;
      }>;
    };
  };
};

/** Event shape returned by .../events endpoints; used by EventsList and drawers */
export type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  fieldPath?: string;
  involvedKind?: string;
  involvedName?: string;
};
