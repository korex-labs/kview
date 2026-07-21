import { isClusterScopedResource, type ListResourceKey } from "./utils/k8sResources";
import { isSection, type AppStateV1 } from "./state";
import type { InvestigationSnapshot } from "./types/api";

export type SettingsScopeMode = "all" | "cluster" | "namespace";
export type SettingsResourceScopeMode = "any" | "selected";
export type CustomCommandOutputType = "text" | "keyValue" | "csv" | "code" | "file";
export type CustomCommandSafety = "safe" | "dangerous";
export type CustomActionKind = "set" | "unset" | "patch";
export type CustomActionTarget = "env" | "image";
export type CustomActionPatchType = "json" | "merge";
export type DataplaneProfile = "manual" | "focused" | "balanced" | "wide" | "diagnostic";
export type SignalSeverityOverride = "low" | "medium" | "high";
export type SettingsTransferMergeStrategy = "keepMine" | "useImported" | "replaceSections";
export type SettingsTransferSection =
  | "smartFilters"
  | "resourceTags"
  | "resourceMacros"
  | "dynamicLinks"
  | "customCommands"
  | "customActions"
  | "favourites"
  | "savedViews"
  | "signalSettings"
  | "signalAcknowledgements"
  | "signalHistory"
  | "investigationSnapshots";

export type SignalOverride = {
  enabled?: boolean;
  severity?: SignalSeverityOverride;
  priority?: number;
};

export type ResourceTagDefinition = {
  id: string;
  name: string;
  color: string;
};

export type ResourceAutoTagRuleDefinition = {
  id: string;
  enabled: boolean;
  tagIds: string[];
  context: string;
  resources: ListResourceKey[];
  source: "name" | "label" | "annotation";
  key: string;
  pattern: string;
  flags: string;
};

export type ResourceTagsSettings = {
  enabled: boolean;
  inheritNamespaceTags: boolean;
  quickFiltersEnabled: boolean;
  cleanupMissingAssignments: boolean;
  definitions: ResourceTagDefinition[];
  autoTagRules: ResourceAutoTagRuleDefinition[];
  assignments: Record<string, string[]>;
};

export type SavedViewType = "resource" | "dashboard";

export type SavedDashboardViewSnapshot = {
  signalFilter: string;
  signalFilters: string[];
  signalsQuery: string;
  signalsSort: string;
  signalsRowsPerPage: number;
};

export type SavedResourceViewDefinition = {
  id: string;
  name: string;
  viewType?: SavedViewType;
  context: string;
  namespace: string;
  resource: ListResourceKey;
  filter: string;
  sortModel: Array<{ field: string; sort: "asc" | "desc" }>;
  columnVisibilityModel: Record<string, boolean>;
  columnWidths: Record<string, number>;
  dashboardSnapshot?: SavedDashboardViewSnapshot;
  createdAt: number;
  updatedAt: number;
};

export type OperatorProfileSnapshot = {
  appearance: KviewUserSettingsV1["appearance"];
  smartFilters: KviewUserSettingsV1["smartFilters"];
  resourceTags: ResourceTagsSettings;
  resourceMacros: ResourceMacrosSettings;
  dynamicLinks: DynamicLinksSettings;
  savedViews: SavedResourceViewDefinition[];
  customCommands: KviewUserSettingsV1["customCommands"];
  customActions: KviewUserSettingsV1["customActions"];
  keyboard: KeyboardSettings;
  dataplane: DataplaneSettingsV2;
};

export type OperatorProfileDefinition = {
  id: string;
  name: string;
  description: string;
  snapshot: OperatorProfileSnapshot;
  createdAt: number;
  updatedAt: number;
};

export type OperatorProfilesSettings = {
  activeProfileId: string;
  definitions: OperatorProfileDefinition[];
};

export type ResourceMacroScope = "global" | "context" | "namespace" | "node" | "resource";
export type ResourceMacroExtractorSource = "name" | "label" | "annotation";
export type ResourceMacroExtractorTransform = "none" | "uppercase" | "lowercase" | "ucfirst";

export type ResourceMacroScopeRef = {
  scope: ResourceMacroScope;
  context: string;
  namespace: string;
  node: string;
  resource: ListResourceKey | "";
  name: string;
};

export type ResourceMacroDefinition = {
  id: string;
  enabled: boolean;
  macroName: string;
  value: string;
  scope: ResourceMacroScopeRef;
};

export type ResourceMacroExtractorDefinition = {
  id: string;
  enabled: boolean;
  macroName: string;
  resources: ListResourceKey[];
  source: ResourceMacroExtractorSource;
  key: string;
  pattern: string;
  flags: string;
  valueTemplate: string;
  transform: ResourceMacroExtractorTransform;
};

export type ResourceMacrosSettings = {
  enabled: boolean;
  maxResolveDepth: number;
  definitions: ResourceMacroDefinition[];
  extractors: ResourceMacroExtractorDefinition[];
};

export type DynamicLinkDefinition = {
  id: string;
  enabled: boolean;
  label: string;
  urlTemplate: string;
};

export type DynamicLinksSettings = {
  enabled: boolean;
  definitions: DynamicLinkDefinition[];
};

export type KeyboardSettings = {
  vimTableNavigation: boolean;
  homeRowTableNavigation: boolean;
  singleLetterGlobalSearch: boolean;
};

export type SmartFilterRule = {
  id: string;
  enabled: boolean;
  context: string;
  scope: SettingsScopeMode;
  namespace: string;
  resourceScope: SettingsResourceScopeMode;
  resources: ListResourceKey[];
  pattern: string;
  flags: string;
  display: string;
};

export type KviewUserSettingsV1 = {
  v: 1;
  appearance: {
    dashboardRefreshSec: number;
    smartFiltersEnabled: boolean;
    activityPanelInitiallyOpen: boolean;
    releaseChecksEnabled: boolean;
    resourceDrawerWidthPx: number;
    yamlSmartCollapse: boolean;
    smartNamespaceSorting: boolean;
    dashboardCombinedSignalFilters: boolean;
    dashboardFavouriteNamespaceFilters: boolean;
    dashboardRecentNamespaceFilters: boolean;
    recentMenuEnabled: boolean;
    recentMenuLimit: number;
    performanceDiagnosticsEnabled: boolean;
  };
  smartFilters: {
    minCount: number;
    rules: SmartFilterRule[];
  };
  customCommands: {
    commands: CustomCommandDefinition[];
  };
  customActions: {
    actions: CustomActionDefinition[];
  };
  keyboard: KeyboardSettings;
  dataplane: DataplaneSettings;
};

export type DataplaneContextOverrideSettings = {
  profile?: DataplaneProfile;
  snapshots?: Partial<DataplaneSettings["snapshots"]> & {
    ttlSec?: Record<string, number>;
  };
  persistence?: Partial<DataplaneSettings["persistence"]>;
  observers?: Partial<DataplaneSettings["observers"]>;
  namespaceEnrichment?: Partial<DataplaneSettings["namespaceEnrichment"]> & {
    sweep?: Partial<DataplaneSettings["namespaceEnrichment"]["sweep"]>;
  };
  allContextEnrichment?: Partial<DataplaneSettings["allContextEnrichment"]>;
  backgroundBudget?: Partial<DataplaneSettings["backgroundBudget"]>;
  dashboard?: Partial<DataplaneSettings["dashboard"]>;
  metrics?: {
    enabled?: boolean;
    podMetricsTtlSec?: number;
    nodeMetricsTtlSec?: number;
  };
  signals?: Partial<Omit<DataplaneSettings["signals"], "overrides" | "contextOverrides">> & {
    overrides: Record<string, SignalOverride>;
  };
};

export type DataplaneSettingsV2 = {
  global: DataplaneSettings;
  contextOverrides: Record<string, DataplaneContextOverrideSettings>;
};

export type KviewUserSettingsV2 = {
  v: 2;
  appearance: KviewUserSettingsV1["appearance"];
  smartFilters: KviewUserSettingsV1["smartFilters"];
  resourceTags: ResourceTagsSettings;
  resourceMacros: ResourceMacrosSettings;
  dynamicLinks: DynamicLinksSettings;
  savedViews: SavedResourceViewDefinition[];
  operatorProfiles: OperatorProfilesSettings;
  customCommands: KviewUserSettingsV1["customCommands"];
  customActions: KviewUserSettingsV1["customActions"];
  keyboard: KviewUserSettingsV1["keyboard"];
  dataplane: DataplaneSettingsV2;
};

export type SignalAcknowledgementTransferRecord = {
  acknowledgedAt: number;
  acknowledgedBy?: string;
  comment?: string;
  updatedAt: number;
};

export type SignalHistoryTransferRecord = {
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount?: number;
  observedDays: number[];
};

export type SettingsTransferBundleV1 = {
  kind: "kview.settingsTransfer";
  v: 1;
  exportedAt: string;
  sections: Partial<{
    smartFilters: KviewUserSettingsV2["smartFilters"];
    resourceTags: KviewUserSettingsV2["resourceTags"];
    resourceMacros: KviewUserSettingsV2["resourceMacros"];
    dynamicLinks: KviewUserSettingsV2["dynamicLinks"];
    customCommands: KviewUserSettingsV2["customCommands"];
    customActions: KviewUserSettingsV2["customActions"];
    favourites: Pick<AppStateV1, "favouriteNamespacesByContext">;
    savedViews: KviewUserSettingsV2["savedViews"];
    signalSettings: {
      global: DataplaneSettings["signals"];
      contextOverrides: Record<string, NonNullable<DataplaneContextOverrideSettings["signals"]>>;
    };
    signalAcknowledgements: Record<string, Record<string, SignalAcknowledgementTransferRecord>>;
    signalHistory: Record<string, Record<string, SignalHistoryTransferRecord>>;
    investigationSnapshots: InvestigationSnapshot[];
  }>;
};

export type DataplaneSettings = {
  profile: DataplaneProfile;
  snapshots: {
    ttlSec: Record<string, number>;
    manualRefreshBypassesTtl: boolean;
    invalidateAfterKnownMutations: boolean;
  };
  persistence: {
    enabled: boolean;
    maxAgeHours: number;
  };
  observers: {
    enabled: boolean;
    namespacesEnabled: boolean;
    namespacesIntervalSec: number;
    nodesEnabled: boolean;
    nodesIntervalSec: number;
    nodesBackoffMaxSec: number;
  };
  namespaceEnrichment: {
    enabled: boolean;
    includeFocus: boolean;
    includeRecent: boolean;
    recentLimit: number;
    includeFavourites: boolean;
    favouriteLimit: number;
    maxTargets: number;
    maxParallel: number;
    idleQuietMs: number;
    enrichDetails: boolean;
    enrichPods: boolean;
    enrichDeployments: boolean;
    warmResourceKinds: string[];
    pollMs: number;
    sweep: {
      enabled: boolean;
      idleQuietMs: number;
      maxNamespacesPerCycle: number;
      maxNamespacesPerHour: number;
      minReenrichIntervalMinutes: number;
      maxParallel: number;
      pauseOnUserActivity: boolean;
      pauseWhenSchedulerBusy: boolean;
      pauseOnRateLimitOrConnectivityIssues: boolean;
      includeSystemNamespaces: boolean;
    };
  };
  allContextEnrichment: {
    enabled: boolean;
    intervalSec: number;
    maxContextsPerCycle: number;
    idleQuietMs: number;
    pauseOnUserActivity: boolean;
    pauseWhenSchedulerBusy: boolean;
  };
  backgroundBudget: {
    maxConcurrentPerCluster: number;
    maxBackgroundConcurrentPerCluster: number;
    longRunNoticeSec: number;
    transientRetries: number;
  };
  dashboard: {
    refreshSec: number;
    useCachedTotalsOnly: boolean;
    restartElevatedThreshold: number;
    signalLimit: number;
    newestSignalLimit: number;
  };
  /**
   * Metrics integrates real-time pod and node usage from metrics.k8s.io.
   * `enabled` is a soft gate that the backend pairs with capability detection
   * (Installed + Allowed) before any UI widget is shown. TTLs control sample
   * frequency for dataplane usage snapshots.
   */
  metrics: {
    enabled: boolean;
    podMetricsTtlSec: number;
    nodeMetricsTtlSec: number;
    containerNearLimitPct: number;
    nodePressurePct: number;
  };
  signals: {
    longRunningJobSec: number;
    cronJobNoRecentSuccessSec: number;
    staleHelmReleaseSec: number;
    unusedResourceAgeSec: number;
    podYoungRestartWindowSec: number;
    deploymentUnavailableSec: number;
    quotaWarnPercent: number;
    quotaCriticalPercent: number;
    detectors: {
      pod_restarts: {
        restartCount: number;
      };
      container_near_limit: {
        percent: number;
      };
      node_resource_pressure: {
        percent: number;
      };
      resource_quota_pressure: {
        warnPercent: number;
        criticalPercent: number;
      };
    };
    overrides: Record<string, SignalOverride>;
    contextOverrides: Record<string, Record<string, SignalOverride>>;
  };
};

export type SmartFilterMatchContext = {
  contextName: string;
  namespace?: string | null;
  resourceKey?: ListResourceKey | null;
};

export type CustomCommandDefinition = {
  id: string;
  enabled: boolean;
  name: string;
  containerPattern: string;
  workdir: string;
  command: string;
  outputType: CustomCommandOutputType;
  codeLanguage: string;
  fileName: string;
  compress: boolean;
  safety: CustomCommandSafety;
};

export type CustomActionDefinition = {
  id: string;
  enabled: boolean;
  name: string;
  resources: ListResourceKey[];
  action: CustomActionKind;
  target: CustomActionTarget;
  key: string;
  value: string;
  runtimeValue: boolean;
  containerPattern: string;
  patchType: CustomActionPatchType;
  patchBody: string;
  safety: CustomCommandSafety;
};

export const USER_SETTINGS_KEY = "kview:userSettings:v1";

export const refreshIntervalOptions = [
  { label: "Off", value: 0 },
  { label: "3s", value: 3 },
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
];

