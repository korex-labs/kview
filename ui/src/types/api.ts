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
    listSignalSeverity?: string;
    listSignalCount?: number;
    resourceQuotaCount?: number;
    limitRangeCount?: number;
    quotaWarning?: boolean;
    quotaCritical?: boolean;
    quotaMaxRatio?: number;
  }>;
  active?: string;
};

/** /api/contexts response */
export type ApiContextsResponse = {
  active?: string;
  contexts?: Array<{ name: string; cluster?: string; authInfo?: string; namespace?: string }>;
  cacheMigration?: {
    phase?: "idle" | "running" | "done" | "failed";
    fromVersion?: number;
    toVersion?: number;
    applied?: boolean;
    error?: string;
  };
  kubeconfig?: {
    files?: string[];
    explicitlySet?: boolean;
    defaultPath?: string;
  };
};

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
    listSignalSeverity?: string;
    listSignalCount?: number;
    resourceQuotaCount?: number;
    limitRangeCount?: number;
    quotaWarning?: boolean;
    quotaCritical?: boolean;
    quotaMaxRatio?: number;
  }>;
};

export type DashboardSignalItem = {
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
  signalType?: string;
  signalPriority?: number;
  resourceKind?: string;
  resourceName?: string;
  scope?: string;
  scopeLocation?: string;
  actualData?: string;
  calculatedData?: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
};

export type SignalOverride = {
  enabled?: boolean;
  severity?: "low" | "medium" | "high";
  priority?: number;
};

export type DataplaneSignalCatalogItem = {
  type: string;
  label: string;
  summaryCounter?: string;
  actualData?: string;
  calculatedData?: string;
  likelyCause?: string;
  suggestedAction?: string;
  defaultEnabled: boolean;
  defaultSeverity?: string;
  defaultPriority: number;
  globalOverride?: SignalOverride;
  contextOverride?: SignalOverride;
  effectiveEnabled: boolean;
  effectiveSeverity?: string;
  effectivePriority: number;
};

export type ApiDataplaneSignalCatalogResponse = {
  active?: string;
  items?: DataplaneSignalCatalogItem[];
};

export type DashboardSignalFilter = {
  id: string;
  label: string;
  count: number;
  category?: string;
  severity?: string;
};

export type DashboardSignalsPanel = {
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
  podRestartSignals: number;
  serviceWarnings: number;
  ingressWarnings: number;
  pvcWarnings: number;
  roleWarnings: number;
  roleBindingWarnings: number;
  hpaWarnings: number;
  containerNearLimit: number;
  nodeResourcePressure: number;
  filters?: DashboardSignalFilter[];
  top?: DashboardSignalItem[];
  items?: DashboardSignalItem[];
  itemsTotal: number;
  itemsOffset: number;
  itemsLimit: number;
  itemsFilter?: string;
  itemsQuery?: string;
  itemsSort?: string;
  itemsHasMore?: boolean;
  note?: string;
  aggregateFreshness?: string;
  aggregateDegradation?: string;
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
      horizontalPodAutoscalers: number;
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
    signals?: DashboardSignalsPanel;
    derived?: {
      nodes: {
        meta: {
          source: string;
          freshness?: string;
          coverage: string;
          degradation?: string;
          completeness: string;
          observedAt?: string;
          namespacesScope: number;
          note?: string;
        };
        directNodeSnapshotState?: string;
        directNodeSnapshotTotal?: number;
        total: number;
        pods: number;
        elevatedRestartPods: number;
        problematicPods: number;
        nodes?: Array<{
          name: string;
          namespaces?: string[];
          namespaceCount: number;
          pods: number;
          runningPods: number;
          nonRunningPods: number;
          restartCount: number;
          elevatedRestartPods: number;
          problematicPods: number;
          severity: string;
        }>;
      };
      helmCharts: {
        meta: {
          source: string;
          freshness?: string;
          coverage: string;
          degradation?: string;
          completeness: string;
          observedAt?: string;
          namespacesScope: number;
          note?: string;
        };
        charts?: Array<{
          chartName: string;
          releases: number;
          namespaces?: string[];
          namespaceCount: number;
          statuses?: string[];
          needsAttention?: number;
          versions?: Array<{
            chartVersion?: string;
            appVersion?: string;
            releases: number;
            namespaces?: string[];
            statuses?: string[];
            needsAttention?: number;
          }>;
        }>;
        total: number;
        status?: Record<string, number>;
      };
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
    /** Optional cluster-wide resource usage rollup from metrics.k8s.io. */
    usage?: ClusterDashboardUsage;
  };
};

