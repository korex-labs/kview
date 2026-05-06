type BrowserMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

type LongTaskSample = {
  name: string;
  startTime: number;
  duration: number;
};

type LongTaskSummary = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  recent: LongTaskSample[];
};

type ApiTiming = {
  method: string;
  path: string;
  count: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
  totalBytes: number;
  maxBytes: number;
  parseTotalMs: number;
  parseMaxMs: number;
  recent: Array<{
    at: string;
    durationMs: number;
    parseMs: number;
    bytes: number;
    ok: boolean;
    status?: number;
  }>;
};

type ListTiming = {
  label: string;
  fetchCount: number;
  fetchTotalMs: number;
  fetchMaxMs: number;
  mapCount: number;
  mapTotalMs: number;
  mapMaxMs: number;
  filterCount: number;
  filterTotalMs: number;
  filterMaxMs: number;
  quickFilterCount: number;
  quickFilterTotalMs: number;
  quickFilterMaxMs: number;
  lastRows: number;
  lastFilteredRows: number;
  lastQuickFilters: number;
  recent: Array<{
    at: string;
    phase: "fetch" | "map" | "filter" | "quickFilters" | "snapshot";
    durationMs?: number;
    rows?: number;
    filteredRows?: number;
    quickFilters?: number;
  }>;
};

export type BrowserPerformanceSnapshot = {
  capturedAt: string;
  diagnostics: {
    enabled: boolean;
    enabledAt?: string;
    uptimeSec: number;
    appContext: PerformanceAppContext;
  };
  urlPath: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
    visibilityState: DocumentVisibilityState;
  };
  memory?: BrowserMemory;
  navigation?: {
    durationMs: number;
    domContentLoadedMs: number;
    loadEventMs: number;
  };
  resources: {
    count: number;
    transferSizeBytes: number;
    encodedBodySizeBytes: number;
    decodedBodySizeBytes: number;
  };
  longTasks: LongTaskSummary;
  api: ApiTiming[];
  lists: ListTiming[];
};

export type PerformanceDiagnosticsReport<TBackend = unknown> = {
  capturedAt: string;
  browser: BrowserPerformanceSnapshot;
  backend?: TBackend;
  backendError?: string;
};

export type PerformanceAppContext = {
  activeContext?: string;
  activeNamespace?: string;
  activeSection?: string;
  activityPanelOpen?: boolean;
  dataplaneProfile?: string;
  settingsOpen?: boolean;
  namespaceCount?: number;
};

let observer: PerformanceObserver | null = null;
let enabled = false;
let enabledAt = 0;
let appContext: PerformanceAppContext = {};
let longTasks: LongTaskSummary = {
  count: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  recent: [],
};
const apiTimings = new Map<string, ApiTiming>();
const listTimings = new Map<string, ListTiming>();

function resetLongTasks() {
  longTasks = {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    recent: [],
  };
}

function resetDiagnostics() {
  resetLongTasks();
  apiTimings.clear();
  listTimings.clear();
  appContext = {};
}

function nowIso() {
  return new Date().toISOString();
}

function roundedMs(value: number) {
  return Math.round(value * 10) / 10;
}

function pushRecent<T>(items: T[], item: T, max = 25): T[] {
  return [...items.slice(-(max - 1)), item];
}

function normalizePath(path: string) {
  try {
    const u = new URL(path, window.location.origin);
    return u.pathname;
  } catch {
    return path.split("?")[0] || path;
  }
}

export function setPerformanceDiagnosticsEnabled(enabled: boolean) {
  if (!enabled) {
    observer?.disconnect();
    observer = null;
    resetDiagnostics();
    enabledAt = 0;
    globalThis.window?.performance?.clearResourceTimings?.();
    moduleEnabled(false);
    return;
  }
  moduleEnabled(true);
  enabledAt = window.performance.now();
  if (observer || typeof PerformanceObserver === "undefined") return;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  if (!supported.includes("longtask")) return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const sample = {
        name: entry.name || "longtask",
        startTime: Math.round(entry.startTime),
        duration: Math.round(entry.duration),
      };
      longTasks.count += 1;
      longTasks.totalDurationMs += sample.duration;
      longTasks.maxDurationMs = Math.max(longTasks.maxDurationMs, sample.duration);
      longTasks.recent = [...longTasks.recent.slice(-19), sample];
    }
  });
  observer.observe({ type: "longtask", buffered: true });
}