const allowedRegexFlags = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);
const allowedScopes = new Set<SettingsScopeMode>(["all", "cluster", "namespace"]);
const allowedResourceScopes = new Set<SettingsResourceScopeMode>(["any", "selected"]);
const allowedCommandOutputTypes = new Set<CustomCommandOutputType>(["text", "keyValue", "csv", "code", "file"]);
const allowedCommandSafety = new Set<CustomCommandSafety>(["safe", "dangerous"]);
const allowedActionKinds = new Set<CustomActionKind>(["set", "unset", "patch"]);
const allowedActionTargets = new Set<CustomActionTarget>(["env", "image"]);
const allowedActionPatchTypes = new Set<CustomActionPatchType>(["json", "merge"]);
const allowedDataplaneProfiles = new Set<DataplaneProfile>(["manual", "focused", "balanced", "wide", "diagnostic"]);
const allowedSignalSeverityOverrides = new Set<SignalSeverityOverride>(["low", "medium", "high"]);
const allowedMacroScopes = new Set<ResourceMacroScope>(["global", "context", "namespace", "node", "resource"]);
const allowedMacroExtractorSources = new Set<ResourceMacroExtractorSource>(["name", "label", "annotation"]);
const allowedMacroExtractorTransforms = new Set<ResourceMacroExtractorTransform>(["none", "uppercase", "lowercase", "ucfirst"]);
const resourceTagIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const resourceTagColorPattern = /^#[0-9a-fA-F]{6}$/;
const resourceMacroNamePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const customActionResourceKeys: ListResourceKey[] = ["deployments", "daemonsets", "statefulsets", "replicasets"];
export const dataplaneTTLResourceKeys = [
  "namespaces",
  "nodes",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "horizontalpodautoscalers",
  "services",
  "ingresses",
  "networkpolicies",
  "persistentvolumeclaims",
  "configmaps",
  "secrets",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "helmreleases",
  "resourcequotas",
  "limitranges",
] as const;

export const dataplaneNamespaceWarmResourceKeys = dataplaneTTLResourceKeys.filter(
  (key) => key !== "namespaces" && key !== "nodes",
);

function defaultUserSettingsV1(): KviewUserSettingsV1 {
  return {
    v: 1,
    appearance: {
      dashboardRefreshSec: 10,
      smartFiltersEnabled: true,
      activityPanelInitiallyOpen: true,
      releaseChecksEnabled: false,
      resourceDrawerWidthPx: 820,
      yamlSmartCollapse: true,
      smartNamespaceSorting: false,
      dashboardCombinedSignalFilters: false,
      dashboardFavouriteNamespaceFilters: false,
      dashboardRecentNamespaceFilters: false,
      recentMenuEnabled: false,
      recentMenuLimit: 5,
      performanceDiagnosticsEnabled: false,
    },
    smartFilters: {
      minCount: 3,
      rules: [
        {
          id: "default-environment-prefix",
          enabled: true,
          context: "",
          scope: "all",
          namespace: "",
          resourceScope: "any",
          resources: [],
          pattern: "^(master|release|test|dev).*$",
          flags: "i",
          display: "$1",
        },
        {
          id: "default-ticket-prefix",
          enabled: true,
          context: "",
          scope: "namespace",
          namespace: "",
          resourceScope: "any",
          resources: [],
          pattern: "([a-zA-Z]+-[0-9]+)",
          flags: "",
          display: "$1",
        },
      ],
    },
    customCommands: {
      commands: [
        {
          id: "default-env",
          enabled: true,
          name: "Environment",
          containerPattern: "",
          workdir: "",
          command: "/bin/env",
          outputType: "keyValue",
          codeLanguage: "",
          fileName: "env.txt",
          compress: false,
          safety: "safe",
        },
      ],
    },
    customActions: {
      actions: [
        {
          id: "default-enable-debug-env",
          enabled: true,
          name: "Enable DEBUG",
          resources: ["deployments"],
          action: "set",
          target: "env",
          key: "DEBUG",
          value: "true",
          runtimeValue: false,
          containerPattern: "",
          patchType: "merge",
          patchBody: "{}",
          safety: "safe",
        },
        {
          id: "default-disable-debug-env",
          enabled: true,
          name: "Disable DEBUG",
          resources: ["deployments"],
          action: "unset",
          target: "env",
          key: "DEBUG",
          value: "",
          runtimeValue: false,
          containerPattern: "",
          patchType: "merge",
          patchBody: "{}",
          safety: "safe",
        },
      ],
    },
    keyboard: defaultKeyboardSettings(),
    dataplane: defaultDataplaneSettings(),
  };
}

export function defaultKeyboardSettings(): KeyboardSettings {
  return {
    vimTableNavigation: true,
    homeRowTableNavigation: true,
    singleLetterGlobalSearch: true,
  };
}

export function defaultResourceTagsSettings(): ResourceTagsSettings {
  return {
    enabled: false,
    inheritNamespaceTags: true,
    quickFiltersEnabled: true,
    cleanupMissingAssignments: false,
    definitions: [],
    autoTagRules: [],
    assignments: {},
  };
}

export function defaultResourceMacrosSettings(): ResourceMacrosSettings {
  return {
    enabled: false,
    maxResolveDepth: 10,
    definitions: [],
    extractors: [],
  };
}

export function defaultDynamicLinksSettings(): DynamicLinksSettings {
  return {
    enabled: false,
    definitions: [],
  };
}

export function defaultOperatorProfilesSettings(): OperatorProfilesSettings {
  return {
    activeProfileId: "",
    definitions: [],
  };
}

function dataplaneContextOverridesFromLegacy(
  input: Record<string, Record<string, SignalOverride>> | undefined,
): Record<string, DataplaneContextOverrideSettings> {
  const out: Record<string, DataplaneContextOverrideSettings> = {};
  if (!input || typeof input !== "object") return out;
  for (const [ctx, overrides] of Object.entries(input)) {
    const key = ctx.trim();
    if (!key) continue;
    const normalized = normalizeSignalOverrides(overrides);
    if (Object.keys(normalized).length === 0) continue;
    out[key] = { signals: { overrides: normalized } };
  }
  return out;
}

function toV2Settings(v1: KviewUserSettingsV1): KviewUserSettingsV2 {
  const global = { ...v1.dataplane, signals: { ...v1.dataplane.signals, contextOverrides: {} } };
  return {
    v: 2,
    appearance: v1.appearance,
    smartFilters: v1.smartFilters,
    resourceTags: defaultResourceTagsSettings(),
    resourceMacros: defaultResourceMacrosSettings(),
    dynamicLinks: defaultDynamicLinksSettings(),
    savedViews: [],
    operatorProfiles: defaultOperatorProfilesSettings(),
    customCommands: v1.customCommands,
    customActions: v1.customActions,
    keyboard: v1.keyboard,
    dataplane: {
      global,
      contextOverrides: dataplaneContextOverridesFromLegacy(v1.dataplane.signals.contextOverrides),
    },
  };
}

export function defaultUserSettings(): KviewUserSettingsV2 {
  return toV2Settings(defaultUserSettingsV1());
}

function cloneSettingsValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeOperatorProfileName(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, 64);
}

function newOperatorProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function operatorProfileSnapshotFromSettings(settings: KviewUserSettingsV2): OperatorProfileSnapshot {
  return cloneSettingsValue({
    appearance: settings.appearance,
    smartFilters: settings.smartFilters,
    resourceTags: settings.resourceTags,
    resourceMacros: settings.resourceMacros,
    dynamicLinks: settings.dynamicLinks,
    savedViews: settings.savedViews,
    customCommands: settings.customCommands,
    customActions: settings.customActions,
    keyboard: settings.keyboard,
    dataplane: settings.dataplane,
  });
}

export function addOperatorProfile(
  settings: KviewUserSettingsV2,
  input: { name: string; description?: string; now?: number },
): KviewUserSettingsV2 {
  const name = normalizeOperatorProfileName(input.name);
  if (!name) return settings;
  const now = typeof input.now === "number" && Number.isFinite(input.now) ? Math.floor(input.now) : Date.now();
  const id = newOperatorProfileId();
  const definition: OperatorProfileDefinition = {
    id,
    name,
    description: typeof input.description === "string" ? input.description.trim().slice(0, 280) : "",
    snapshot: operatorProfileSnapshotFromSettings(settings),
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...settings,
    operatorProfiles: {
      activeProfileId: id,
      definitions: [...settings.operatorProfiles.definitions, definition].slice(-25),
    },
  };
}

export function updateOperatorProfileSnapshot(
  settings: KviewUserSettingsV2,
  profileId: string,
  now = Date.now(),
): KviewUserSettingsV2 {
  if (!settings.operatorProfiles.definitions.some((definition) => definition.id === profileId)) return settings;
  const definitions = settings.operatorProfiles.definitions.map((definition) =>
    definition.id === profileId
      ? {
          ...definition,
          snapshot: operatorProfileSnapshotFromSettings(settings),
          updatedAt: Math.floor(now),
        }
      : definition,
  );
  return {
    ...settings,
    operatorProfiles: {
      activeProfileId: profileId,
      definitions,
    },
  };
}

export function applyOperatorProfile(settings: KviewUserSettingsV2, profileId: string): KviewUserSettingsV2 {
  const profile = settings.operatorProfiles.definitions.find((definition) => definition.id === profileId);
  if (!profile) return settings;
  return {
    v: 2,
    ...cloneSettingsValue(profile.snapshot),
    operatorProfiles: {
      ...settings.operatorProfiles,
      activeProfileId: profileId,
    },
  };
}

export function removeOperatorProfile(settings: KviewUserSettingsV2, profileId: string): KviewUserSettingsV2 {
  const definitions = settings.operatorProfiles.definitions.filter((definition) => definition.id !== profileId);
  return {
    ...settings,
    operatorProfiles: {
      activeProfileId: settings.operatorProfiles.activeProfileId === profileId ? "" : settings.operatorProfiles.activeProfileId,
      definitions,
    },
  };
}

export function defaultDataplaneSettings(): DataplaneSettings {
  return {
    profile: "focused",
    snapshots: {
      ttlSec: {
        namespaces: 120,
        nodes: 120,
        pods: 15,
        deployments: 45,
        daemonsets: 45,
        statefulsets: 45,
        replicasets: 30,
        jobs: 30,
        cronjobs: 30,
        horizontalpodautoscalers: 45,
        services: 60,
        ingresses: 60,
        networkpolicies: 180,
        persistentvolumeclaims: 60,
        configmaps: 120,
        secrets: 120,
        serviceaccounts: 180,
        roles: 180,
        rolebindings: 180,
        helmreleases: 120,
        resourcequotas: 180,
        limitranges: 180,
      },
      manualRefreshBypassesTtl: true,
      invalidateAfterKnownMutations: true,
    },
    persistence: {
      enabled: true,
      maxAgeHours: 168,
    },
    observers: {
      enabled: true,
      namespacesEnabled: true,
      namespacesIntervalSec: 120,
      nodesEnabled: true,
      nodesIntervalSec: 180,
      nodesBackoffMaxSec: 300,
    },
    namespaceEnrichment: {
      enabled: true,
      includeFocus: true,
      includeRecent: true,
      recentLimit: 20,
      includeFavourites: true,
      favouriteLimit: 40,
      maxTargets: 32,
      maxParallel: 2,
      idleQuietMs: 2000,
      enrichDetails: true,
      enrichPods: true,
      enrichDeployments: true,
      warmResourceKinds: ["pods", "deployments", "resourcequotas", "limitranges"],
      pollMs: 1500,
      sweep: {
        enabled: false,
        idleQuietMs: 30000,
        maxNamespacesPerCycle: 2,
        maxNamespacesPerHour: 30,
        minReenrichIntervalMinutes: 360,
        maxParallel: 1,
        pauseOnUserActivity: true,
        pauseWhenSchedulerBusy: true,
        pauseOnRateLimitOrConnectivityIssues: true,
        includeSystemNamespaces: false,
      },
    },
    allContextEnrichment: {
      enabled: false,
      intervalSec: 300,
      maxContextsPerCycle: 1,
      idleQuietMs: 30000,
      pauseOnUserActivity: true,
      pauseWhenSchedulerBusy: true,
    },
    backgroundBudget: {
      maxConcurrentPerCluster: 4,
      maxBackgroundConcurrentPerCluster: 2,
      longRunNoticeSec: 2,
      transientRetries: 3,
    },
    dashboard: {
      refreshSec: 10,
      useCachedTotalsOnly: true,
      restartElevatedThreshold: 3,
      signalLimit: 10,
      newestSignalLimit: 10,
    },
    metrics: {
      enabled: true,
      podMetricsTtlSec: 10,
      nodeMetricsTtlSec: 10,
      containerNearLimitPct: 90,
      nodePressurePct: 85,
    },
    signals: {
      longRunningJobSec: 6 * 60 * 60,
      cronJobNoRecentSuccessSec: 24 * 60 * 60,
      staleHelmReleaseSec: 15 * 60,
      unusedResourceAgeSec: 24 * 60 * 60,
      podYoungRestartWindowSec: 30 * 60,
      deploymentUnavailableSec: 10 * 60,
      quotaWarnPercent: 80,
      quotaCriticalPercent: 90,
      detectors: {
        pod_restarts: {
          restartCount: 3,
        },
        container_near_limit: {
          percent: 90,
        },
        node_resource_pressure: {
          percent: 85,
        },
        resource_quota_pressure: {
          warnPercent: 80,
          criticalPercent: 90,
        },
      },
      overrides: {},
      contextOverrides: {},
    },
  };
}

export function dataplaneSettingsForProfile(profile: DataplaneProfile): DataplaneSettings {
  const next: DataplaneSettings = JSON.parse(JSON.stringify(defaultDataplaneSettings()));
  next.profile = profile;
  switch (profile) {
    case "manual":
      next.observers.enabled = false;
      next.namespaceEnrichment.enabled = false;
      next.namespaceEnrichment.sweep.enabled = false;
      break;
    case "balanced":
      next.namespaceEnrichment.maxTargets = 48;
      next.namespaceEnrichment.maxParallel = 2;
      next.namespaceEnrichment.warmResourceKinds = ["pods", "deployments", "services", "ingresses", "resourcequotas", "limitranges"];
      next.namespaceEnrichment.sweep.enabled = true;
      next.namespaceEnrichment.sweep.idleQuietMs = 60000;
      next.namespaceEnrichment.sweep.maxNamespacesPerCycle = 1;
      next.namespaceEnrichment.sweep.maxNamespacesPerHour = 12;
      next.namespaceEnrichment.sweep.minReenrichIntervalMinutes = 720;
      break;
    case "wide":
      next.namespaceEnrichment.maxTargets = 80;
      next.namespaceEnrichment.maxParallel = 3;
      next.namespaceEnrichment.warmResourceKinds = [...dataplaneNamespaceWarmResourceKeys];
      next.namespaceEnrichment.sweep.enabled = true;
      next.namespaceEnrichment.sweep.maxNamespacesPerCycle = 3;
      next.namespaceEnrichment.sweep.maxNamespacesPerHour = 60;
      next.backgroundBudget.maxConcurrentPerCluster = 6;
      next.backgroundBudget.maxBackgroundConcurrentPerCluster = 3;
      next.dashboard.refreshSec = 30;
      break;
    case "diagnostic":
      next.namespaceEnrichment.maxTargets = 120;
      next.namespaceEnrichment.maxParallel = 4;
      next.namespaceEnrichment.idleQuietMs = 1000;
      next.namespaceEnrichment.warmResourceKinds = [...dataplaneNamespaceWarmResourceKeys];
      next.namespaceEnrichment.sweep.enabled = true;
      next.namespaceEnrichment.sweep.idleQuietMs = 10000;
      next.namespaceEnrichment.sweep.maxNamespacesPerCycle = 5;
      next.namespaceEnrichment.sweep.maxNamespacesPerHour = 120;
      next.namespaceEnrichment.sweep.minReenrichIntervalMinutes = 60;
      next.namespaceEnrichment.sweep.includeSystemNamespaces = true;
      next.backgroundBudget.maxConcurrentPerCluster = 8;
      next.backgroundBudget.maxBackgroundConcurrentPerCluster = 4;
      next.backgroundBudget.longRunNoticeSec = 1;
      next.dashboard.refreshSec = 30;
      break;
    case "focused":
    default:
      break;
  }
  return next;
}