/** Cluster-wide resource usage rollup exposed on /api/dashboard/cluster when metrics.k8s.io is available. */
export type ClusterDashboardUsage = {
  podCpuMilli: number;
  podMemoryBytes: number;
  podsWithMetrics: number;
  namespaces: number;
  nodeCpuMilli?: number;
  nodeMemoryBytes?: number;
  nodesSampled?: number;
  freshness?: string;
  note?: string;
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

// ---------------------------------------------------------------------------
// Helm chart drawer types — /api/dashboard/cluster derived panel + HelmChartDrawer
// ---------------------------------------------------------------------------

export type HelmChartVersion = {
  chartVersion?: string;
  appVersion?: string;
  releases: number;
  namespaces?: string[];
  statuses?: string[];
  needsAttention?: number;
};

export type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces?: string[];
  statuses?: string[];
  needsAttention?: number;
  versions?: HelmChartVersion[];
  derived?: boolean;
  derivedSource?: string;
  derivedCoverage?: string;
  derivedNote?: string;
};

// ---------------------------------------------------------------------------
// Namespace drawer types — GET /api/namespaces/:name and /api/namespaces/:name/insights
// ---------------------------------------------------------------------------

export type NamespaceSummary = {
  name: string;
  phase: string;
  createdAt: number;
  ageSec: number;
};

export type NamespaceMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type NamespaceCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

export type NamespaceDetails = {
  summary: NamespaceSummary;
  metadata: NamespaceMetadata;
  conditions: NamespaceCondition[];
  yaml: string;
};

export type ResourceQuotaEntry = {
  key: string;
  used: string;
  hard: string;
  ratio?: number;
};

export type NamespaceResourceQuota = {
  name: string;
  namespace: string;
  ageSec: number;
  entries: ResourceQuotaEntry[];
};

export type LimitRangeItem = {
  type: string;
  min?: Record<string, string>;
  max?: Record<string, string>;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
};

export type NamespaceLimitRange = {
  name: string;
  namespace: string;
  ageSec: number;
  items: LimitRangeItem[];
};

export type NamespaceResourceSignals = {
  resourceKind: string;
  resourceName: string;
  scope?: string;
  scopeLocation?: string;
  signals?: DashboardSignalItem[];
};

export type WorkloadKindHealthRollup = {
  total: number;
  healthy: number;
  progressing: number;
  degraded: number;
};

export type NamespaceWorkloadHealthRollup = {
  deployments: WorkloadKindHealthRollup;
  daemonSets: WorkloadKindHealthRollup;
  statefulSets: WorkloadKindHealthRollup;
  jobs: WorkloadKindHealthRollup;
  cronJobs: WorkloadKindHealthRollup;
  replicaSets: WorkloadKindHealthRollup;
};

export type NamespaceResourceCounts = {
  pods: number;
  deployments: number;
  statefulSets: number;
  daemonSets: number;
  jobs: number;
  cronJobs: number;
  horizontalPodAutoscalers: number;
  services: number;
  ingresses: number;
  pvcs: number;
  configMaps: number;
  secrets: number;
  serviceAccounts: number;
  roles: number;
  roleBindings: number;
  helmReleases: number;
  resourceQuotas?: number;
  limitRanges?: number;
};

export type NamespacePodHealth = {
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
};

export type NamespaceDeploymentHealth = {
  healthy: number;
  degraded: number;
  progressing: number;
};

export type NamespaceProblematicResource = {
  kind: string;
  name: string;
  reason: string;
};

export type NamespaceHelmRelease = {
  name: string;
  status: string;
  revision: number;
};

export type NamespaceSummaryMeta = {
  freshness: string;
  coverage: string;
  degradation: string;
  completeness: string;
  state: string;
};

export type NamespaceSummaryResources = {
  counts: NamespaceResourceCounts;
  podHealth: NamespacePodHealth;
  deploymentHealth: NamespaceDeploymentHealth;
  problematic: NamespaceProblematicResource[];
  helmReleases?: NamespaceHelmRelease[];
  workloadByKind?: NamespaceWorkloadHealthRollup;
  meta?: NamespaceSummaryMeta;
};

export type NamespaceInsights = {
  summary: NamespaceSummaryResources;
  signals?: DashboardSignalItem[];
  resourceSignals?: NamespaceResourceSignals[];
  resourceQuotas?: NamespaceResourceQuota[];
  limitRanges?: NamespaceLimitRange[];
  /** Per-namespace pod metrics rollup from metrics.k8s.io; omitted when unavailable. */
  resourceUsage?: NamespaceResourceUsage;
};