function moduleEnabled(next: boolean) {
  enabled = next;
}

export function performanceDiagnosticsEnabled() {
  return enabled;
}

export function setPerformanceDiagnosticsContext(context: PerformanceAppContext) {
  if (!enabled) return;
  appContext = { ...appContext, ...context };
}

export function recordApiTiming(input: {
  method: string;
  path: string;
  durationMs: number;
  parseMs: number;
  bytes: number;
  ok: boolean;
  status?: number;
}) {
  if (!enabled) return;
  const path = normalizePath(input.path);
  const method = input.method.toUpperCase();
  const key = `${method} ${path}`;
  const prev = apiTimings.get(key) || {
    method,
    path,
    count: 0,
    errorCount: 0,
    totalMs: 0,
    maxMs: 0,
    totalBytes: 0,
    maxBytes: 0,
    parseTotalMs: 0,
    parseMaxMs: 0,
    recent: [],
  };
  prev.count += 1;
  if (!input.ok) prev.errorCount += 1;
  prev.totalMs += input.durationMs;
  prev.maxMs = Math.max(prev.maxMs, input.durationMs);
  prev.totalBytes += input.bytes;
  prev.maxBytes = Math.max(prev.maxBytes, input.bytes);
  prev.parseTotalMs += input.parseMs;
  prev.parseMaxMs = Math.max(prev.parseMaxMs, input.parseMs);
  prev.recent = pushRecent(prev.recent, {
    at: nowIso(),
    durationMs: roundedMs(input.durationMs),
    parseMs: roundedMs(input.parseMs),
    bytes: input.bytes,
    ok: input.ok,
    status: input.status,
  });
  apiTimings.set(key, prev);
}

function listTiming(label: string): ListTiming {
  const existing = listTimings.get(label);
  if (existing) return existing;
  const next: ListTiming = {
    label,
    fetchCount: 0,
    fetchTotalMs: 0,
    fetchMaxMs: 0,
    mapCount: 0,
    mapTotalMs: 0,
    mapMaxMs: 0,
    filterCount: 0,
    filterTotalMs: 0,
    filterMaxMs: 0,
    quickFilterCount: 0,
    quickFilterTotalMs: 0,
    quickFilterMaxMs: 0,
    lastRows: 0,
    lastFilteredRows: 0,
    lastQuickFilters: 0,
    recent: [],
  };
  listTimings.set(label, next);
  return next;
}

export function recordListTiming(input: {
  label: string;
  phase: "fetch" | "map" | "filter" | "quickFilters";
  durationMs: number;
  rows?: number;
  filteredRows?: number;
  quickFilters?: number;
}) {
  if (!enabled) return;
  const item = listTiming(input.label);
  if (input.phase === "fetch") {
    item.fetchCount += 1;
    item.fetchTotalMs += input.durationMs;
    item.fetchMaxMs = Math.max(item.fetchMaxMs, input.durationMs);
  } else if (input.phase === "map") {
    item.mapCount += 1;
    item.mapTotalMs += input.durationMs;
    item.mapMaxMs = Math.max(item.mapMaxMs, input.durationMs);
  } else if (input.phase === "filter") {
    item.filterCount += 1;
    item.filterTotalMs += input.durationMs;
    item.filterMaxMs = Math.max(item.filterMaxMs, input.durationMs);
  } else {
    item.quickFilterCount += 1;
    item.quickFilterTotalMs += input.durationMs;
    item.quickFilterMaxMs = Math.max(item.quickFilterMaxMs, input.durationMs);
  }
  if (input.rows !== undefined) item.lastRows = input.rows;
  if (input.filteredRows !== undefined) item.lastFilteredRows = input.filteredRows;
  if (input.quickFilters !== undefined) item.lastQuickFilters = input.quickFilters;
  item.recent = pushRecent(item.recent, {
    at: nowIso(),
    phase: input.phase,
    durationMs: roundedMs(input.durationMs),
    rows: input.rows,
    filteredRows: input.filteredRows,
    quickFilters: input.quickFilters,
  });
}

