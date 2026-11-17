import { buildResourceTagsIndex, resourceTagsForTarget, type ResourceTagTarget } from "../../../resourceTags";
import { parseHistoryCatalog, type HistoryCatalog } from "./historyOptions";
import type { ResourceTagsSettings } from "../../../settings";

export type TrendMode = "topSignals10" | "topChanges10" | "custom" | "favourites" | "recent" | "tag";
export type TrendQuery = { context: string; from: string; to: string; rulesMode: TrendMode; nodesMode: TrendMode; namespacesMode: TrendMode; rules: string[]; nodes: string[]; namespaces: string[] };
export type TrendCounts = { high: number; medium: number; low: number; changes: number };
export type TrendPoint = { carriedForward?: boolean; freshness?: "fresh" | "stale" | "unknown"; sourceAgeSeconds?: number | null; confirmedChanges?: number; at: string; counts: TrendCounts | null; sampleAt: string; sourceAt: string; reason?: string; coverage?: "complete" | "partial" | "unknown"; changesCoverage?: "complete" | "partial" | "unknown" };
export type TrendSeries = { key: string; label: string; totalScore: number; changesScore: number; points: TrendPoint[] };
export type TrendDiagnostics = { coalesced?: number; overflow?: number; eligibleScopes: number; evaluatedScopes: number; snapshotCount: number; supportedRules: string[]; unsupportedRules: string[]; lastSample: string; sourceAt: string; sourceAgeSeconds: number | null; coverageGaps: number; capLosses: number; retainedBytes: number; databaseBytes: number; retainedHours: number; reasons: Record<string, number> };
export type SignalTrends = { asOf?: string; catalog?: HistoryCatalog; schemaVersion: 1; context: string; from: string; to: string; severity: TrendSeries[]; rules: TrendSeries[]; nodes: TrendSeries[]; namespaces: TrendSeries[]; diagnostics: TrendDiagnostics };
export type NamespaceInventory = { context: string; token: string; items: Array<Pick<ResourceTagTarget, "name" | "labels" | "annotations">> };
export const trendHour = 3600000;
const fail = (reason = "invalid field shape"): never => { throw new Error(`Invalid or mismatched signal trends response: ${reason}.`); };
function object(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail("expected object"); }
function text(v: unknown, max = 1024): v is string { return typeof v === "string" && v.length <= max; }
function count(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
function instant(v: unknown): number { if (!text(v, 40) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v) || !Number.isFinite(Date.parse(v))) return fail("timestamp must be a valid UTC instant"); return Date.parse(v); }
function strings(v: unknown, max: number): string[] { if (!Array.isArray(v) || v.length > max || !v.every(x => text(x) && x.length > 0) || new Set(v).size !== v.length) return fail("rule list must be bounded unique strings"); return v; }
export function trendWindow(days: number, now = Date.now()) { const to = Math.floor(now / trendHour) * trendHour + trendHour; return { from: new Date(to - days * 24 * trendHour).toISOString(), to: new Date(to).toISOString() }; }
export function trendURL(q: TrendQuery): string {
  const p = new URLSearchParams({ from: q.from, to: q.to, rulesMode: q.rulesMode, nodesMode: q.nodesMode, namespacesMode: q.namespacesMode });
  for (const [key, values] of [["rule", q.rules], ["node", q.nodes], ["namespace", q.namespaces]] as const) for (const value of values) p.append(key, value);
  return `/api/history/signal-trends?${p}`;
}
export function parseSignalTrends(raw: unknown, q: TrendQuery): SignalTrends {
  const v = object(raw), from = instant(q.from), to = instant(q.to), hours = (to - from) / trendHour;
  if (hours <= 0 || hours > 2160 || from % trendHour || to % trendHour || v.schemaVersion !== 1 || v.context !== q.context || instant(v.from) !== from || instant(v.to) !== to) fail("context, schemaVersion or query bounds mismatch");
  const asOf = v.asOf === undefined ? to : instant(v.asOf);
  if (asOf > to || asOf < 0) fail("asOf outside query bounds");
  for (const group of ["severity", "rules", "nodes", "namespaces"] as const) {
    const mode = group === "severity" ? "custom" : q[`${group}Mode`];
    const chosen = group === "severity" ? ["all"] : q[group];
    const series = v[group];
    if (!Array.isArray(series) || series.length > (group === "severity" ? 1 : mode.startsWith("top") ? 10 : 20)) fail("series array or selection bound");
    const keys = new Set<string>();
    for (const rawSeries of series as unknown[]) {
      const s = object(rawSeries);
      if (!text(s.key) || !s.key || !text(s.label) || !s.label || keys.has(s.key) || !count(s.totalScore) || !count(s.changesScore) || !Array.isArray(s.points) || s.points.length !== hours) fail("series identity, scores or point count");
      const key = s.key as string; keys.add(key);
      if (!mode.startsWith("top") && !chosen.includes(key)) fail("series key outside requested selection");
      if (group === "nodes") { let node: unknown; try { node = JSON.parse(key); } catch { fail("node key must be canonical JSON"); } if (!Array.isArray(node) || node.length !== 2 || !node.every(n => text(n, 512) && n.length > 0) || JSON.stringify(node) !== key) fail("node key must include name and UID"); }
      let total = 0, changes = 0;
      (s.points as unknown[]).forEach((rawPoint, i) => {
        const p = object(rawPoint), at = instant(p.at), sample = instant(p.sampleAt), source = instant(p.sourceAt);
        if (at !== from + i * trendHour || (p.reason !== undefined && !text(p.reason))) fail("point at or reason invalid");
        for (const key of ["coverage", "changesCoverage"] as const) {
          if (p[key] === undefined || p[key] === "") p[key] = "unknown";
          if (!["complete", "partial", "unknown"].includes(p[key] as string)) fail("point coverage invalid");
        }
        const zero = "0001-01-01T00:00:00Z", end = Math.min(at + trendHour, asOf);
        if (p.carriedForward !== undefined && typeof p.carriedForward !== "boolean") fail("point carriedForward must be boolean");
        if (p.freshness !== undefined && !["fresh", "stale", "unknown"].includes(p.freshness as string)) fail("point freshness invalid");
        if (p.sourceAgeSeconds !== undefined && p.sourceAgeSeconds !== null && !count(p.sourceAgeSeconds)) fail("point sourceAgeSeconds invalid");
        if (p.confirmedChanges !== undefined && !count(p.confirmedChanges)) fail("point confirmedChanges invalid");
        if (sample > end || source > sample || (sample < 0 && p.sampleAt !== zero) || (source < 0 && p.sourceAt !== zero)) fail("point sampleAt/sourceAt outside observation bounds");
        if (p.carriedForward && (v.asOf === undefined || p.counts === null || sample < 0 || source < 0 || p.freshness !== "stale" || !count(p.confirmedChanges) || !count(p.sourceAgeSeconds) || p.coverage === "complete")) fail("point carriedForward provenance invalid");
        if (p.counts !== null) {
          const c = object(p.counts);
          if (![c.high, c.medium, c.low, c.changes].every(count) || sample < 0 || (!p.carriedForward && sample < at) || sample >= at + trendHour || at >= asOf) fail("point counts or sampleAt outside bucket bounds");
          if (sample < at && (c.changes !== 0 || p.confirmedChanges !== 0)) fail("point confirmedChanges before bucket");
          total += (c.high as number) + (c.medium as number) + (c.low as number);
        }
        // Go timestamps retain nanoseconds; Date.parse truncates to milliseconds.
        if (p.sourceAgeSeconds !== undefined && p.sourceAgeSeconds !== null && (source < 0 || Math.abs(Number(p.sourceAgeSeconds) - Math.floor((end - source) / 1000)) > 1)) fail("point sourceAgeSeconds does not match sourceAt");
        // Empty future/pre-observation hours cannot carry transition evidence.
        if (Number(p.confirmedChanges) > 0 && (sample < 0 || sample < at || at >= asOf)) fail("point confirmedChanges without an in-bucket observation");
        changes += p.confirmedChanges === undefined ? Number((p.counts as TrendCounts | null)?.changes || 0) : p.confirmedChanges as number;
      });
      if (s.totalScore !== total || s.changesScore !== changes) fail("series scores do not match points");
    }
    if (!mode.startsWith("top") && keys.size !== chosen.length) fail("selected series missing");
    if (mode.startsWith("top")) {
      const metric = mode === "topSignals10" ? "totalScore" : "changesScore";
      const rows = series as TrendSeries[];
      for (let i = 1; i < rows.length; i++) if (rows[i - 1][metric] < rows[i][metric] || (rows[i - 1][metric] === rows[i][metric] && rows[i - 1].key > rows[i].key)) fail("series ranking mismatch");
    }
  }
  const d = object(v.diagnostics);
  for (const key of ["eligibleScopes", "evaluatedScopes", "snapshotCount", "coverageGaps", "capLosses", "retainedBytes", "databaseBytes", "retainedHours"]) if (!count(d[key])) fail("diagnostics count invalid");
  for (const key of ["coalesced", "overflow"]) if (d[key] !== undefined && !count(d[key])) fail("diagnostics loss count invalid");
  if (Number(d.evaluatedScopes) > Number(d.eligibleScopes) || (d.sourceAgeSeconds !== null && !count(d.sourceAgeSeconds))) fail("diagnostics scopes or sourceAgeSeconds invalid");
  // Go's zero time is an explicit unavailable timestamp, never a recent sample.
  instant(d.lastSample); instant(d.sourceAt);
  d.supportedRules = strings(d.supportedRules === null ? [] : d.supportedRules, 128);
  d.unsupportedRules = strings(d.unsupportedRules === null ? [] : d.unsupportedRules, 128);
  const reasons = object(d.reasons);
  if (Object.keys(reasons).length > 64 || !Object.entries(reasons).every(([key, value]) => text(key) && count(value))) fail("diagnostics reasons invalid");
  if (v.catalog !== undefined) v.catalog = parseHistoryCatalog(v.catalog);
  return v as unknown as SignalTrends;
}
export function namespaceSelection(mode: TrendMode, input: { context: string; token: string; favourites: string[]; recent: string[]; custom: string[]; tag: string; tags?: ResourceTagsSettings; inventory?: NamespaceInventory }): string[] {
  let selected: string[] = [];
  if (mode === "favourites") selected = input.favourites;
  if (mode === "recent") selected = input.recent;
  if (mode === "custom") selected = input.custom;
  if (mode === "tag" && input.tags?.enabled && input.inventory?.context === input.context && input.inventory.token === input.token) {
    const index = buildResourceTagsIndex(input.tags);
    selected = input.inventory.items.filter(item => resourceTagsForTarget(input.tags!, index, { ...item, context: input.context, resource: "namespaces", namespace: "" }).some(tag => tag.id === input.tag)).map(item => item.name);
  }
  return [...new Set(selected.filter(Boolean))];
}
export function sampleLabel(value: string): string { return value.startsWith("0001-") ? "Unavailable" : new Date(value).toLocaleString(); }
export function trendValue(point: TrendPoint | undefined, metric: keyof TrendCounts | "total"): number | null {
  if (!point) return null;
  if (metric === "total") return point.counts ? point.counts.high + point.counts.medium + point.counts.low : null;
  if (metric !== "changes") return point.counts?.[metric] ?? null;
  const value = point.confirmedChanges ?? point.counts?.changes;
  return value === undefined || (value === 0 && (!point.changesCoverage || point.changesCoverage === "unknown")) ? null : value;
}
export type ChartLine = { key: string; label: string; color?: string; points: TrendPoint[]; metric: keyof TrendCounts | "total" };
// Inspect the requested hourly window, never a coarse bucket or ranking score.
// Active lines total all severities. Changes remain independent of active-count coverage.
// Missing hours are gaps, not zero evidence. Incomplete zero subtotals cannot
// establish absence; a wholly unknown series must remain distinguishable.
export function isZeroTrendLine(line: ChartLine): boolean {
  let observed = false;
  for (const point of line.points) {
    const value = trendValue(point, line.metric);
    if (value === null) continue;
    const coverage = line.metric === "changes" ? point.changesCoverage : point.coverage;
    if (value !== 0 || coverage !== "complete") return false;
    observed = true;
  }
  return observed;
}
export function trendLines(series: TrendSeries[], mode: TrendMode, detail: "active" | "changes"): ChartLine[] {
  const metric = mode === "topChanges10" || (mode !== "topSignals10" && detail === "changes") ? "changes" : "total";
  return series.map(s => ({ key: s.key, label: s.label, points: s.points, metric }));
}
