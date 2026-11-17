export type HistoryRanking = "topSignals10" | "topChanges10" | "custom";
export type HistoryNamespaceRanking = HistoryRanking | "favourites" | "recent" | "tag";
export type HistoryContextPreferences = {
  rulesMode: HistoryRanking;
  nodesMode: HistoryRanking;
  namespaceMode: HistoryNamespaceRanking;
  rules: string[];
  nodes: string[];
  namespaces: string[];
  tag: string;
};
export type HistoryPreferences = {
  days: number;
  hours: number;
  contexts: Record<string, HistoryContextPreferences>;
};
export type HistoryNamespaceFeatures = { favourites: boolean; recent: boolean; tags: boolean; tagIds: readonly string[] };
// Availability is a presentation/query projection, never a preference migration.
export function historyNamespaceRankings(features: HistoryNamespaceFeatures): HistoryNamespaceRanking[] {
  return ["topSignals10", "topChanges10", ...(features.favourites ? ["favourites" as const] : []), ...(features.recent ? ["recent" as const] : []), "custom", ...(features.tags && features.tagIds.length ? ["tag" as const] : [])];
}
export function effectiveHistoryNamespaceRanking(mode: HistoryNamespaceRanking, tag: string, features: HistoryNamespaceFeatures): HistoryNamespaceRanking {
  return historyNamespaceRankings(features).includes(mode) && !(mode === "tag" && tag && !features.tagIds.includes(tag)) ? mode : "topSignals10";
}
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
const rankings = ["topSignals10", "topChanges10", "custom"];
// Preserve exact identities: never trim or truncate a namespace, rule, or Node UID.
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 1024;
const selection = (input: unknown): string[] => Array.isArray(input) ? [...new Set(input.filter(identity))].slice(0, 20) : [];
function nodeIdentity(value: string): boolean {
  try {
    const key: unknown = JSON.parse(value);
    return Array.isArray(key) && key.length === 2 && key.every(part => identity(part) && part.length <= 512) && JSON.stringify(key) === value;
  } catch { return false; }
}
export function normalizeHistoryContextPreferences(input?: unknown): HistoryContextPreferences {
  // Migrate the previous browser preference without accepting it on the API.
  const raw = { ...record(input) };
  for (const key of ["rulesMode", "nodesMode", "namespaceMode"]) {
    if (raw[key] === "topHigh10") raw[key] = "topSignals10";
  }
  return {
    rulesMode: rankings.includes(raw.rulesMode as string) ? raw.rulesMode as HistoryRanking : "topSignals10",
    nodesMode: rankings.includes(raw.nodesMode as string) ? raw.nodesMode as HistoryRanking : "topSignals10",
    namespaceMode: [...rankings, "favourites", "recent", "tag"].includes(raw.namespaceMode as string) ? raw.namespaceMode as HistoryNamespaceRanking : "topSignals10",
    rules: selection(raw.rules), nodes: selection(raw.nodes).filter(nodeIdentity), namespaces: selection(raw.namespaces),
    tag: identity(raw.tag) ? raw.tag : "",
  };
}
export function normalizeHistoryPreferences(input?: unknown): HistoryPreferences {
  const raw = record(input);
  return {
    days: [1, 7, 30, 90].includes(raw.days as number) ? raw.days as number : 1,
    hours: [1, 6, 24].includes(raw.hours as number) ? raw.hours as number : 1,
    contexts: Object.fromEntries(Object.entries(record(raw.contexts)).filter(([key]) => identity(key)).map(([key, value]) => [key, normalizeHistoryContextPreferences(value)])),
  };
}