export function applyDataplaneProfile(current: DataplaneSettings, profile: DataplaneProfile): DataplaneSettings {
  const next = dataplaneSettingsForProfile(profile);
  return {
    ...next,
    persistence: { ...current.persistence },
    allContextEnrichment: { ...current.allContextEnrichment },
    // Operator-tuned metrics knobs survive profile changes so a switch
    // doesn't unexpectedly re-enable polling or reset the alert thresholds.
    metrics: { ...current.metrics },
    // Keep operator-tuned signal thresholds across profile switches.
    signals: { ...current.signals },
  };
}

export function newSmartFilterRule(): SmartFilterRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    context: "",
    scope: "all",
    namespace: "",
    resourceScope: "any",
    resources: [],
    pattern: "",
    flags: "",
    display: "$1",
  };
}

export function sanitizeRegexFlags(input: string): string {
  const out: string[] = [];
  for (const ch of input.trim()) {
    if (!allowedRegexFlags.has(ch) || out.includes(ch)) continue;
    out.push(ch);
  }
  return out.join("");
}

export function newCustomCommandDefinition(): CustomCommandDefinition {
  return {
    id: `command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    name: "New command",
    containerPattern: "",
    workdir: "",
    command: "",
    outputType: "text",
    codeLanguage: "",
    fileName: "",
    compress: false,
    safety: "safe",
  };
}

export function newCustomActionDefinition(): CustomActionDefinition {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    name: "New action",
    resources: ["deployments", "daemonsets", "statefulsets"],
    action: "set",
    target: "env",
    key: "",
    value: "",
    runtimeValue: false,
    containerPattern: "",
    patchType: "merge",
    patchBody: "{\n  \"spec\": {\n    \"template\": {\n      \"spec\": {}\n    }\n  }\n}",
    safety: "safe",
  };
}

function validRefreshSec(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (!refreshIntervalOptions.some((opt) => opt.value === value)) return fallback;
  return value;
}

function validMinCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 50) return fallback;
  return rounded;
}

function validNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function isListResourceKey(value: unknown): value is ListResourceKey {
  return typeof value === "string" && allListResourceKeys.includes(value as ListResourceKey);
}

export function smartFilterResourceKeysForScope(scope: SettingsScopeMode): ListResourceKey[] {
  if (scope === "all") return [...allListResourceKeys];
  const wantClusterScoped = scope === "cluster";
  return allListResourceKeys.filter((key) => isClusterScopedResource(key) === wantClusterScoped);
}

function normalizeWarmResourceKinds(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const allowed = new Set<string>(dataplaneNamespaceWarmResourceKeys);
  const out = Array.from(new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item))));
  return out.length ? out : [...fallback];
}

function normalizeSignalOverride(input: unknown): SignalOverride | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<SignalOverride>;
  const out: SignalOverride = {};
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (allowedSignalSeverityOverrides.has(raw.severity as SignalSeverityOverride)) {
    out.severity = raw.severity as SignalSeverityOverride;
  }
  if (typeof raw.priority === "number" && Number.isFinite(raw.priority)) {
    out.priority = validNumber(raw.priority, 0, 100, 10);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeSignalOverrides(input: unknown): Record<string, SignalOverride> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, SignalOverride> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    const override = normalizeSignalOverride(rawValue);
    if (override) out[key] = override;
  }
  return out;
}

function normalizeResourceTagId(input: unknown): string {
  if (typeof input !== "string") return "";
  const id = input.trim();
  return resourceTagIdPattern.test(id) ? id : "";
}

function normalizeResourceTagDefinition(input: unknown, fallbackId: string): ResourceTagDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ResourceTagDefinition>;
  const id = normalizeResourceTagId(raw.id) || fallbackId;
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return null;
  const color = typeof raw.color === "string" && resourceTagColorPattern.test(raw.color.trim())
    ? raw.color.trim().toLowerCase()
    : "#607d8b";
  return {
    id,
    name: name.slice(0, 32),
    color,
  };
}

function normalizeResourceAutoTagRule(input: unknown, fallbackId: string, allowedIds: Set<string>): ResourceAutoTagRuleDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ResourceAutoTagRuleDefinition>;
  const id = normalizeResourceTagId(raw.id) || fallbackId;
  const tagIds = Array.isArray(raw.tagIds)
    ? Array.from(new Set(raw.tagIds.filter((value): value is string => typeof value === "string" && allowedIds.has(value))))
    : [];
  if (tagIds.length === 0) return null;
  const source = raw.source === "label" || raw.source === "annotation" ? raw.source : "name";
  const pattern = typeof raw.pattern === "string" ? raw.pattern.trim().slice(0, 256) : "";
  if (!pattern) return null;
  const flags = sanitizeRegexFlags(typeof raw.flags === "string" ? raw.flags : "");
  const resources = Array.isArray(raw.resources)
    ? Array.from(new Set(raw.resources.filter(isListResourceKey)))
    : [];
  return {
    id,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    tagIds,
    context: typeof raw.context === "string" ? raw.context.trim().slice(0, 128) : "",
    resources,
    source,
    key: source === "name" ? "" : typeof raw.key === "string" ? raw.key.trim().slice(0, 256) : "",
    pattern,
    flags,
  };
}

function normalizeResourceTagsSettings(input: unknown): ResourceTagsSettings {
  const defaults = defaultResourceTagsSettings();
  if (!input || typeof input !== "object") return defaults;
  const raw = input as Partial<ResourceTagsSettings>;
  const rawDefinitions = Array.isArray(raw.definitions) ? raw.definitions : [];
  const definitions: ResourceTagDefinition[] = [];
  const seenIds = new Set<string>();
  rawDefinitions.forEach((definition, index) => {
    const normalized = normalizeResourceTagDefinition(definition, `tag-${index + 1}`);
    if (!normalized || seenIds.has(normalized.id)) return;
    seenIds.add(normalized.id);
    definitions.push(normalized);
  });

  const assignments: Record<string, string[]> = {};
  const allowedIds = new Set(definitions.map((definition) => definition.id));
  const rawAssignments = raw.assignments && typeof raw.assignments === "object" && !Array.isArray(raw.assignments)
    ? raw.assignments as Record<string, unknown>
    : {};
  for (const [rawKey, rawTagIds] of Object.entries(rawAssignments)) {
    const key = rawKey.trim();
    if (!key || key.length > 512 || !Array.isArray(rawTagIds)) continue;
    const tagIds = Array.from(new Set(rawTagIds.filter((value): value is string => typeof value === "string" && allowedIds.has(value))));
    if (tagIds.length > 0) assignments[key] = tagIds;
  }
  const autoTagRules: ResourceAutoTagRuleDefinition[] = [];
  const seenRuleIds = new Set<string>();
  const rawAutoTagRules = Array.isArray(raw.autoTagRules) ? raw.autoTagRules : [];
  rawAutoTagRules.forEach((rule, ruleIndex) => {
    const normalized = normalizeResourceAutoTagRule(rule, `auto-tag-${ruleIndex + 1}`, allowedIds);
    if (!normalized || seenRuleIds.has(normalized.id)) return;
    seenRuleIds.add(normalized.id);
    autoTagRules.push(normalized);
  });

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    inheritNamespaceTags:
      typeof raw.inheritNamespaceTags === "boolean" ? raw.inheritNamespaceTags : defaults.inheritNamespaceTags,
    quickFiltersEnabled:
      typeof raw.quickFiltersEnabled === "boolean" ? raw.quickFiltersEnabled : defaults.quickFiltersEnabled,
    cleanupMissingAssignments:
      typeof raw.cleanupMissingAssignments === "boolean"
        ? raw.cleanupMissingAssignments
        : defaults.cleanupMissingAssignments,
    definitions,
    autoTagRules,
    assignments,
  };
}

function normalizeResourceMacroName(input: unknown): string {
  if (typeof input !== "string") return "";
  const name = input.trim().replace(/^\$/, "").toUpperCase();
  return resourceMacroNamePattern.test(name) ? name : "";
}

function normalizeResourceMacroScopeRef(input: unknown): ResourceMacroScopeRef {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<ResourceMacroScopeRef>
    : {};
  const scope = allowedMacroScopes.has(raw.scope as ResourceMacroScope) ? raw.scope as ResourceMacroScope : "global";
  return {
    scope,
    context: typeof raw.context === "string" ? raw.context.trim().slice(0, 128) : "",
    namespace: typeof raw.namespace === "string" ? raw.namespace.trim().slice(0, 128) : "",
    node: typeof raw.node === "string" ? raw.node.trim().slice(0, 128) : "",
    resource: isListResourceKey(raw.resource) ? raw.resource : "",
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 256) : "",
  };
}

function normalizeResourceMacroDefinition(input: unknown, fallbackId: string): ResourceMacroDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ResourceMacroDefinition>;
  const id = normalizeResourceTagId(raw.id) || fallbackId;
  const macroName = normalizeResourceMacroName(raw.macroName);
  const value = typeof raw.value === "string" ? raw.value.trim().slice(0, 2048) : "";
  if (!macroName || !value) return null;
  return {
    id,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    macroName,
    value,
    scope: normalizeResourceMacroScopeRef(raw.scope),
  };
}

function normalizeResourceMacroExtractor(input: unknown, fallbackId: string): ResourceMacroExtractorDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<ResourceMacroExtractorDefinition>;
  const id = normalizeResourceTagId(raw.id) || fallbackId;
  const macroName = normalizeResourceMacroName(raw.macroName);
  const source = allowedMacroExtractorSources.has(raw.source as ResourceMacroExtractorSource)
    ? raw.source as ResourceMacroExtractorSource
    : "name";
  const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
  const flags = sanitizeRegexFlags(typeof raw.flags === "string" ? raw.flags : "");
  const valueTemplate = typeof raw.valueTemplate === "string" && raw.valueTemplate.trim()
    ? raw.valueTemplate.trim().slice(0, 512)
    : "$1";
  const transform = allowedMacroExtractorTransforms.has(raw.transform as ResourceMacroExtractorTransform)
    ? raw.transform as ResourceMacroExtractorTransform
    : "none";
  if (!macroName || !pattern) return null;
  try {
    new RegExp(pattern, flags);
  } catch {
    return null;
  }
  const resources = Array.isArray(raw.resources)
    ? Array.from(new Set(raw.resources.filter(isListResourceKey)))
    : [];
  return {
    id,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    macroName,
    resources,
    source,
    key: typeof raw.key === "string" ? raw.key.trim().slice(0, 256) : "",
    pattern,
    flags,
    valueTemplate,
    transform,
  };
}

function normalizeResourceMacrosSettings(input: unknown): ResourceMacrosSettings {
  const defaults = defaultResourceMacrosSettings();
  if (!input || typeof input !== "object") return defaults;
  const raw = input as Partial<ResourceMacrosSettings>;
  const definitions: ResourceMacroDefinition[] = [];
  const definitionIds = new Set<string>();
  (Array.isArray(raw.definitions) ? raw.definitions : []).forEach((definition, index) => {
    const normalized = normalizeResourceMacroDefinition(definition, `macro-${index + 1}`);
    if (!normalized || definitionIds.has(normalized.id)) return;
    definitionIds.add(normalized.id);
    definitions.push(normalized);
  });
  const extractors: ResourceMacroExtractorDefinition[] = [];
  const extractorIds = new Set<string>();
  (Array.isArray(raw.extractors) ? raw.extractors : []).forEach((extractor, index) => {
    const normalized = normalizeResourceMacroExtractor(extractor, `extractor-${index + 1}`);
    if (!normalized || extractorIds.has(normalized.id)) return;
    extractorIds.add(normalized.id);
    extractors.push(normalized);
  });
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    maxResolveDepth: validNumber(raw.maxResolveDepth, 3, 20, defaults.maxResolveDepth),
    definitions,
    extractors,
  };
}

function normalizeDynamicLinkDefinition(input: unknown, fallbackId: string): DynamicLinkDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<DynamicLinkDefinition>;
  const id = normalizeResourceTagId(raw.id) || fallbackId;
  const label = typeof raw.label === "string" ? raw.label.trim().replace(/\s+/g, " ").slice(0, 64) : "";
  const urlTemplate = typeof raw.urlTemplate === "string" ? raw.urlTemplate.trim().slice(0, 2048) : "";
  if (!label || !urlTemplate) return null;
  return {
    id,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    label,
    urlTemplate,
  };
}

function normalizeDynamicLinksSettings(input: unknown): DynamicLinksSettings {
  const defaults = defaultDynamicLinksSettings();
  if (!input || typeof input !== "object") return defaults;
  const raw = input as Partial<DynamicLinksSettings>;
  const definitions: DynamicLinkDefinition[] = [];
  const seenIds = new Set<string>();
  (Array.isArray(raw.definitions) ? raw.definitions : []).forEach((definition, index) => {
    const normalized = normalizeDynamicLinkDefinition(definition, `link-${index + 1}`);
    if (!normalized || seenIds.has(normalized.id)) return;
    seenIds.add(normalized.id);
    definitions.push(normalized);
  });
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    definitions,
  };
}

function normalizeSavedDashboardViewSnapshot(input: unknown): SavedDashboardViewSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<SavedDashboardViewSnapshot>;
  const signalFilter = typeof raw.signalFilter === "string" && raw.signalFilter.trim() ? raw.signalFilter.trim() : "top";
  const signalFilters = Array.isArray(raw.signalFilters)
    ? Array.from(new Set(raw.signalFilters.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, 12)
    : [];
  const signalsRowsPerPage = validNumber(raw.signalsRowsPerPage, 10, 100, 10);
  return {
    signalFilter,
    signalFilters: signalFilters.length ? signalFilters : [signalFilter],
    signalsQuery: typeof raw.signalsQuery === "string" ? raw.signalsQuery.trim().slice(0, 256) : "",
    signalsSort: typeof raw.signalsSort === "string" && raw.signalsSort.trim() ? raw.signalsSort.trim() : "priority",
    signalsRowsPerPage: [10, 25, 50, 100].includes(signalsRowsPerPage) ? signalsRowsPerPage : 10,
  };
}

function savedViewTimestamps(raw: Partial<SavedResourceViewDefinition>): { createdAt: number; updatedAt: number } {
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0
    ? Math.floor(raw.createdAt)
    : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
    ? Math.floor(raw.updatedAt)
    : createdAt;
  return { createdAt, updatedAt };
}

function normalizeSavedResourceView(input: unknown, fallbackId: string): SavedResourceViewDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<SavedResourceViewDefinition>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const { createdAt, updatedAt } = savedViewTimestamps(raw);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const dashboardSnapshot = normalizeSavedDashboardViewSnapshot(raw.dashboardSnapshot);
  if (raw.viewType === "dashboard" || dashboardSnapshot) {
    if (!dashboardSnapshot) return null;
    return {
      id,
      name,
      viewType: "dashboard",
      context: typeof raw.context === "string" ? raw.context.trim() : "",
      namespace: "",
      resource: isListResourceKey(raw.resource) ? raw.resource : "pods",
      filter: "",
      sortModel: [],
      columnVisibilityModel: {},
      columnWidths: {},
      dashboardSnapshot,
      createdAt,
      updatedAt,
    };
  }
  const context = typeof raw.context === "string" ? raw.context.trim() : "";
  const namespace = typeof raw.namespace === "string" ? raw.namespace.trim() : "";
  const filter = typeof raw.filter === "string" ? raw.filter : "";
  if (!context || !isListResourceKey(raw.resource)) return null;
  return {
    id,
    name,
    context,
    namespace,
    resource: raw.resource,
    filter,
    sortModel: normalizeSavedViewSortModel(raw.sortModel),
    columnVisibilityModel: normalizeSavedViewColumnVisibilityModel(raw.columnVisibilityModel),
    columnWidths: normalizeSavedViewColumnWidths(raw.columnWidths),
    createdAt,
    updatedAt,
  };
}

function normalizeSavedViewSortModel(input: unknown): SavedResourceViewDefinition["sortModel"] {
  if (!Array.isArray(input)) return [];
  const out: SavedResourceViewDefinition["sortModel"] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { field?: unknown; sort?: unknown };
    const field = typeof raw.field === "string" ? raw.field.trim() : "";
    if (!field || (raw.sort !== "asc" && raw.sort !== "desc")) continue;
    out.push({ field, sort: raw.sort });
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeSavedViewColumnVisibilityModel(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, boolean> = {};
  for (const [field, visible] of Object.entries(input)) {
    const key = field.trim();
    if (!key || typeof visible !== "boolean") continue;
    out[key] = visible;
  }
  return out;
}

function normalizeSavedViewColumnWidths(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, number> = {};
  for (const [field, width] of Object.entries(input)) {
    const key = field.trim();
    if (!key || typeof width !== "number" || !Number.isFinite(width)) continue;
    const normalized = Math.round(width);
    if (normalized >= 40 && normalized <= 2000) out[key] = normalized;
  }
  return out;
}

function normalizeSavedResourceViews(input: unknown): SavedResourceViewDefinition[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SavedResourceViewDefinition[] = [];
  input.forEach((item, index) => {
    const normalized = normalizeSavedResourceView(item, `saved-view-${index + 1}`);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    out.push(normalized);
  });
  return out.slice(0, 50);
}

function normalizeOperatorProfileSnapshot(input: unknown): OperatorProfileSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const normalized = validateUserSettings({
    v: 2,
    ...(input as Record<string, unknown>),
    operatorProfiles: defaultOperatorProfilesSettings(),
  });
  return normalized ? operatorProfileSnapshotFromSettings(normalized) : null;
}

function normalizeOperatorProfileDefinition(input: unknown, fallbackId: string): OperatorProfileDefinition | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<OperatorProfileDefinition>;
  const name = typeof raw.name === "string" ? normalizeOperatorProfileName(raw.name) : "";
  const snapshot = normalizeOperatorProfileSnapshot(raw.snapshot);
  if (!name || !snapshot) return null;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0
    ? Math.floor(raw.createdAt)
    : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
    ? Math.floor(raw.updatedAt)
    : createdAt;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 96) : fallbackId,
    name,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 280) : "",
    snapshot,
    createdAt,
    updatedAt,
  };
}

function normalizeOperatorProfilesSettings(input: unknown): OperatorProfilesSettings {
  const defaults = defaultOperatorProfilesSettings();
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaults;
  const raw = input as Partial<OperatorProfilesSettings>;
  const seen = new Set<string>();
  const definitions: OperatorProfileDefinition[] = [];
  (Array.isArray(raw.definitions) ? raw.definitions : []).forEach((definition, index) => {
    const normalized = normalizeOperatorProfileDefinition(definition, `profile-${index + 1}`);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    definitions.push(normalized);
  });
  const activeProfileId = typeof raw.activeProfileId === "string" && seen.has(raw.activeProfileId)
    ? raw.activeProfileId
    : "";
  return {
    activeProfileId,
    definitions: definitions.slice(0, 25),
  };
}

function normalizeContextSignalOverrides(input: unknown): Record<string, Record<string, SignalOverride>> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, Record<string, SignalOverride>> = {};
  for (const [rawContext, rawOverrides] of Object.entries(input as Record<string, unknown>)) {
    const contextName = rawContext.trim();
    if (!contextName) continue;
    const overrides = normalizeSignalOverrides(rawOverrides);
    if (Object.keys(overrides).length > 0) out[contextName] = overrides;
  }
  return out;
}

function normalizeRule(input: unknown, fallbackId: string): SmartFilterRule | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<SmartFilterRule>;
  if (typeof raw.pattern !== "string" || raw.pattern.trim() === "") return null;
  const flags = sanitizeRegexFlags(typeof raw.flags === "string" ? raw.flags : "");
  try {
    new RegExp(raw.pattern, flags);
  } catch {
    return null;
  }

  const scope = allowedScopes.has(raw.scope as SettingsScopeMode) ? (raw.scope as SettingsScopeMode) : "all";
  const resourceScope = allowedResourceScopes.has(raw.resourceScope as SettingsResourceScopeMode)
    ? (raw.resourceScope as SettingsResourceScopeMode)
    : "any";
  const resources = Array.isArray(raw.resources)
    ? Array.from(new Set(raw.resources.filter(isListResourceKey))).filter((key) =>
        smartFilterResourceKeysForScope(scope).includes(key),
      )
    : [];

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    context: typeof raw.context === "string" ? raw.context.trim() : "",
    scope,
    namespace: typeof raw.namespace === "string" ? raw.namespace.trim() : "",
    resourceScope,
    resources,
    pattern: raw.pattern,
    flags,
    display: typeof raw.display === "string" && raw.display.trim() ? raw.display : "$1",
  };
}

function normalizeCustomCommand(input: unknown, fallbackId: string): CustomCommandDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CustomCommandDefinition>;
  const command = typeof raw.command === "string" ? raw.command.trim() : "";
  if (!command) return null;

  const containerPattern = typeof raw.containerPattern === "string" ? raw.containerPattern.trim() : "";
  if (containerPattern) {
    try {
      new RegExp(containerPattern);
    } catch {
      return null;
    }
  }

  const outputType = allowedCommandOutputTypes.has(raw.outputType as CustomCommandOutputType)
    ? (raw.outputType as CustomCommandOutputType)
    : "text";
  const safety = allowedCommandSafety.has(raw.safety as CustomCommandSafety)
    ? (raw.safety as CustomCommandSafety)
    : "safe";

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : command.length > 40
          ? `${command.slice(0, 37)}...`
          : command,
    containerPattern,
    workdir: typeof raw.workdir === "string" ? raw.workdir.trim() : "",
    command,
    outputType,
    codeLanguage: typeof raw.codeLanguage === "string" ? raw.codeLanguage.trim() : "",
    fileName: typeof raw.fileName === "string" ? raw.fileName.trim() : "",
    compress: typeof raw.compress === "boolean" ? raw.compress : false,
    safety,
  };
}

function normalizeCustomAction(input: unknown, fallbackId: string): CustomActionDefinition | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<CustomActionDefinition>;
  const action = allowedActionKinds.has(raw.action as CustomActionKind) ? (raw.action as CustomActionKind) : "set";
  const target = allowedActionTargets.has(raw.target as CustomActionTarget) ? (raw.target as CustomActionTarget) : "env";
  const patchType = allowedActionPatchTypes.has(raw.patchType as CustomActionPatchType)
    ? (raw.patchType as CustomActionPatchType)
    : "merge";
  const safety = allowedCommandSafety.has(raw.safety as CustomCommandSafety)
    ? (raw.safety as CustomCommandSafety)
    : "safe";
  const resources: ListResourceKey[] = Array.isArray(raw.resources)
    ? Array.from(new Set(raw.resources.filter((value): value is ListResourceKey => customActionResourceKeys.includes(value as ListResourceKey))))
    : ["deployments", "daemonsets", "statefulsets"];
  if (resources.length === 0) return null;

  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  const value = typeof raw.value === "string" ? raw.value : "";
  const patchBody = typeof raw.patchBody === "string" ? raw.patchBody.trim() : "";
  if (action === "patch") {
    if (!patchBody) return null;
    try {
      JSON.parse(patchBody);
    } catch {
      return null;
    }
  } else if (target === "env" && !key) {
    return null;
  } else if (action === "set" && !raw.runtimeValue && !value.trim()) {
    return null;
  }

  const containerPattern = typeof raw.containerPattern === "string" ? raw.containerPattern.trim() : "";
  if (containerPattern) {
    try {
      new RegExp(containerPattern);
    } catch {
      return null;
    }
  }

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Custom action",
    resources,
    action,
    target,
    key,
    value,
    runtimeValue: typeof raw.runtimeValue === "boolean" ? raw.runtimeValue : false,
    containerPattern,
    patchType,
    patchBody,
    safety,
  };
}

function normalizeDataplaneSettings(input: unknown): DataplaneSettings {
  const defaults = defaultDataplaneSettings();
  if (!input || typeof input !== "object") return defaults;
  const raw = input as Partial<DataplaneSettings>;
  const rawSnapshots = (raw.snapshots ?? {}) as Partial<DataplaneSettings["snapshots"]>;
  const rawPersistence = (raw.persistence ?? {}) as Partial<DataplaneSettings["persistence"]>;
  const rawObservers = (raw.observers ?? {}) as Partial<DataplaneSettings["observers"]>;
  const rawEnrichment = (raw.namespaceEnrichment ?? {}) as Partial<DataplaneSettings["namespaceEnrichment"]>;
  const rawAllContext = (raw.allContextEnrichment ?? {}) as Partial<DataplaneSettings["allContextEnrichment"]>;
  const rawSweep = (rawEnrichment.sweep ?? {}) as Partial<DataplaneSettings["namespaceEnrichment"]["sweep"]>;
  const rawBudget = (raw.backgroundBudget ?? {}) as Partial<DataplaneSettings["backgroundBudget"]>;
  const rawDashboard = (raw.dashboard ?? {}) as Partial<DataplaneSettings["dashboard"]>;
  const rawMetrics = (raw.metrics ?? {}) as Partial<DataplaneSettings["metrics"]>;
  const rawSignals = (raw.signals ?? {}) as Partial<DataplaneSettings["signals"]>;
  const rawSignalDetectors = ((rawSignals as DataplaneSettings["signals"]).detectors ?? {}) as Partial<
    DataplaneSettings["signals"]["detectors"]
  >;
  const rawTtls = (rawSnapshots.ttlSec ?? {}) as Record<string, unknown>;
  const profile = allowedDataplaneProfiles.has(raw.profile as DataplaneProfile)
    ? (raw.profile as DataplaneProfile)
    : defaults.profile;
  const profileDefaults = dataplaneSettingsForProfile(profile);
  const ttlSec: Record<string, number> = {};
  for (const key of dataplaneTTLResourceKeys) {
    ttlSec[key] = validNumber(rawTtls[key], 5, 3600, defaults.snapshots.ttlSec[key]);
  }

  const maxConcurrent = validNumber(
    rawBudget.maxConcurrentPerCluster,
    1,
    16,
    defaults.backgroundBudget.maxConcurrentPerCluster,
  );

  const normalized: DataplaneSettings = {
    profile,
    snapshots: {
      ttlSec,
      manualRefreshBypassesTtl:
        typeof rawSnapshots.manualRefreshBypassesTtl === "boolean"
          ? rawSnapshots.manualRefreshBypassesTtl
          : defaults.snapshots.manualRefreshBypassesTtl,
      invalidateAfterKnownMutations:
        typeof rawSnapshots.invalidateAfterKnownMutations === "boolean"
          ? rawSnapshots.invalidateAfterKnownMutations
          : defaults.snapshots.invalidateAfterKnownMutations,
    },
    persistence: {
      enabled: typeof rawPersistence.enabled === "boolean" ? rawPersistence.enabled : defaults.persistence.enabled,
      maxAgeHours: validNumber(rawPersistence.maxAgeHours, 1, 720, defaults.persistence.maxAgeHours),
    },
    observers: {
      enabled: typeof rawObservers.enabled === "boolean" ? rawObservers.enabled : defaults.observers.enabled,
      namespacesEnabled:
        typeof rawObservers.namespacesEnabled === "boolean"
          ? rawObservers.namespacesEnabled
          : defaults.observers.namespacesEnabled,
      namespacesIntervalSec: validNumber(
        rawObservers.namespacesIntervalSec,
        10,
        3600,
        defaults.observers.namespacesIntervalSec,
      ),
      nodesEnabled:
        typeof rawObservers.nodesEnabled === "boolean" ? rawObservers.nodesEnabled : defaults.observers.nodesEnabled,
      nodesIntervalSec: validNumber(rawObservers.nodesIntervalSec, 10, 3600, defaults.observers.nodesIntervalSec),
      nodesBackoffMaxSec: validNumber(
        rawObservers.nodesBackoffMaxSec,
        30,
        3600,
        defaults.observers.nodesBackoffMaxSec,
      ),
    },
    namespaceEnrichment: {
      enabled:
        typeof rawEnrichment.enabled === "boolean" ? rawEnrichment.enabled : defaults.namespaceEnrichment.enabled,
      includeFocus:
        typeof rawEnrichment.includeFocus === "boolean"
          ? rawEnrichment.includeFocus
          : defaults.namespaceEnrichment.includeFocus,
      includeRecent:
        typeof rawEnrichment.includeRecent === "boolean"
          ? rawEnrichment.includeRecent
          : defaults.namespaceEnrichment.includeRecent,
      recentLimit: validNumber(rawEnrichment.recentLimit, 0, 200, defaults.namespaceEnrichment.recentLimit),
      includeFavourites:
        typeof rawEnrichment.includeFavourites === "boolean"
          ? rawEnrichment.includeFavourites
          : defaults.namespaceEnrichment.includeFavourites,
      favouriteLimit: validNumber(
        rawEnrichment.favouriteLimit,
        0,
        200,
        defaults.namespaceEnrichment.favouriteLimit,
      ),
      maxTargets: validNumber(rawEnrichment.maxTargets, 0, 250, defaults.namespaceEnrichment.maxTargets),
      maxParallel: validNumber(rawEnrichment.maxParallel, 1, 8, defaults.namespaceEnrichment.maxParallel),
      idleQuietMs: validNumber(rawEnrichment.idleQuietMs, 0, 60000, defaults.namespaceEnrichment.idleQuietMs),
      enrichDetails:
        typeof rawEnrichment.enrichDetails === "boolean"
          ? rawEnrichment.enrichDetails
          : defaults.namespaceEnrichment.enrichDetails,
      enrichPods:
        typeof rawEnrichment.enrichPods === "boolean"
          ? rawEnrichment.enrichPods
          : defaults.namespaceEnrichment.enrichPods,
      enrichDeployments:
        typeof rawEnrichment.enrichDeployments === "boolean"
          ? rawEnrichment.enrichDeployments
          : defaults.namespaceEnrichment.enrichDeployments,
      warmResourceKinds: normalizeWarmResourceKinds(rawEnrichment.warmResourceKinds, profileDefaults.namespaceEnrichment.warmResourceKinds),
      pollMs: validNumber(rawEnrichment.pollMs, 500, 60000, defaults.namespaceEnrichment.pollMs),
      sweep: {
        enabled:
          typeof rawSweep.enabled === "boolean" ? rawSweep.enabled : defaults.namespaceEnrichment.sweep.enabled,
        idleQuietMs: validNumber(rawSweep.idleQuietMs, 5000, 300000, defaults.namespaceEnrichment.sweep.idleQuietMs),
        maxNamespacesPerCycle: validNumber(
          rawSweep.maxNamespacesPerCycle,
          1,
          25,
          defaults.namespaceEnrichment.sweep.maxNamespacesPerCycle,
        ),
        maxNamespacesPerHour: validNumber(
          rawSweep.maxNamespacesPerHour,
          1,
          500,
          defaults.namespaceEnrichment.sweep.maxNamespacesPerHour,
        ),
        minReenrichIntervalMinutes: validNumber(
          rawSweep.minReenrichIntervalMinutes,
          5,
          1440,
          defaults.namespaceEnrichment.sweep.minReenrichIntervalMinutes,
        ),
        maxParallel: validNumber(rawSweep.maxParallel, 1, 4, defaults.namespaceEnrichment.sweep.maxParallel),
        pauseOnUserActivity:
          typeof rawSweep.pauseOnUserActivity === "boolean"
            ? rawSweep.pauseOnUserActivity
            : defaults.namespaceEnrichment.sweep.pauseOnUserActivity,
        pauseWhenSchedulerBusy:
          typeof rawSweep.pauseWhenSchedulerBusy === "boolean"
            ? rawSweep.pauseWhenSchedulerBusy
            : defaults.namespaceEnrichment.sweep.pauseWhenSchedulerBusy,
        pauseOnRateLimitOrConnectivityIssues:
          typeof rawSweep.pauseOnRateLimitOrConnectivityIssues === "boolean"
            ? rawSweep.pauseOnRateLimitOrConnectivityIssues
            : defaults.namespaceEnrichment.sweep.pauseOnRateLimitOrConnectivityIssues,
        includeSystemNamespaces:
          typeof rawSweep.includeSystemNamespaces === "boolean"
            ? rawSweep.includeSystemNamespaces
            : defaults.namespaceEnrichment.sweep.includeSystemNamespaces,
      },
    },
    allContextEnrichment: {
      enabled:
        typeof rawAllContext.enabled === "boolean" ? rawAllContext.enabled : defaults.allContextEnrichment.enabled,
      intervalSec: validNumber(rawAllContext.intervalSec, 60, 3600, defaults.allContextEnrichment.intervalSec),
      maxContextsPerCycle: validNumber(
        rawAllContext.maxContextsPerCycle,
        1,
        25,
        defaults.allContextEnrichment.maxContextsPerCycle,
      ),
      idleQuietMs: validNumber(rawAllContext.idleQuietMs, 5000, 300000, defaults.allContextEnrichment.idleQuietMs),
      pauseOnUserActivity:
        typeof rawAllContext.pauseOnUserActivity === "boolean"
          ? rawAllContext.pauseOnUserActivity
          : defaults.allContextEnrichment.pauseOnUserActivity,
      pauseWhenSchedulerBusy:
        typeof rawAllContext.pauseWhenSchedulerBusy === "boolean"
          ? rawAllContext.pauseWhenSchedulerBusy
          : defaults.allContextEnrichment.pauseWhenSchedulerBusy,
    },
    backgroundBudget: {
      maxConcurrentPerCluster: maxConcurrent,
      maxBackgroundConcurrentPerCluster: validNumber(
        rawBudget.maxBackgroundConcurrentPerCluster,
        1,
        maxConcurrent,
        defaults.backgroundBudget.maxBackgroundConcurrentPerCluster,
      ),
      longRunNoticeSec: validNumber(rawBudget.longRunNoticeSec, 0, 300, defaults.backgroundBudget.longRunNoticeSec),
      transientRetries: validNumber(rawBudget.transientRetries, 1, 6, defaults.backgroundBudget.transientRetries),
    },
    dashboard: {
      refreshSec: validNumber(rawDashboard.refreshSec, 0, 3600, defaults.dashboard.refreshSec),
      useCachedTotalsOnly:
        typeof rawDashboard.useCachedTotalsOnly === "boolean"
          ? rawDashboard.useCachedTotalsOnly
          : defaults.dashboard.useCachedTotalsOnly,
      restartElevatedThreshold: validNumber(
        rawDashboard.restartElevatedThreshold,
        1,
        1000,
        defaults.dashboard.restartElevatedThreshold,
      ),
      signalLimit: validNumber(rawDashboard.signalLimit, 1, 100, defaults.dashboard.signalLimit),
      newestSignalLimit: validNumber(rawDashboard.newestSignalLimit, 1, 100, defaults.dashboard.newestSignalLimit),
    },
    metrics: {
      enabled: typeof rawMetrics.enabled === "boolean" ? rawMetrics.enabled : defaults.metrics.enabled,
      podMetricsTtlSec: validNumber(rawMetrics.podMetricsTtlSec, 5, 600, defaults.metrics.podMetricsTtlSec),
      nodeMetricsTtlSec: validNumber(rawMetrics.nodeMetricsTtlSec, 5, 600, defaults.metrics.nodeMetricsTtlSec),
      containerNearLimitPct: validNumber(rawMetrics.containerNearLimitPct, 50, 100, defaults.metrics.containerNearLimitPct),
      nodePressurePct: validNumber(rawMetrics.nodePressurePct, 50, 100, defaults.metrics.nodePressurePct),
    },
    signals: {
      longRunningJobSec: validNumber(rawSignals.longRunningJobSec, 60, 604800, defaults.signals.longRunningJobSec),
      cronJobNoRecentSuccessSec: validNumber(rawSignals.cronJobNoRecentSuccessSec, 300, 2592000, defaults.signals.cronJobNoRecentSuccessSec),
      staleHelmReleaseSec: validNumber(rawSignals.staleHelmReleaseSec, 60, 86400, defaults.signals.staleHelmReleaseSec),
      unusedResourceAgeSec: validNumber(rawSignals.unusedResourceAgeSec, 300, 2592000, defaults.signals.unusedResourceAgeSec),
      podYoungRestartWindowSec: validNumber(rawSignals.podYoungRestartWindowSec, 60, 86400, defaults.signals.podYoungRestartWindowSec),
      deploymentUnavailableSec: validNumber(rawSignals.deploymentUnavailableSec, 60, 86400, defaults.signals.deploymentUnavailableSec),
      quotaWarnPercent: validNumber(rawSignals.quotaWarnPercent, 1, 99, defaults.signals.quotaWarnPercent),
      quotaCriticalPercent: validNumber(rawSignals.quotaCriticalPercent, 1, 100, defaults.signals.quotaCriticalPercent),
      detectors: {
        pod_restarts: {
          restartCount: validNumber(
            rawSignalDetectors.pod_restarts?.restartCount,
            1,
            1000,
            validNumber(rawDashboard.restartElevatedThreshold, 1, 1000, defaults.signals.detectors.pod_restarts.restartCount),
          ),
        },
        container_near_limit: {
          percent: validNumber(
            rawSignalDetectors.container_near_limit?.percent,
            50,
            100,
            validNumber(rawMetrics.containerNearLimitPct, 50, 100, defaults.signals.detectors.container_near_limit.percent),
          ),
        },
        node_resource_pressure: {
          percent: validNumber(
            rawSignalDetectors.node_resource_pressure?.percent,
            50,
            100,
            validNumber(rawMetrics.nodePressurePct, 50, 100, defaults.signals.detectors.node_resource_pressure.percent),
          ),
        },
        resource_quota_pressure: {
          warnPercent: validNumber(
            rawSignalDetectors.resource_quota_pressure?.warnPercent,
            1,
            99,
            defaults.signals.detectors.resource_quota_pressure.warnPercent,
          ),
          criticalPercent: validNumber(
            rawSignalDetectors.resource_quota_pressure?.criticalPercent,
            1,
            100,
            defaults.signals.detectors.resource_quota_pressure.criticalPercent,
          ),
        },
      },
      overrides: normalizeSignalOverrides(rawSignals.overrides),
      contextOverrides: normalizeContextSignalOverrides(rawSignals.contextOverrides),
    },
  };

  if (
    normalized.signals.detectors.resource_quota_pressure.criticalPercent <=
    normalized.signals.detectors.resource_quota_pressure.warnPercent
  ) {
    normalized.signals.detectors.resource_quota_pressure.warnPercent = defaults.signals.detectors.resource_quota_pressure.warnPercent;
    normalized.signals.detectors.resource_quota_pressure.criticalPercent = defaults.signals.detectors.resource_quota_pressure.criticalPercent;
  }

  // Backward-compatible mirrors for legacy consumers.
  normalized.dashboard.restartElevatedThreshold = normalized.signals.detectors.pod_restarts.restartCount;
  normalized.metrics.containerNearLimitPct = normalized.signals.detectors.container_near_limit.percent;
  normalized.metrics.nodePressurePct = normalized.signals.detectors.node_resource_pressure.percent;
  normalized.signals.quotaWarnPercent = normalized.signals.detectors.resource_quota_pressure.warnPercent;
  normalized.signals.quotaCriticalPercent = normalized.signals.detectors.resource_quota_pressure.criticalPercent;

  if (normalized.signals.quotaCriticalPercent <= normalized.signals.quotaWarnPercent) {
    normalized.signals.quotaWarnPercent = defaults.signals.quotaWarnPercent;
    normalized.signals.quotaCriticalPercent = defaults.signals.quotaCriticalPercent;
  }

  if (normalized.profile === "manual") {
    normalized.observers.enabled = false;
    normalized.namespaceEnrichment.enabled = false;
    normalized.namespaceEnrichment.sweep.enabled = false;
    normalized.allContextEnrichment.enabled = false;
  }

  return normalized;
}

function validateUserSettingsV1(input: unknown): KviewUserSettingsV1 | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<KviewUserSettingsV1>;
  if (raw.v !== 1) return null;

  const defaults = defaultUserSettingsV1();
  const rawAppearance = (raw.appearance ?? {}) as Partial<KviewUserSettingsV1["appearance"]>;
  const rawSmartFilters = (raw.smartFilters ?? {}) as Partial<KviewUserSettingsV1["smartFilters"]>;
  const rawCustomCommands = (raw.customCommands ?? {}) as Partial<KviewUserSettingsV1["customCommands"]>;
  const rawCustomActions = (raw.customActions ?? {}) as Partial<KviewUserSettingsV1["customActions"]>;
  const rawKeyboard = (raw.keyboard ?? {}) as Partial<KeyboardSettings>;
  const rulesProvided = Array.isArray(rawSmartFilters.rules);
  const rawRules: unknown[] = rulesProvided ? (rawSmartFilters.rules as unknown[]) : [];
  const normalizedRules = rawRules
    .map((rule: unknown, index: number) => normalizeRule(rule, `imported-rule-${index + 1}`))
    .filter((rule): rule is SmartFilterRule => Boolean(rule));
  if (rulesProvided && normalizedRules.length !== rawRules.length) return null;
  const commandsProvided = Array.isArray(rawCustomCommands.commands);
  const rawCommands: unknown[] = commandsProvided ? (rawCustomCommands.commands as unknown[]) : [];
  const normalizedCommands = rawCommands
    .map((cmd: unknown, index: number) => normalizeCustomCommand(cmd, `imported-command-${index + 1}`))
    .filter((cmd): cmd is CustomCommandDefinition => Boolean(cmd));
  if (commandsProvided && normalizedCommands.length !== rawCommands.length) return null;
  const actionsProvided = Array.isArray(rawCustomActions.actions);
  const rawActions: unknown[] = actionsProvided ? (rawCustomActions.actions as unknown[]) : [];
  const normalizedActions = rawActions
    .map((action: unknown, index: number) => normalizeCustomAction(action, `imported-action-${index + 1}`))
    .filter((action): action is CustomActionDefinition => Boolean(action));
  if (actionsProvided && normalizedActions.length !== rawActions.length) return null;

  return {
    v: 1,
    appearance: {
      dashboardRefreshSec: validRefreshSec(
        rawAppearance.dashboardRefreshSec,
        defaults.appearance.dashboardRefreshSec,
      ),
      smartFiltersEnabled:
        typeof rawAppearance.smartFiltersEnabled === "boolean"
          ? rawAppearance.smartFiltersEnabled
          : defaults.appearance.smartFiltersEnabled,
      activityPanelInitiallyOpen:
        typeof rawAppearance.activityPanelInitiallyOpen === "boolean"
          ? rawAppearance.activityPanelInitiallyOpen
          : defaults.appearance.activityPanelInitiallyOpen,
      releaseChecksEnabled:
        typeof rawAppearance.releaseChecksEnabled === "boolean"
          ? rawAppearance.releaseChecksEnabled
          : defaults.appearance.releaseChecksEnabled,
      resourceDrawerWidthPx: validNumber(
        rawAppearance.resourceDrawerWidthPx,
        620,
        1400,
        defaults.appearance.resourceDrawerWidthPx,
      ),
      yamlSmartCollapse:
        typeof rawAppearance.yamlSmartCollapse === "boolean"
          ? rawAppearance.yamlSmartCollapse
          : defaults.appearance.yamlSmartCollapse,
      smartNamespaceSorting:
        typeof rawAppearance.smartNamespaceSorting === "boolean"
          ? rawAppearance.smartNamespaceSorting
          : defaults.appearance.smartNamespaceSorting,
      dashboardCombinedSignalFilters:
        typeof rawAppearance.dashboardCombinedSignalFilters === "boolean"
          ? rawAppearance.dashboardCombinedSignalFilters
          : defaults.appearance.dashboardCombinedSignalFilters,
      dashboardFavouriteNamespaceFilters:
        typeof rawAppearance.dashboardFavouriteNamespaceFilters === "boolean"
          ? rawAppearance.dashboardFavouriteNamespaceFilters
          : defaults.appearance.dashboardFavouriteNamespaceFilters,
      dashboardRecentNamespaceFilters:
        typeof rawAppearance.dashboardRecentNamespaceFilters === "boolean"
          ? rawAppearance.dashboardRecentNamespaceFilters
          : defaults.appearance.dashboardRecentNamespaceFilters,
      recentMenuEnabled:
        typeof rawAppearance.recentMenuEnabled === "boolean"
          ? rawAppearance.recentMenuEnabled
          : defaults.appearance.recentMenuEnabled,
      recentMenuLimit: validNumber(
        rawAppearance.recentMenuLimit,
        1,
        20,
        defaults.appearance.recentMenuLimit,
      ),
      performanceDiagnosticsEnabled:
        typeof rawAppearance.performanceDiagnosticsEnabled === "boolean"
          ? rawAppearance.performanceDiagnosticsEnabled
          : defaults.appearance.performanceDiagnosticsEnabled,
    },
    smartFilters: {
      minCount: validMinCount(rawSmartFilters.minCount, defaults.smartFilters.minCount),
      rules: rulesProvided ? normalizedRules : defaults.smartFilters.rules,
    },
    customCommands: {
      commands: commandsProvided ? normalizedCommands : defaults.customCommands.commands,
    },
    customActions: {
      actions: actionsProvided ? normalizedActions : defaults.customActions.actions,
    },
    keyboard: {
      vimTableNavigation:
        typeof rawKeyboard.vimTableNavigation === "boolean"
          ? rawKeyboard.vimTableNavigation
          : defaults.keyboard.vimTableNavigation,
      homeRowTableNavigation:
        typeof rawKeyboard.homeRowTableNavigation === "boolean"
          ? rawKeyboard.homeRowTableNavigation
          : defaults.keyboard.homeRowTableNavigation,
      singleLetterGlobalSearch:
        typeof rawKeyboard.singleLetterGlobalSearch === "boolean"
          ? rawKeyboard.singleLetterGlobalSearch
          : defaults.keyboard.singleLetterGlobalSearch,
    },
    dataplane: normalizeDataplaneSettings(raw.dataplane),
  };
}

function normalizeDataplaneContextOverrides(input: unknown): Record<string, DataplaneContextOverrideSettings> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, DataplaneContextOverrideSettings> = {};
  for (const [rawContext, rawOverride] of Object.entries(input as Record<string, unknown>)) {
    const ctx = rawContext.trim();
    if (!ctx) continue;
    if (!rawOverride || typeof rawOverride !== "object") continue;
    const typed = rawOverride as DataplaneContextOverrideSettings;
    const overrides = normalizeSignalOverrides(typed.signals?.overrides);
    const metricsEnabled = typeof typed.metrics?.enabled === "boolean" ? typed.metrics.enabled : undefined;
    const metricsPodTtl = typeof typed.metrics?.podMetricsTtlSec === "number" ? typed.metrics.podMetricsTtlSec : undefined;
    const metricsNodeTtl = typeof typed.metrics?.nodeMetricsTtlSec === "number" ? typed.metrics.nodeMetricsTtlSec : undefined;
    const next: DataplaneContextOverrideSettings = {};
    if (
      typeof metricsEnabled === "boolean" ||
      typeof metricsPodTtl === "number" ||
      typeof metricsNodeTtl === "number"
    ) {
      next.metrics = {};
      if (typeof metricsEnabled === "boolean") next.metrics.enabled = metricsEnabled;
      if (typeof metricsPodTtl === "number") next.metrics.podMetricsTtlSec = metricsPodTtl;
      if (typeof metricsNodeTtl === "number") next.metrics.nodeMetricsTtlSec = metricsNodeTtl;
    }
    if (typed.profile && allowedDataplaneProfiles.has(typed.profile)) next.profile = typed.profile;
    if (typed.persistence) next.persistence = { ...typed.persistence };
    if (typed.observers) next.observers = { ...typed.observers };
    if (typed.backgroundBudget) next.backgroundBudget = { ...typed.backgroundBudget };
    if (typed.dashboard) next.dashboard = { ...typed.dashboard };
    if (typed.allContextEnrichment) next.allContextEnrichment = { ...typed.allContextEnrichment };
    if (typed.namespaceEnrichment) {
      next.namespaceEnrichment = {
        ...typed.namespaceEnrichment,
        ...(typed.namespaceEnrichment.sweep ? { sweep: { ...typed.namespaceEnrichment.sweep } } : {}),
      };
    }
    if (typed.snapshots) {
      next.snapshots = {
        ...typed.snapshots,
        ...(typed.snapshots.ttlSec ? { ttlSec: { ...typed.snapshots.ttlSec } } : {}),
      };
    }
    if (typed.signals) {
      next.signals = {
        ...typed.signals,
        overrides,
      };
    } else if (Object.keys(overrides).length > 0) {
      next.signals = { overrides };
    }
    if (
      !next.profile &&
      !next.snapshots &&
      !next.persistence &&
      !next.observers &&
      !next.namespaceEnrichment &&
      !next.allContextEnrichment &&
      !next.backgroundBudget &&
      !next.dashboard &&
      !next.metrics &&
      !next.signals
    ) continue;
    out[ctx] = next;
  }
  return out;
}

function mergeDataplaneContextOverride(
  global: DataplaneSettings,
  override: DataplaneContextOverrideSettings | undefined,
): DataplaneSettings {
  if (!override) return global;
  const profileBase = override.profile ? applyDataplaneProfile(global, override.profile) : global;
  const overrideDetectors = override.signals?.detectors;
  const mergedSignals = override.signals
    ? {
      ...profileBase.signals,
      ...override.signals,
      detectors: {
        ...profileBase.signals.detectors,
        ...(overrideDetectors || {}),
        pod_restarts: {
          ...profileBase.signals.detectors.pod_restarts,
          ...(overrideDetectors?.pod_restarts || {}),
        },
        container_near_limit: {
          ...profileBase.signals.detectors.container_near_limit,
          ...(overrideDetectors?.container_near_limit || {}),
        },
        node_resource_pressure: {
          ...profileBase.signals.detectors.node_resource_pressure,
          ...(overrideDetectors?.node_resource_pressure || {}),
        },
        resource_quota_pressure: {
          ...profileBase.signals.detectors.resource_quota_pressure,
          ...(overrideDetectors?.resource_quota_pressure || {}),
        },
      },
      overrides: { ...profileBase.signals.overrides, ...(override.signals.overrides || {}) },
    }
    : profileBase.signals;
  const mergedMetrics = override.metrics
    ? { ...profileBase.metrics, ...override.metrics }
    : profileBase.metrics;
  return {
    ...profileBase,
    ...(override.snapshots
      ? {
        snapshots: {
          ...profileBase.snapshots,
          ...override.snapshots,
          ...(override.snapshots.ttlSec
            ? { ttlSec: { ...profileBase.snapshots.ttlSec, ...override.snapshots.ttlSec } }
            : {}),
        },
      }
      : {}),
    ...(override.persistence ? { persistence: { ...profileBase.persistence, ...override.persistence } } : {}),
    ...(override.observers ? { observers: { ...profileBase.observers, ...override.observers } } : {}),
    ...(override.namespaceEnrichment
      ? {
        namespaceEnrichment: {
          ...profileBase.namespaceEnrichment,
          ...override.namespaceEnrichment,
          ...(override.namespaceEnrichment.sweep
            ? { sweep: { ...profileBase.namespaceEnrichment.sweep, ...override.namespaceEnrichment.sweep } }
            : {}),
        },
      }
      : {}),
    ...(override.allContextEnrichment
      ? { allContextEnrichment: { ...profileBase.allContextEnrichment, ...override.allContextEnrichment } }
      : {}),
    ...(override.backgroundBudget
      ? { backgroundBudget: { ...profileBase.backgroundBudget, ...override.backgroundBudget } }
      : {}),
    ...(override.dashboard ? { dashboard: { ...profileBase.dashboard, ...override.dashboard } } : {}),
    metrics: mergedMetrics,
    signals: mergedSignals,
  };
}

export function dataplaneSettingsForContext(dataplane: DataplaneSettingsV2, contextName: string): DataplaneSettings {
  const contextKey = contextName.trim();
  if (!contextKey) return dataplane.global;
  return mergeDataplaneContextOverride(dataplane.global, dataplane.contextOverrides[contextKey]);
}

export function validateUserSettings(input: unknown): KviewUserSettingsV2 | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { v?: number; dataplane?: unknown };
  if (raw.v === 1) {
    const v1 = validateUserSettingsV1(input);
    return v1 ? toV2Settings(v1) : null;
  }
  if (raw.v !== 2) return null;
  const defaults = defaultUserSettings();
  const root = input as Partial<KviewUserSettingsV2>;
  const fallbackAsV1 = validateUserSettingsV1({
    v: 1,
    appearance: root.appearance,
    smartFilters: root.smartFilters,
    customCommands: root.customCommands,
    customActions: root.customActions,
    keyboard: root.keyboard,
    dataplane: (root.dataplane as { global?: unknown } | undefined)?.global,
  });
  if (!fallbackAsV1) return null;
  const global = fallbackAsV1.dataplane;
  const rawV2Dataplane = (root.dataplane ?? {}) as Partial<DataplaneSettingsV2>;
  return {
    v: 2,
    appearance: fallbackAsV1.appearance,
    smartFilters: fallbackAsV1.smartFilters,
    resourceTags: normalizeResourceTagsSettings(root.resourceTags),
    resourceMacros: normalizeResourceMacrosSettings(root.resourceMacros),
    dynamicLinks: normalizeDynamicLinksSettings(root.dynamicLinks),
    savedViews: normalizeSavedResourceViews(root.savedViews),
    operatorProfiles: normalizeOperatorProfilesSettings(root.operatorProfiles),
    customCommands: fallbackAsV1.customCommands,
    customActions: fallbackAsV1.customActions,
    keyboard: fallbackAsV1.keyboard,
    dataplane: {
      global,
      contextOverrides: normalizeDataplaneContextOverrides(rawV2Dataplane.contextOverrides) || defaults.dataplane.contextOverrides,
    },
  };
}

export function loadUserSettings(): KviewUserSettingsV2 {
  try {
    const raw = window.localStorage.getItem(USER_SETTINGS_KEY);
    if (!raw) return defaultUserSettings();
    const parsed = JSON.parse(raw);
    return validateUserSettings(parsed) ?? defaultUserSettings();
  } catch {
    return defaultUserSettings();
  }
}

export function saveUserSettings(settings: KviewUserSettingsV2) {
  window.localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(serializeUserSettingsV2(settings)));
}

export function parseUserSettingsJSON(text: string): KviewUserSettingsV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Settings JSON is not valid.");
  }
  const settings = validateUserSettings(parsed);
  if (!settings) {
    throw new Error("Settings JSON must be a valid kview user settings v1/v2 profile.");
  }
  return settings;
}
export function exportUserSettingsJSON(settings: KviewUserSettingsV2): string {
  return `${JSON.stringify(serializeUserSettingsV2(settings), null, 2)}
`;
}

export type FullProfileBackupV1 = {
  kind: "kview.fullProfile";
  version: 1;
  exportedAt: string;
  settings: KviewUserSettingsV2;
  appState: AppStateV1;
};

export function exportFullProfileJSON(input: { settings: KviewUserSettingsV2; appState: AppStateV1 }): string {
  const backup: FullProfileBackupV1 = {
    kind: "kview.fullProfile",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: serializeUserSettingsV2(input.settings),
    appState: normalizeFullProfileAppState(input.appState),
  };
  return `${JSON.stringify(backup, null, 2)}
`;
}

export function parseFullProfileJSON(text: string): { settings: KviewUserSettingsV2; appState: AppStateV1 } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed as { kind?: unknown; settings?: unknown; appState?: unknown };
  if (root.kind !== "kview.fullProfile") return null;
  const settings = validateUserSettings(root.settings);
  if (!settings) throw new Error("Full profile backup does not contain valid user settings.");
  return { settings, appState: normalizeFullProfileAppState(root.appState) };
}

function normalizeFullProfileAppState(input: unknown): AppStateV1 {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Partial<AppStateV1> : {};
  const out: AppStateV1 = {
    v: 1,
    favouriteNamespacesByContext: normalizeStringArrayRecord(raw.favouriteNamespacesByContext),
    recentNamespacesByContext: normalizeStringArrayRecord(raw.recentNamespacesByContext),
  };
  if (typeof raw.activeContext === "string" && raw.activeContext.trim()) out.activeContext = raw.activeContext.trim();
  if (typeof raw.activeNamespace === "string" && raw.activeNamespace.trim()) out.activeNamespace = raw.activeNamespace.trim();
  if (isSection(raw.activeSection)) out.activeSection = raw.activeSection;
  if (Array.isArray(raw.recentSections)) out.recentSections = raw.recentSections.filter(isSection);
  if (raw.sidebarCollapsedGroups && typeof raw.sidebarCollapsedGroups === "object" && !Array.isArray(raw.sidebarCollapsedGroups)) {
    const collapsed: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw.sidebarCollapsedGroups)) {
      if (typeof value === "boolean") collapsed[key] = value;
    }
    out.sidebarCollapsedGroups = collapsed;
  }
  if (typeof raw.activityPanelOpen === "boolean") out.activityPanelOpen = raw.activityPanelOpen;
  if (typeof raw.activityPanelHeightPx === "number" && Number.isFinite(raw.activityPanelHeightPx)) out.activityPanelHeightPx = raw.activityPanelHeightPx;
  return out;
}

export const settingsTransferSections: Array<{ id: SettingsTransferSection; label: string }> = [
  { id: "resourceTags", label: "Resource tags" },
  { id: "resourceMacros", label: "Resource macros" },
  { id: "dynamicLinks", label: "Dynamic links" },
  { id: "favourites", label: "Favourite namespaces" },
  { id: "savedViews", label: "Saved views" },
  { id: "smartFilters", label: "Smart filters" },
  { id: "customCommands", label: "Custom commands" },
  { id: "customActions", label: "Custom actions" },
  { id: "signalSettings", label: "Signal settings" },
  { id: "signalAcknowledgements", label: "Signal acknowledgements" },
  { id: "signalHistory", label: "Signal memory" },
  { id: "investigationSnapshots", label: "Investigation snapshots" },
];

export const settingsTransferMergeStrategies: Array<{ id: SettingsTransferMergeStrategy; label: string }> = [
  { id: "keepMine", label: "Keep mine on conflict" },
  { id: "useImported", label: "Use imported on conflict" },
  { id: "replaceSections", label: "Replace selected sections" },
];

export function exportSettingsTransferJSON(input: {
  settings: KviewUserSettingsV2;
  appState: AppStateV1;
  sections: SettingsTransferSection[];
  signalAcknowledgements?: Record<string, Record<string, SignalAcknowledgementTransferRecord>>;
  signalHistory?: Record<string, Record<string, SignalHistoryTransferRecord>>;
  investigationSnapshots?: InvestigationSnapshot[];
}): string {
  const selected = new Set(input.sections);
  const serialized = serializeUserSettingsV2(input.settings);
  const bundle: SettingsTransferBundleV1 = {
    kind: "kview.settingsTransfer",
    v: 1,
    exportedAt: new Date().toISOString(),
    sections: {},
  };
  if (selected.has("smartFilters")) bundle.sections.smartFilters = serialized.smartFilters;
  if (selected.has("resourceTags")) bundle.sections.resourceTags = serialized.resourceTags;
  if (selected.has("resourceMacros")) bundle.sections.resourceMacros = serialized.resourceMacros;
  if (selected.has("dynamicLinks")) bundle.sections.dynamicLinks = serialized.dynamicLinks;
  if (selected.has("customCommands")) bundle.sections.customCommands = serialized.customCommands;
  if (selected.has("customActions")) bundle.sections.customActions = serialized.customActions;
  if (selected.has("savedViews")) bundle.sections.savedViews = serialized.savedViews;
  if (selected.has("favourites")) {
    bundle.sections.favourites = {
      favouriteNamespacesByContext: normalizeStringArrayRecord(input.appState.favouriteNamespacesByContext),
    };
  }
  if (selected.has("signalSettings")) {
    const contextOverrides: Record<string, NonNullable<DataplaneContextOverrideSettings["signals"]>> = {};
    for (const [contextName, override] of Object.entries(serialized.dataplane.contextOverrides)) {
      if (override.signals) contextOverrides[contextName] = override.signals;
    }
    bundle.sections.signalSettings = {
      global: serialized.dataplane.global.signals,
      contextOverrides,
    };
  }
  if (selected.has("signalAcknowledgements")) {
    bundle.sections.signalAcknowledgements = normalizeSignalAcknowledgementTransfer(input.signalAcknowledgements);
  }
  if (selected.has("signalHistory")) {
    bundle.sections.signalHistory = normalizeSignalHistoryTransfer(input.signalHistory);
  }
  if (selected.has("investigationSnapshots")) {
    bundle.sections.investigationSnapshots = normalizeInvestigationSnapshotTransfer(input.investigationSnapshots);
  }
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseSettingsTransferJSON(text: string): SettingsTransferBundleV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Transfer JSON is not valid.");
  }
  const bundle = validateSettingsTransferBundle(parsed);
  if (!bundle) {
    throw new Error("Transfer JSON must be a valid kview settings transfer bundle.");
  }
  return bundle;
}

export function validateSettingsTransferBundle(input: unknown): SettingsTransferBundleV1 | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<SettingsTransferBundleV1>;
  if (raw.kind !== "kview.settingsTransfer" || raw.v !== 1 || !raw.sections || typeof raw.sections !== "object") {
    return null;
  }
  const defaults = defaultUserSettings();
  const sections = raw.sections as Record<string, unknown>;
  const out: SettingsTransferBundleV1 = {
    kind: "kview.settingsTransfer",
    v: 1,
    exportedAt: typeof raw.exportedAt === "string" && raw.exportedAt.trim() ? raw.exportedAt : new Date(0).toISOString(),
    sections: {},
  };
  if ("smartFilters" in sections) {
    out.sections.smartFilters = validateUserSettings({ ...defaults, smartFilters: sections.smartFilters })?.smartFilters;
  }
  if ("resourceTags" in sections) {
    out.sections.resourceTags = validateUserSettings({ ...defaults, resourceTags: sections.resourceTags })?.resourceTags;
  }
  if ("resourceMacros" in sections) {
    out.sections.resourceMacros = validateUserSettings({ ...defaults, resourceMacros: sections.resourceMacros })?.resourceMacros;
  }
  if ("dynamicLinks" in sections) {
    out.sections.dynamicLinks = validateUserSettings({ ...defaults, dynamicLinks: sections.dynamicLinks })?.dynamicLinks;
  }
  if ("customCommands" in sections) {
    out.sections.customCommands = validateUserSettings({ ...defaults, customCommands: sections.customCommands })?.customCommands;
  }
  if ("customActions" in sections) {
    out.sections.customActions = validateUserSettings({ ...defaults, customActions: sections.customActions })?.customActions;
  }
  if ("savedViews" in sections) {
    out.sections.savedViews = validateUserSettings({ ...defaults, savedViews: sections.savedViews })?.savedViews;
  }
  if ("favourites" in sections) {
    out.sections.favourites = {
      favouriteNamespacesByContext: normalizeStringArrayRecord(
        (sections.favourites as { favouriteNamespacesByContext?: unknown } | undefined)?.favouriteNamespacesByContext,
      ),
    };
  }
  if ("signalSettings" in sections) {
    out.sections.signalSettings = normalizeSignalSettingsTransfer(sections.signalSettings);
  }
  if ("signalAcknowledgements" in sections) {
    out.sections.signalAcknowledgements = normalizeSignalAcknowledgementTransfer(sections.signalAcknowledgements);
  }
  if ("signalHistory" in sections) {
    out.sections.signalHistory = normalizeSignalHistoryTransfer(sections.signalHistory);
  }
  if ("investigationSnapshots" in sections) {
    out.sections.investigationSnapshots = normalizeInvestigationSnapshotTransfer(sections.investigationSnapshots);
  }
  if (Object.keys(out.sections).length === 0) return null;
  return out;
}

export function settingsTransferSectionIds(bundle: SettingsTransferBundleV1): SettingsTransferSection[] {
  return settingsTransferSections
    .map((section) => section.id)
    .filter((section) => Object.prototype.hasOwnProperty.call(bundle.sections, section));
}

export function applySettingsTransferBundle(input: {
  settings: KviewUserSettingsV2;
  appState: AppStateV1;
  bundle: SettingsTransferBundleV1;
  sections: SettingsTransferSection[];
  strategy: SettingsTransferMergeStrategy;
}): { settings: KviewUserSettingsV2; appState: AppStateV1 } {
  const selected = new Set(input.sections);
  let nextSettings = input.settings;
  let nextAppState = input.appState;
  if (selected.has("smartFilters") && input.bundle.sections.smartFilters) {
    nextSettings = mergeSettingsSection(nextSettings, "smartFilters", input.bundle.sections.smartFilters, input.strategy);
  }
  if (selected.has("resourceTags") && input.bundle.sections.resourceTags) {
    nextSettings = mergeSettingsSection(nextSettings, "resourceTags", input.bundle.sections.resourceTags, input.strategy);
  }
  if (selected.has("resourceMacros") && input.bundle.sections.resourceMacros) {
    nextSettings = mergeSettingsSection(nextSettings, "resourceMacros", input.bundle.sections.resourceMacros, input.strategy);
  }
  if (selected.has("dynamicLinks") && input.bundle.sections.dynamicLinks) {
    nextSettings = mergeSettingsSection(nextSettings, "dynamicLinks", input.bundle.sections.dynamicLinks, input.strategy);
  }
  if (selected.has("customCommands") && input.bundle.sections.customCommands) {
    nextSettings = mergeSettingsSection(nextSettings, "customCommands", input.bundle.sections.customCommands, input.strategy);
  }
  if (selected.has("customActions") && input.bundle.sections.customActions) {
    nextSettings = mergeSettingsSection(nextSettings, "customActions", input.bundle.sections.customActions, input.strategy);
  }
  if (selected.has("savedViews") && input.bundle.sections.savedViews) {
    nextSettings = mergeSettingsSection(nextSettings, "savedViews", input.bundle.sections.savedViews, input.strategy);
  }
  if (selected.has("favourites") && input.bundle.sections.favourites) {
    nextAppState = mergeFavouriteNamespaces(nextAppState, input.bundle.sections.favourites, input.strategy);
  }
  if (selected.has("signalSettings") && input.bundle.sections.signalSettings) {
    nextSettings = mergeSignalSettings(nextSettings, input.bundle.sections.signalSettings, input.strategy);
  }
  return { settings: nextSettings, appState: nextAppState };
}

function mergeSettingsSection<K extends "smartFilters" | "resourceTags" | "resourceMacros" | "dynamicLinks" | "customCommands" | "customActions" | "savedViews">(
  settings: KviewUserSettingsV2,
  section: K,
  incoming: KviewUserSettingsV2[K],
  strategy: SettingsTransferMergeStrategy,
): KviewUserSettingsV2 {
  if (strategy === "replaceSections") return { ...settings, [section]: incoming };
  if (section === "resourceTags") {
    return {
      ...settings,
      resourceTags: mergeResourceTags(settings.resourceTags, incoming as ResourceTagsSettings, strategy),
    };
  }
  if (section === "resourceMacros") {
    return {
      ...settings,
      resourceMacros: mergeResourceMacros(settings.resourceMacros, incoming as ResourceMacrosSettings, strategy),
    };
  }
  if (section === "dynamicLinks") {
    return {
      ...settings,
      dynamicLinks: mergeDynamicLinks(settings.dynamicLinks, incoming as DynamicLinksSettings, strategy),
    };
  }
  if (section === "smartFilters") {
    return {
      ...settings,
      smartFilters: {
        minCount: strategy === "useImported" ? (incoming as KviewUserSettingsV2["smartFilters"]).minCount : settings.smartFilters.minCount,
        rules: mergeById(settings.smartFilters.rules, (incoming as KviewUserSettingsV2["smartFilters"]).rules, strategy),
      },
    };
  }
  if (section === "savedViews") {
    return {
      ...settings,
      savedViews: mergeById(settings.savedViews, incoming as KviewUserSettingsV2["savedViews"], strategy).slice(0, 50),
    };
  }
  if (section === "customCommands") {
    return {
      ...settings,
      customCommands: {
        commands: mergeById(settings.customCommands.commands, (incoming as KviewUserSettingsV2["customCommands"]).commands, strategy),
      },
    };
  }
  return {
    ...settings,
    customActions: {
      actions: mergeById(settings.customActions.actions, (incoming as KviewUserSettingsV2["customActions"]).actions, strategy),
    },
  };
}

function mergeResourceMacros(
  current: ResourceMacrosSettings,
  incoming: ResourceMacrosSettings,
  strategy: SettingsTransferMergeStrategy,
): ResourceMacrosSettings {
  if (strategy === "replaceSections") return incoming;
  return {
    enabled: strategy === "useImported" ? incoming.enabled : current.enabled,
    maxResolveDepth: strategy === "useImported" ? incoming.maxResolveDepth : current.maxResolveDepth,
    definitions: mergeById(current.definitions, incoming.definitions, strategy),
    extractors: mergeById(current.extractors, incoming.extractors, strategy),
  };
}

function mergeDynamicLinks(
  current: DynamicLinksSettings,
  incoming: DynamicLinksSettings,
  strategy: SettingsTransferMergeStrategy,
): DynamicLinksSettings {
  if (strategy === "replaceSections") return incoming;
  return {
    enabled: strategy === "useImported" ? incoming.enabled : current.enabled,
    definitions: mergeById(current.definitions, incoming.definitions, strategy),
  };
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  strategy: SettingsTransferMergeStrategy,
): T[] {
  const byID = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (!byID.has(item.id) || strategy === "useImported") byID.set(item.id, item);
  }
  const importedIDs = new Set(incoming.map((item) => item.id));
  const ordered = current
    .filter((item) => byID.has(item.id))
    .map((item) => byID.get(item.id) || item);
  for (const item of incoming) {
    if (!current.some((existing) => existing.id === item.id) && importedIDs.has(item.id)) ordered.push(item);
  }
  return ordered;
}

function mergeResourceTags(
  current: ResourceTagsSettings,
  incoming: ResourceTagsSettings,
  strategy: SettingsTransferMergeStrategy,
): ResourceTagsSettings {
  if (strategy === "replaceSections") return incoming;
  const assignments = { ...current.assignments };
  for (const [key, value] of Object.entries(incoming.assignments)) {
    if (!assignments[key] || strategy === "useImported") assignments[key] = value;
  }
  return {
    enabled: strategy === "useImported" ? incoming.enabled : current.enabled,
    inheritNamespaceTags: strategy === "useImported" ? incoming.inheritNamespaceTags : current.inheritNamespaceTags,
    quickFiltersEnabled: strategy === "useImported" ? incoming.quickFiltersEnabled : current.quickFiltersEnabled,
    cleanupMissingAssignments: strategy === "useImported" ? incoming.cleanupMissingAssignments : current.cleanupMissingAssignments,
    definitions: mergeById(current.definitions, incoming.definitions, strategy),
    autoTagRules: mergeById(current.autoTagRules, incoming.autoTagRules, strategy),
    assignments,
  };
}

function mergeFavouriteNamespaces(
  current: AppStateV1,
  incoming: Pick<AppStateV1, "favouriteNamespacesByContext">,
  strategy: SettingsTransferMergeStrategy,
): AppStateV1 {
  if (strategy === "replaceSections") {
    return { ...current, favouriteNamespacesByContext: incoming.favouriteNamespacesByContext };
  }
  const next = { ...current.favouriteNamespacesByContext };
  for (const [contextName, namespaces] of Object.entries(incoming.favouriteNamespacesByContext)) {
    if (!next[contextName]) {
      next[contextName] = namespaces;
    } else if (strategy === "useImported") {
      next[contextName] = namespaces;
    } else {
      next[contextName] = Array.from(new Set([...next[contextName], ...namespaces])).sort((a, b) => a.localeCompare(b));
    }
  }
  return { ...current, favouriteNamespacesByContext: next };
}

function mergeSignalSettings(
  settings: KviewUserSettingsV2,
  incoming: NonNullable<SettingsTransferBundleV1["sections"]["signalSettings"]>,
  strategy: SettingsTransferMergeStrategy,
): KviewUserSettingsV2 {
  const contextOverrides = { ...settings.dataplane.contextOverrides };
  if (strategy === "replaceSections") {
    for (const contextName of Object.keys(contextOverrides)) {
      if (contextOverrides[contextName]?.signals) {
        const nextOverride = { ...contextOverrides[contextName] };
        delete nextOverride.signals;
        contextOverrides[contextName] = nextOverride;
      }
    }
  }
  for (const [contextName, signals] of Object.entries(incoming.contextOverrides)) {
    contextOverrides[contextName] = {
      ...(contextOverrides[contextName] || {}),
      signals: strategy === "keepMine"
        ? mergeContextSignals(contextOverrides[contextName]?.signals, signals)
        : signals,
    };
  }
  return {
    ...settings,
    dataplane: {
      ...settings.dataplane,
      global: {
        ...settings.dataplane.global,
        signals: strategy === "keepMine" ? mergeGlobalSignals(settings.dataplane.global.signals, incoming.global) : incoming.global,
      },
      contextOverrides,
    },
  };
}

function mergeGlobalSignals(current: DataplaneSettings["signals"], incoming: DataplaneSettings["signals"]): DataplaneSettings["signals"] {
  return {
    ...current,
    overrides: mergeRecord(current.overrides, incoming.overrides, "keepMine"),
    contextOverrides: mergeRecord(current.contextOverrides, incoming.contextOverrides, "keepMine"),
  };
}

function mergeContextSignals(
  current: DataplaneContextOverrideSettings["signals"] | undefined,
  incoming: NonNullable<DataplaneContextOverrideSettings["signals"]>,
): NonNullable<DataplaneContextOverrideSettings["signals"]> {
  if (!current) return incoming;
  return {
    ...current,
    overrides: mergeRecord(current.overrides || {}, incoming.overrides || {}, "keepMine"),
  };
}

function mergeRecord<T>(
  current: Record<string, T>,
  incoming: Record<string, T>,
  strategy: SettingsTransferMergeStrategy,
): Record<string, T> {
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(next, key) || strategy === "useImported") next[key] = value;
  }
  return next;
}

function normalizeStringArrayRecord(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    const contextName = key.trim();
    if (!contextName || !Array.isArray(value)) continue;
    const items = Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())))
      .sort((a, b) => a.localeCompare(b));
    if (items.length > 0) out[contextName] = items;
  }
  return out;
}

function normalizeSignalSettingsTransfer(input: unknown): NonNullable<SettingsTransferBundleV1["sections"]["signalSettings"]> {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as { global?: unknown; contextOverrides?: unknown }
    : {};
  const defaults = defaultUserSettings();
  const contextOverrides: Record<string, DataplaneContextOverrideSettings> = {};
  if (raw.contextOverrides && typeof raw.contextOverrides === "object" && !Array.isArray(raw.contextOverrides)) {
    for (const [contextName, signals] of Object.entries(raw.contextOverrides)) {
      if (contextName.trim()) contextOverrides[contextName.trim()] = { signals: signals as DataplaneContextOverrideSettings["signals"] };
    }
  }
  const parsed = validateUserSettings({
    ...defaults,
    dataplane: {
      ...defaults.dataplane,
      global: {
        ...defaults.dataplane.global,
        signals: raw.global,
      },
      contextOverrides,
    },
  }) || defaults;
  const normalizedContextOverrides: Record<string, NonNullable<DataplaneContextOverrideSettings["signals"]>> = {};
  for (const [contextName, override] of Object.entries(parsed.dataplane.contextOverrides)) {
    if (override.signals) normalizedContextOverrides[contextName] = override.signals;
  }
  return {
    global: parsed.dataplane.global.signals,
    contextOverrides: normalizedContextOverrides,
  };
}

function normalizeInvestigationTriageState(value: unknown): InvestigationSnapshot["triageState"] {
  switch (value) {
    case "watching":
    case "investigating":
    case "known":
    case "resolved":
    case "ignored":
      return value;
    default:
      return "investigating";
  }
}

function cleanTransferText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanTransferBlock(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeInvestigationResourceRef(input: unknown): InvestigationSnapshot["primaryResource"] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<InvestigationSnapshot["primaryResource"]>;
  const ref = {
    kind: cleanTransferText(raw.kind, 128),
    namespace: cleanTransferText(raw.namespace, 128),
    name: cleanTransferText(raw.name, 256),
    uid: cleanTransferText(raw.uid, 256),
  };
  if (!ref.kind || !ref.name) return null;
  return ref;
}

function normalizeSavedInvestigationResult(input: unknown): InvestigationSnapshot["investigation"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  if (!raw.signal || typeof raw.signal !== "object" || Array.isArray(raw.signal)) return undefined;
  if (!raw.diagnosis || typeof raw.diagnosis !== "object" || Array.isArray(raw.diagnosis)) return undefined;
  if (!raw.primaryResource || typeof raw.primaryResource !== "object" || Array.isArray(raw.primaryResource)) return undefined;
  if (typeof raw.exportMarkdown !== "string" || typeof raw.generatedAt !== "number") return undefined;
  try {
    const serialized = JSON.stringify(input);
    if (serialized.length > 1_000_000) return undefined;
    return JSON.parse(serialized) as InvestigationSnapshot["investigation"];
  } catch {
    return undefined;
  }
}

function normalizeInvestigationSnapshotTransfer(input: unknown): InvestigationSnapshot[] {
  if (!Array.isArray(input)) return [];
  const out: InvestigationSnapshot[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Partial<InvestigationSnapshot>;
    const primaryResource = normalizeInvestigationResourceRef(raw.primaryResource);
    const signalRaw = raw.signal && typeof raw.signal === "object" && !Array.isArray(raw.signal) ? raw.signal : {};
    const signal = {
      type: cleanTransferText((signalRaw as Partial<InvestigationSnapshot["signal"]>).type, 128),
      title: cleanTransferText((signalRaw as Partial<InvestigationSnapshot["signal"]>).title, 240),
      severity: cleanTransferText((signalRaw as Partial<InvestigationSnapshot["signal"]>).severity, 32),
      category: cleanTransferText((signalRaw as Partial<InvestigationSnapshot["signal"]>).category, 64),
      observedAt: typeof (signalRaw as Partial<InvestigationSnapshot["signal"]>).observedAt === "number"
        ? Math.floor((signalRaw as Partial<InvestigationSnapshot["signal"]>).observedAt || 0)
        : undefined,
    };
    const markdown = cleanTransferBlock(raw.markdown, 200000);
    const title = cleanTransferText(raw.title, 240);
    if (!primaryResource || !signal.type || !markdown || !title) continue;
    const snapshot: InvestigationSnapshot = {
      id: cleanTransferText(raw.id, 128) || undefined,
      context: cleanTransferText(raw.context, 128) || undefined,
      createdAt: typeof raw.createdAt === "number" && raw.createdAt > 0 ? Math.floor(raw.createdAt) : undefined,
      updatedAt: typeof raw.updatedAt === "number" && raw.updatedAt > 0 ? Math.floor(raw.updatedAt) : undefined,
      title,
      triageState: normalizeInvestigationTriageState(raw.triageState),
      signal,
      primaryResource,
      relatedResources: Array.isArray(raw.relatedResources)
        ? raw.relatedResources.map(normalizeInvestigationResourceRef).filter((ref): ref is InvestigationSnapshot["primaryResource"] => !!ref).slice(0, 64)
        : [],
      relatedSignalTypes: Array.isArray(raw.relatedSignalTypes)
        ? Array.from(new Set(raw.relatedSignalTypes.map((value) => cleanTransferText(value, 128)).filter(Boolean))).slice(0, 64)
        : [],
      markdown,
      operatorNote: cleanTransferBlock(raw.operatorNote, 8000) || undefined,
      runbookUrls: Array.isArray(raw.runbookUrls)
        ? Array.from(new Set(raw.runbookUrls.map((value) => cleanTransferText(value, 2048)).filter(Boolean))).slice(0, 16)
        : [],
      investigation: normalizeSavedInvestigationResult(raw.investigation),
      source: cleanTransferText(raw.source, 64) || "investigate-signal",
    };
    const key = `${snapshot.context || ""}\u0000${snapshot.id || ""}\u0000${snapshot.primaryResource.kind}\u0000${snapshot.primaryResource.namespace || ""}\u0000${snapshot.primaryResource.name}\u0000${snapshot.title}\u0000${snapshot.createdAt || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snapshot);
  }
  return out.slice(0, 500);
}

