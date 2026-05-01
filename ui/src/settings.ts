import { isClusterScopedResource, type ListResourceKey } from "./utils/k8sResources";

export type SettingsScopeMode = "all" | "cluster" | "namespace";
export type SettingsResourceScopeMode = "any" | "selected";
export type CustomCommandOutputType = "text" | "keyValue" | "csv" | "code" | "file";
export type CustomCommandSafety = "safe" | "dangerous";
export type CustomActionKind = "set" | "unset" | "patch";
export type CustomActionTarget = "env" | "image";
export type CustomActionPatchType = "json" | "merge";
export type DataplaneProfile = "manual" | "focused" | "balanced" | "wide" | "diagnostic";
export type SignalSeverityOverride = "low" | "medium" | "high";

export type SignalOverride = {
  enabled?: boolean;
  severity?: SignalSeverityOverride;
  priority?: number;
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
  customCommands: KviewUserSettingsV1["customCommands"];
  customActions: KviewUserSettingsV1["customActions"];
  keyboard: KviewUserSettingsV1["keyboard"];
  dataplane: DataplaneSettingsV2;
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
    },
    metrics: {
      enabled: true,
      podMetricsTtlSec: 30,
      nodeMetricsTtlSec: 30,
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
      next.namespaceEnrichment.maxParallel = 3;
      next.namespaceEnrichment.warmResourceKinds = ["pods", "deployments", "services", "ingresses", "resourcequotas", "limitranges"];
      next.backgroundBudget.maxConcurrentPerCluster = 5;
      break;
    case "wide":
      next.namespaceEnrichment.maxTargets = 64;
      next.namespaceEnrichment.maxParallel = 3;
      next.namespaceEnrichment.warmResourceKinds = [...dataplaneNamespaceWarmResourceKeys];
      next.namespaceEnrichment.sweep.enabled = true;
      next.namespaceEnrichment.sweep.maxNamespacesPerCycle = 3;
      next.namespaceEnrichment.sweep.maxNamespacesPerHour = 60;
      next.backgroundBudget.maxConcurrentPerCluster = 6;
      break;
    case "diagnostic":
      next.namespaceEnrichment.maxTargets = 100;
      next.namespaceEnrichment.maxParallel = 4;
      next.namespaceEnrichment.idleQuietMs = 1000;
      next.namespaceEnrichment.warmResourceKinds = [...dataplaneNamespaceWarmResourceKeys];
      next.namespaceEnrichment.sweep.enabled = true;
      next.namespaceEnrichment.sweep.idleQuietMs = 10000;
      next.namespaceEnrichment.sweep.maxNamespacesPerCycle = 5;
      next.namespaceEnrichment.sweep.maxNamespacesPerHour = 120;
      next.namespaceEnrichment.sweep.minReenrichIntervalMinutes = 60;
      next.backgroundBudget.maxConcurrentPerCluster = 8;
      next.backgroundBudget.longRunNoticeSec = 1;
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
  const overrideDetectors = override.signals?.detectors;
  const mergedSignals = override.signals
    ? {
      ...global.signals,
      ...override.signals,
      detectors: {
        ...global.signals.detectors,
        ...(overrideDetectors || {}),
        pod_restarts: {
          ...global.signals.detectors.pod_restarts,
          ...(overrideDetectors?.pod_restarts || {}),
        },
        container_near_limit: {
          ...global.signals.detectors.container_near_limit,
          ...(overrideDetectors?.container_near_limit || {}),
        },
        node_resource_pressure: {
          ...global.signals.detectors.node_resource_pressure,
          ...(overrideDetectors?.node_resource_pressure || {}),
        },
        resource_quota_pressure: {
          ...global.signals.detectors.resource_quota_pressure,
          ...(overrideDetectors?.resource_quota_pressure || {}),
        },
      },
      overrides: { ...global.signals.overrides, ...(override.signals.overrides || {}) },
    }
    : global.signals;
  const mergedMetrics = override.metrics
    ? { ...global.metrics, ...override.metrics }
    : global.metrics;
  return {
    ...global,
    ...(override.profile ? { profile: override.profile } : {}),
    ...(override.snapshots
      ? {
        snapshots: {
          ...global.snapshots,
          ...override.snapshots,
          ...(override.snapshots.ttlSec
            ? { ttlSec: { ...global.snapshots.ttlSec, ...override.snapshots.ttlSec } }
            : {}),
        },
      }
      : {}),
    ...(override.persistence ? { persistence: { ...global.persistence, ...override.persistence } } : {}),
    ...(override.observers ? { observers: { ...global.observers, ...override.observers } } : {}),
    ...(override.namespaceEnrichment
      ? {
        namespaceEnrichment: {
          ...global.namespaceEnrichment,
          ...override.namespaceEnrichment,
          ...(override.namespaceEnrichment.sweep
            ? { sweep: { ...global.namespaceEnrichment.sweep, ...override.namespaceEnrichment.sweep } }
            : {}),
        },
      }
      : {}),
    ...(override.allContextEnrichment
      ? { allContextEnrichment: { ...global.allContextEnrichment, ...override.allContextEnrichment } }
      : {}),
    ...(override.backgroundBudget
      ? { backgroundBudget: { ...global.backgroundBudget, ...override.backgroundBudget } }
      : {}),
    ...(override.dashboard ? { dashboard: { ...global.dashboard, ...override.dashboard } } : {}),
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
  return `${JSON.stringify(serializeUserSettingsV2(settings), null, 2)}\n`;
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
  "resourcequotas",
  "limitranges",
];
