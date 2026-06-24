import type { ListResourceKey } from "./utils/k8sResources";

export type ResourceMemoryStatus = "watch" | "known" | "do-not-touch" | "investigating" | "resolved";

export type ResourceMemoryTarget = {
  context: string;
  resource: ListResourceKey;
  namespace?: string | null;
  name: string;
};

export type ResourceMemoryRecord = {
  key: string;
  target: ResourceMemoryTarget;
  status: ResourceMemoryStatus;
  note: string;
  runbookUrl: string;
  createdAt: number;
  updatedAt: number;
};

export type ResourceMemoryStore = {
  v: 1;
  records: Record<string, ResourceMemoryRecord>;
};

export const RESOURCE_MEMORY_STORAGE_KEY = "kview:resourceMemory:v1";
export const RESOURCE_MEMORY_CHANGED_EVENT = "kview:resource-memory-changed";

const allowedStatuses = new Set<ResourceMemoryStatus>(["watch", "known", "do-not-touch", "investigating", "resolved"]);

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+\n/g, "\n").slice(0, maxLength);
}

function cleanSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resourceMemoryTargetKey(target: ResourceMemoryTarget): string {
  return [
    cleanSingleLine(target.context, 128),
    cleanSingleLine(target.resource, 64),
    cleanSingleLine(target.namespace || "", 128),
    cleanSingleLine(target.name, 256),
  ].join("\x00");
}

export function defaultResourceMemoryStore(): ResourceMemoryStore {
  return { v: 1, records: {} };
}

export function normalizeResourceMemoryStore(input: unknown): ResourceMemoryStore {
  const out = defaultResourceMemoryStore();
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const rawRecords = (input as Partial<ResourceMemoryStore>).records;
  if (!rawRecords || typeof rawRecords !== "object" || Array.isArray(rawRecords)) return out;

  for (const rawValue of Object.values(rawRecords)) {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const raw = rawValue as Partial<ResourceMemoryRecord>;
    const rawTarget = raw.target && typeof raw.target === "object" && !Array.isArray(raw.target)
      ? raw.target as Partial<ResourceMemoryTarget>
      : {};
    const target: ResourceMemoryTarget = {
      context: cleanSingleLine(rawTarget.context, 128),
      resource: rawTarget.resource as ListResourceKey,
      namespace: cleanSingleLine(rawTarget.namespace || "", 128),
      name: cleanSingleLine(rawTarget.name, 256),
    };
    if (!target.context || !target.resource || !target.name) continue;
    const status = allowedStatuses.has(raw.status as ResourceMemoryStatus) ? raw.status as ResourceMemoryStatus : "watch";
    const note = cleanText(raw.note, 4000);
    const runbookUrl = cleanSingleLine(raw.runbookUrl, 2048);
    if (!note && !runbookUrl && status === "watch") continue;
    const key = resourceMemoryTargetKey(target);
    const updatedAt = validTimestamp(raw.updatedAt, Date.now());
    out.records[key] = {
      key,
      target,
      status,
      note,
      runbookUrl,
      createdAt: validTimestamp(raw.createdAt, updatedAt),
      updatedAt,
    };
  }
  return out;
}

export function loadResourceMemoryStore(storage: Storage = window.localStorage): ResourceMemoryStore {
  try {
    const raw = storage.getItem(RESOURCE_MEMORY_STORAGE_KEY);
    return normalizeResourceMemoryStore(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultResourceMemoryStore();
  }
}

export function saveResourceMemoryStore(store: ResourceMemoryStore, storage: Storage = window.localStorage): void {
  storage.setItem(RESOURCE_MEMORY_STORAGE_KEY, JSON.stringify(normalizeResourceMemoryStore(store)));
  window.dispatchEvent(new CustomEvent(RESOURCE_MEMORY_CHANGED_EVENT));
}

export function getResourceMemoryRecord(store: ResourceMemoryStore, target: ResourceMemoryTarget): ResourceMemoryRecord | null {
  return store.records[resourceMemoryTargetKey(target)] || null;
}

export function upsertResourceMemoryRecord(
  store: ResourceMemoryStore,
  target: ResourceMemoryTarget,
  input: { status: ResourceMemoryStatus; note: string; runbookUrl: string; now?: number },
): ResourceMemoryStore {
  const key = resourceMemoryTargetKey(target);
  const existing = store.records[key];
  const now = validTimestamp(input.now, Date.now());
  const note = cleanText(input.note, 4000);
  const runbookUrl = cleanSingleLine(input.runbookUrl, 2048);
  const status = allowedStatuses.has(input.status) ? input.status : "watch";
  return {
    v: 1,
    records: {
      ...store.records,
      [key]: {
        key,
        target: {
          context: cleanSingleLine(target.context, 128),
          resource: target.resource,
          namespace: cleanSingleLine(target.namespace || "", 128),
          name: cleanSingleLine(target.name, 256),
        },
        status,
        note,
        runbookUrl,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      },
    },
  };
}

export function removeResourceMemoryRecord(store: ResourceMemoryStore, target: ResourceMemoryTarget): ResourceMemoryStore {
  const key = resourceMemoryTargetKey(target);
  if (!store.records[key]) return store;
  const records = { ...store.records };
  delete records[key];
  return { v: 1, records };
}