function normalizeSignalAcknowledgementTransfer(input: unknown): Record<string, Record<string, SignalAcknowledgementTransferRecord>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, Record<string, SignalAcknowledgementTransferRecord>> = {};
  for (const [contextName, records] of Object.entries(input)) {
    const contextKey = contextName.trim();
    if (!contextKey || !records || typeof records !== "object" || Array.isArray(records)) continue;
    const contextRecords: Record<string, SignalAcknowledgementTransferRecord> = {};
    for (const [historyKey, rawRecord] of Object.entries(records)) {
      const key = historyKey.trim();
      if (!key || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) continue;
      const record = rawRecord as Partial<SignalAcknowledgementTransferRecord>;
      if (typeof record.acknowledgedAt !== "number" || record.acknowledgedAt <= 0) continue;
      contextRecords[key] = {
        acknowledgedAt: Math.floor(record.acknowledgedAt),
        acknowledgedBy: typeof record.acknowledgedBy === "string" ? record.acknowledgedBy.trim() : undefined,
        comment: typeof record.comment === "string" ? record.comment.trim() : undefined,
        updatedAt: typeof record.updatedAt === "number" && record.updatedAt > 0
          ? Math.floor(record.updatedAt)
          : Math.floor(record.acknowledgedAt),
      };
    }
    if (Object.keys(contextRecords).length > 0) out[contextKey] = contextRecords;
  }
  return out;
}

