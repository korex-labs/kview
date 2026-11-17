// Catalog labels are display-only: retained/request identities stay byte-for-byte intact.
export function signalTypeLabel(key: string, labels: ReadonlyMap<string, string>): string {
  const known = labels.get(key);
  if (known) return known;
  const readable = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_:./-]+/g, " ").trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Unknown signal type";
}
export type HistoryOption = { key: string; label: string };
export type HistoryCatalog = { rules: HistoryOption[]; nodes: HistoryOption[]; namespaces: HistoryOption[]; truncated: boolean };
export const emptyHistoryCatalog = (): HistoryCatalog => ({ rules: [], nodes: [], namespaces: [], truncated: false });
export function parseHistoryCatalog(raw: unknown): HistoryCatalog {
  if (!raw || typeof raw !== "object") throw new Error("Invalid history inventory.");
  const v = raw as Record<string, unknown>;
  for (const group of ["rules", "nodes", "namespaces"] as const) {
    if (!Array.isArray(v[group]) || v[group].length > 4096) throw new Error("Invalid history inventory.");
    const seen = new Set<string>();
    for (const option of v[group]) {
      if (!option || typeof option.key !== "string" || !option.key || option.key.length > 1024 || typeof option.label !== "string" || !option.label || option.label.length > 1024 || seen.has(option.key)) throw new Error("Invalid history inventory.");
      seen.add(option.key);
      if (group === "nodes") {
        const key: unknown = JSON.parse(option.key);
        if (!Array.isArray(key) || key.length !== 2 || !key.every(x => typeof x === "string" && x.length > 0 && x.length <= 512) || JSON.stringify(key) !== option.key) throw new Error("Invalid history node identity.");
      }
    }
  }
  if (typeof v.truncated !== "boolean") throw new Error("Invalid history inventory.");
  return v as HistoryCatalog;
}
// Selected identities survive changing catalogs, including replaced/deleted nodes.
// Partition first, then sort deterministically inside each group, never by score.
export function historyOptions(choices: HistoryOption[], selected: string[]): HistoryOption[] {
  const byKey = new Map(choices.map(option => [option.key, option]));
  for (const key of selected) if (!byKey.has(key)) byKey.set(key, { key, label: key });
  const chosen = new Set(selected);
  return [...byKey.values()].sort((a, b) => Number(chosen.has(b.key)) - Number(chosen.has(a.key)) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
export function mergeHistoryCatalog(...catalogs: HistoryCatalog[]): HistoryCatalog {
  const result = emptyHistoryCatalog();
  result.truncated = catalogs.some(catalog => catalog.truncated);
  for (const group of ["rules", "nodes", "namespaces"] as const) {
    const merged = mergeHistoryOptions(...catalogs.map(catalog => catalog[group]));
    result[group] = merged.slice(0, 4096);
    result.truncated ||= merged.length > 4096;
  }
  return result;
}
export function mergeHistoryOptions(...groups: HistoryOption[][]): HistoryOption[] {
  return [...new Map(groups.flat().map(option => [option.key, option])).values()];
}