export type NamespaceResourceUsage = {
  cpuMilli: number;
  memoryBytes: number;
  pods: number;
  observedAt?: number;
};

// ---------------------------------------------------------------------------
// Node drawer types — GET /api/nodes/:name
// ---------------------------------------------------------------------------

export type NodeSummary = {
  name: string;
  status: string;
  roles?: string[];
  kubeletVersion?: string;
  osImage?: string;
  kernelVersion?: string;
  architecture?: string;
  providerID?: string;
  createdAt: number;
  ageSec: number;
};

export type NodeMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type NodeCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

export type NodeCapacity = {
  cpuCapacity?: string;
  cpuAllocatable?: string;
  memoryCapacity?: string;
  memoryAllocatable?: string;
  podsCapacity?: string;
  podsAllocatable?: string;
  // Live usage merged from metrics.k8s.io when available; gated by usageAvailable.
  cpuMilliUsed?: number;
  memoryBytesUsed?: number;
  cpuPctAllocatable?: number;
  memoryPctAllocatable?: number;
  usageAvailable?: boolean;
};

export type NodeTaint = {
  key?: string;
  value?: string;
  effect?: string;
};

export type NodePodsSummary = {
  total: number;
};

export type NodePod = {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  ageSec: number;
};

export type NodeDetails = {
  summary: NodeSummary;
  metadata: NodeMetadata;
  conditions: NodeCondition[];
  capacity: NodeCapacity;
  taints: NodeTaint[];
  pods: NodePod[];
  linkedPods: NodePodsSummary;
  yaml: string;
  derived?: {
    source: string;
    coverage?: string;
    completeness?: string;
    note?: string;
  };
};

// ---------------------------------------------------------------------------
// Metrics-server capability + metric-enriched list fields
// ---------------------------------------------------------------------------

/**
 * MetricsCapability reflects dataplane probe of metrics.k8s.io for the active
 * cluster. `installed` is API discovery; `allowed` is the SelfSubjectAccessReview
 * outcome for listing pod/node metrics. UIs should show usage widgets only
 * when both are true and the policy is enabled.
 */
export type MetricsCapability = {
  installed: boolean;
  allowed: boolean;
  reason?: string;
  lastProbedAt?: string;
};

/**
 * ApiMetricsStatusResponse returned by GET /api/dataplane/metrics/status.
 * `enabled` mirrors DataplanePolicy.Metrics.Enabled; when false the UI
 * must hide metric-specific widgets even if the capability is present.
 */
export type ApiMetricsStatusResponse = {
  active?: string;
  enabled: boolean;
  capability: MetricsCapability;
};

/**
 * PodListItemUsage captures optional usage fields merged into pod list rows
 * when metrics.k8s.io is available. `usageAvailable` is the UI gate; when
 * false, no percent or raw usage values should be rendered.
 */
export type PodListItemUsage = {
  cpuMilli?: number;
  memoryBytes?: number;
  cpuPctRequest?: number;
  cpuPctLimit?: number;
  memoryPctRequest?: number;
  memoryPctLimit?: number;
  usageAvailable?: boolean;
  cpuRequestMilli?: number;
  cpuLimitMilli?: number;
  memoryRequestBytes?: number;
  memoryLimitBytes?: number;
};

/** NodeListItemUsage captures optional usage fields merged into node list rows. */
export type NodeListItemUsage = {
  cpuMilli?: number;
  memoryBytes?: number;
  cpuPctAllocatable?: number;
  memoryPctAllocatable?: number;
  usageAvailable?: boolean;
};

/** ContainerUsage captures per-container usage merged into PodDetails.containers[].usage. */
export type ContainerUsage = {
  cpuMilli: number;
  memoryBytes: number;
  cpuPctRequest?: number;
  cpuPctLimit?: number;
  memoryPctRequest?: number;
  memoryPctLimit?: number;
};

/**
 * Raw PodMetrics row returned by /api/namespaces/{ns}/podmetrics.
 * Useful for deeper drill-downs (per-container usage over time when paired
 * with multiple samples). The pod list endpoint already merges aggregated
 * values for row-level display, so most UI code should prefer that instead.
 */
export type PodMetricsItem = {
  name: string;
  namespace: string;
  windowSec?: number;
  capturedAt?: number;
  containers?: Array<{
    name: string;
    cpuMilli: number;
    memoryBytes: number;
  }>;
};

/** Raw NodeMetrics row returned by /api/nodemetrics. */
export type NodeMetricsItem = {
  name: string;
  windowSec?: number;
  capturedAt?: number;
  cpuMilli: number;
  memoryBytes: number;
};
