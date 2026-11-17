import { trendHour, type SignalTrends, type TrendQuery, type TrendSeries } from "./signalTrends";
export function queryFromTrendURL(path: string, context = "synthetic-context"): TrendQuery {
  const p = new URL(path, "http://fixture.invalid").searchParams;
  return { context, from: p.get("from")!, to: p.get("to")!, rulesMode: p.get("rulesMode") as TrendQuery["rulesMode"], nodesMode: p.get("nodesMode") as TrendQuery["nodesMode"], namespacesMode: p.get("namespacesMode") as TrendQuery["namespacesMode"], rules: p.getAll("rule"), nodes: p.getAll("node"), namespaces: p.getAll("namespace") };
}
export function trendFixture(q: TrendQuery): SignalTrends {
  const series = (key: string, label = key): TrendSeries => ({ key, label, totalScore: 6, changesScore: 4, points: Array.from({ length: (Date.parse(q.to) - Date.parse(q.from)) / trendHour }, (_, i) => ({ at: new Date(Date.parse(q.from) + i * trendHour).toISOString(), counts: i === 0 ? { high: 2, medium: 3, low: 1, changes: 4 } : null, sampleAt: i === 0 ? q.from : "0001-01-01T00:00:00Z", sourceAt: i === 0 ? q.from : "0001-01-01T00:00:00Z", reason: i === 0 ? undefined : "no-sample" })) });
  const selected = (group: "rules" | "nodes" | "namespaces", fallback: string) => (q[`${group}Mode`].startsWith("top") ? [fallback] : q[group]).map(key => series(key, group === "nodes" ? JSON.parse(key)[0] : key));
  return { schemaVersion: 1, context: q.context, from: q.from, to: q.to, severity: [series("all")], rules: selected("rules", "synthetic_rule"), nodes: selected("nodes", '["synthetic-worker","synthetic-uid"]'), namespaces: selected("namespaces", "synthetic-apps"), diagnostics: { eligibleScopes: 5, evaluatedScopes: 3, snapshotCount: 8, supportedRules: ["synthetic_rule", "synthetic_other"], unsupportedRules: ["synthetic_unsupported"], lastSample: q.from, sourceAt: q.from, sourceAgeSeconds: 0, coverageGaps: (Date.parse(q.to) - Date.parse(q.from)) / trendHour - 1, capLosses: 2, retainedBytes: 2048, databaseBytes: 4096, retainedHours: 1, reasons: { "stale-source": 3, "source-cap": 2 } } };
}
// Publication response with original evidence outside the requested window.
export function carriedTrendFixture(q: TrendQuery): SignalTrends {
  const data = trendFixture(q);
  data.asOf = q.to;
  const sampleAt = new Date(Date.parse(q.from) - trendHour).toISOString();
  for (const group of [data.severity, data.rules, data.nodes, data.namespaces]) for (const series of group) {
    series.points = series.points.map(point => ({ ...point, counts: { high: 2, medium: 3, low: 1, changes: 0 },
      sampleAt, sourceAt: sampleAt, confirmedChanges: 0, carriedForward: true, freshness: "stale",
      sourceAgeSeconds: (Date.parse(point.at) + trendHour - Date.parse(sampleAt)) / 1000,
      coverage: "partial", changesCoverage: "unknown", reason: "last-observed" }));
    series.totalScore = series.points.length * 6; series.changesScore = 0;
  }
  data.diagnostics.lastSample = sampleAt; data.diagnostics.sourceAt = sampleAt;
  data.diagnostics.coalesced = 3; data.diagnostics.overflow = 1;
  return data;
}
export const fixtureQuery: TrendQuery = { context: "synthetic-context", from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", rulesMode: "topSignals10", nodesMode: "topSignals10", namespacesMode: "topSignals10", rules: [], nodes: [], namespaces: [] };