function normalizeSignalHistoryTransfer(input: unknown): Record<string, Record<string, SignalHistoryTransferRecord>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, Record<string, SignalHistoryTransferRecord>> = {};
  for (const [contextName, records] of Object.entries(input)) {
    const contextKey = contextName.trim();
    if (!contextKey || !records || typeof records !== "object" || Array.isArray(records)) continue;
    const contextRecords: Record<string, SignalHistoryTransferRecord> = {};
    for (const [historyKey, rawRecord] of Object.entries(records)) {
      const key = historyKey.trim();
      if (!key || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) continue;
      const record = rawRecord as Partial<SignalHistoryTransferRecord>;
      const firstSeenAt = typeof record.firstSeenAt === "number" ? Math.floor(record.firstSeenAt) : 0;
      const lastSeenAt = typeof record.lastSeenAt === "number" ? Math.floor(record.lastSeenAt) : 0;
      if (firstSeenAt <= 0 || lastSeenAt < firstSeenAt) continue;
      const observedDays = Array.isArray(record.observedDays)
        ? Array.from(new Set(record.observedDays
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value))))
          .sort((a, b) => a - b)
          .slice(-30)
        : [];
      if (observedDays.length === 0) continue;
      contextRecords[key] = {
        firstSeenAt,
        lastSeenAt,
        seenCount: typeof record.seenCount === "number" && Number.isFinite(record.seenCount) && record.seenCount > 0
          ? Math.floor(record.seenCount)
          : observedDays.length,
        observedDays,
      };
    }
    if (Object.keys(contextRecords).length > 0) out[contextKey] = contextRecords;
  }
  return out;
}

