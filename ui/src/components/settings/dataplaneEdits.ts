import type { DataplaneContextOverrideSettings, DataplaneSettings, KviewUserSettingsV2 } from "../../settings";

// Edit-time operations deliberately preserve sparse overrides. Validation and
// persisted-value normalization remain owned by the settings parser/provider.
export type DataplaneEditScope = "global" | "context";

export function updateDataplane(settings: KviewUserSettingsV2, patch: Partial<DataplaneSettings>): KviewUserSettingsV2 {
  return {
    ...settings,
    dataplane: { ...settings.dataplane, global: { ...settings.dataplane.global, ...patch } },
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) out[key] = deepMerge(prev, value);
    else out[key] = value;
  }
  return out as T;
}

export function stripUndefinedDeep<T>(value: T): T | undefined {
  if (Array.isArray(value)) return value as T;
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const normalized = stripUndefinedDeep(child);
    if (normalized === undefined) continue;
    if (isPlainObject(normalized) && Object.keys(normalized).length === 0) continue;
    next[key] = normalized;
  }
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

function settingsValueEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => settingsValueEqual(item, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!settingsValueEqual(left[key], right[key])) return false;
    }
    return true;
  }
  return left === right;
}

function pruneContextOverrideValue(value: unknown, globalValue: unknown): unknown {
  if (Array.isArray(value)) return settingsValueEqual(value, globalValue) ? undefined : value;
  if (!isPlainObject(value)) return settingsValueEqual(value, globalValue) ? undefined : value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const pruned = pruneContextOverrideValue(child, isPlainObject(globalValue) ? globalValue[key] : undefined);
    if (pruned === undefined) continue;
    if (isPlainObject(pruned) && Object.keys(pruned).length === 0) continue;
    out[key] = pruned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function pruneContextOverride(
  override: DataplaneContextOverrideSettings,
  global: DataplaneSettings,
): DataplaneContextOverrideSettings | undefined {
  return pruneContextOverrideValue(override, global) as DataplaneContextOverrideSettings | undefined;
}

export function updateContextDataplaneOverride(
  prev: KviewUserSettingsV2,
  activeContext: string,
  updater: (current: DataplaneContextOverrideSettings) => DataplaneContextOverrideSettings,
): KviewUserSettingsV2 {
  const contextName = activeContext.trim();
  if (!contextName) return prev;
  const contextOverrides = { ...prev.dataplane.contextOverrides };
  const current = contextOverrides[contextName] || {};
  const next = stripUndefinedDeep(pruneContextOverride(updater(current), prev.dataplane.global));
  if (next) contextOverrides[contextName] = next;
  else delete contextOverrides[contextName];
  return { ...prev, dataplane: { ...prev.dataplane, contextOverrides } };
}

export function patchDataplaneSection<K extends keyof DataplaneSettings>(
  prev: KviewUserSettingsV2,
  scope: DataplaneEditScope,
  activeContext: string,
  key: K,
  patch: Partial<DataplaneSettings[K]>,
): KviewUserSettingsV2 {
  if (scope === "global") {
    return updateDataplane(prev, {
      [key]: deepMerge(prev.dataplane.global[key], patch),
    } as Partial<DataplaneSettings>);
  }
  return updateContextDataplaneOverride(prev, activeContext, (current) => ({
    ...current,
    [key]: deepMerge((current[key] || {}) as DataplaneSettings[K], patch),
  }));
}

export function setDataplanePrimitive<K extends keyof DataplaneSettings>(
  prev: KviewUserSettingsV2,
  scope: DataplaneEditScope,
  activeContext: string,
  key: K,
  value: DataplaneSettings[K],
): KviewUserSettingsV2 {
  if (scope === "global") return updateDataplane(prev, { [key]: value } as Partial<DataplaneSettings>);
  return updateContextDataplaneOverride(prev, activeContext, (current) => ({ ...current, [key]: value }));
}

export function resetDataplaneOverridePath(
  prev: KviewUserSettingsV2,
  activeContext: string,
  path: string[],
): KviewUserSettingsV2 {
  return updateContextDataplaneOverride(prev, activeContext, (current) => {
    const next = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    let cursor: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      if (!isPlainObject(cursor[key])) return current;
      cursor = cursor[key] as Record<string, unknown>;
    }
    delete cursor[path[path.length - 1]];
    return next as DataplaneContextOverrideSettings;
  });
}