export function recordListSnapshot(input: {
  label: string;
  rows: number;
  filteredRows: number;
  quickFilters: number;
}) {
  if (!enabled) return;
  const item = listTiming(input.label);
  item.lastRows = input.rows;
  item.lastFilteredRows = input.filteredRows;
  item.lastQuickFilters = input.quickFilters;
  item.recent = pushRecent(item.recent, {
    at: nowIso(),
    phase: "snapshot",
    rows: input.rows,
    filteredRows: input.filteredRows,
    quickFilters: input.quickFilters,
  });
}

function browserMemory(): BrowserMemory | undefined {
  const perf = window.performance as Performance & { memory?: BrowserMemory };
  const memory = perf.memory;
  if (!memory) return undefined;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

function navigationTiming(): BrowserPerformanceSnapshot["navigation"] {
  const nav = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return undefined;
  return {
    durationMs: Math.round(nav.duration),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadEventMs: Math.round(nav.loadEventEnd),
  };
}

function resourceTiming(): BrowserPerformanceSnapshot["resources"] {
  const resources = window.performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  return resources.reduce(
    (acc, entry) => ({
      count: acc.count + 1,
      transferSizeBytes: acc.transferSizeBytes + Math.max(0, entry.transferSize || 0),
      encodedBodySizeBytes: acc.encodedBodySizeBytes + Math.max(0, entry.encodedBodySize || 0),
      decodedBodySizeBytes: acc.decodedBodySizeBytes + Math.max(0, entry.decodedBodySize || 0),
    }),
    { count: 0, transferSizeBytes: 0, encodedBodySizeBytes: 0, decodedBodySizeBytes: 0 },
  );
}

export function captureBrowserPerformanceSnapshot(): BrowserPerformanceSnapshot {
  const now = window.performance.now();
  return {
    capturedAt: new Date().toISOString(),
    diagnostics: {
      enabled,
      enabledAt: enabledAt > 0 ? new Date(Date.now() - Math.max(0, now - enabledAt)).toISOString() : undefined,
      uptimeSec: Math.round((enabledAt > 0 ? now - enabledAt : now) / 1000),
      appContext: { ...appContext },
    },
    urlPath: `${window.location.pathname}${window.location.search ? "?..." : ""}`,
    userAgent: window.navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      visibilityState: document.visibilityState,
    },
    memory: browserMemory(),
    navigation: navigationTiming(),
    resources: resourceTiming(),
    longTasks: {
      count: longTasks.count,
      totalDurationMs: Math.round(longTasks.totalDurationMs),
      maxDurationMs: Math.round(longTasks.maxDurationMs),
      recent: [...longTasks.recent],
    },
    api: Array.from(apiTimings.values())
      .map((item) => ({
        ...item,
        totalMs: roundedMs(item.totalMs),
        maxMs: roundedMs(item.maxMs),
        parseTotalMs: roundedMs(item.parseTotalMs),
        parseMaxMs: roundedMs(item.parseMaxMs),
      }))
      .sort((a, b) => b.totalMs - a.totalMs),
    lists: Array.from(listTimings.values())
      .map((item) => ({
        ...item,
        fetchTotalMs: roundedMs(item.fetchTotalMs),
        fetchMaxMs: roundedMs(item.fetchMaxMs),
        mapTotalMs: roundedMs(item.mapTotalMs),
        mapMaxMs: roundedMs(item.mapMaxMs),
        filterTotalMs: roundedMs(item.filterTotalMs),
        filterMaxMs: roundedMs(item.filterMaxMs),
        quickFilterTotalMs: roundedMs(item.quickFilterTotalMs),
        quickFilterMaxMs: roundedMs(item.quickFilterMaxMs),
      }))
      .sort((a, b) => (b.fetchTotalMs + b.mapTotalMs + b.filterTotalMs + b.quickFilterTotalMs) - (a.fetchTotalMs + a.mapTotalMs + a.filterTotalMs + a.quickFilterTotalMs)),
  };
}

export function buildPerformanceDiagnosticsReport<TBackend>(
  backend?: TBackend,
  backendError?: string,
): PerformanceDiagnosticsReport<TBackend> {
  return {
    capturedAt: new Date().toISOString(),
    browser: captureBrowserPerformanceSnapshot(),
    ...(backend !== undefined ? { backend } : {}),
    ...(backendError ? { backendError } : {}),
  };
}