function serializeUserSettingsV2(settings: KviewUserSettingsV2): KviewUserSettingsV2 {
  const next = JSON.parse(JSON.stringify(settings)) as KviewUserSettingsV2;
  // Persist detector thresholds as the v2 source of truth.
  delete (next.dataplane.global.dashboard as unknown as { restartElevatedThreshold?: number }).restartElevatedThreshold;
  delete (next.dataplane.global.metrics as unknown as { containerNearLimitPct?: number }).containerNearLimitPct;
  delete (next.dataplane.global.metrics as unknown as { nodePressurePct?: number }).nodePressurePct;
  return next;
}

function ruleMatchesContext(rule: SmartFilterRule, ctx: SmartFilterMatchContext): boolean {
  if (rule.context && rule.context !== ctx.contextName) return false;

  if (rule.scope === "cluster" && ctx.namespace) return false;
  if (rule.scope === "namespace") {
    if (!ctx.namespace) return false;
    if (rule.namespace && rule.namespace !== ctx.namespace) return false;
  }

  if (rule.resourceScope === "selected") {
    if (!ctx.resourceKey) return false;
    if (!rule.resources.includes(ctx.resourceKey)) return false;
  }

  return true;
}

export function labelForSmartFilterRule(
  name: string,
  rule: SmartFilterRule,
  ctx: SmartFilterMatchContext,
): string | null {
  if (!rule.enabled || !rule.pattern || !ruleMatchesContext(rule, ctx)) return null;
  try {
    const re = new RegExp(rule.pattern, rule.flags);
    const match = name.match(re);
    if (!match) return null;
    const label = renderReplacementTemplate(rule.display, match).trim();
    return label || null;
  } catch {
    return null;
  }
}

function renderReplacementTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\$|&|`|'|\d{1,2})/g, (raw, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0] ?? "";
    if (token === "`" || token === "'") return "";
    const index = Number(token);
    if (!Number.isInteger(index)) return raw;
    return match[index] ?? "";
  });
}

export function labelForSmartFilterRules(
  name: string,
  rules: SmartFilterRule[],
  ctx: SmartFilterMatchContext,
): string | null {
  for (const rule of rules) {
    const label = labelForSmartFilterRule(name, rule, ctx);
    if (label) return label;
  }
  return null;
}

export function customCommandMatchesContainer(command: CustomCommandDefinition, containerName: string): boolean {
  if (!command.enabled || !command.command.trim()) return false;
  const pattern = command.containerPattern.trim();
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(containerName);
  } catch {
    return false;
  }
}

export function customCommandsForContainer(
  commands: CustomCommandDefinition[],
  containerName: string,
): CustomCommandDefinition[] {
  return commands.filter((command) => customCommandMatchesContainer(command, containerName));
}

export function customActionsForResource(
  actions: CustomActionDefinition[],
  resourceKey: ListResourceKey,
): CustomActionDefinition[] {
  return actions.filter((action) => action.enabled && action.resources.includes(resourceKey));
}

export { customActionResourceKeys };

export const allListResourceKeys: ListResourceKey[] = [
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "horizontalpodautoscalers",
  "services",
  "ingresses",
  "networkpolicies",
  "configmaps",
  "secrets",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "persistentvolumeclaims",
  "persistentvolumes",
  "nodes",
  "namespaces",
  "customresourcedefinitions",
  "helm",
  "helmcharts",
  "clusterresources",
  "resourcequotas",
  "limitranges",
];
