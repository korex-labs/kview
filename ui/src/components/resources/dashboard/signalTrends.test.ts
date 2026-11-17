import { describe, expect, it } from "vitest";
import { defaultResourceTagsSettings } from "../../../settings";
import { isZeroTrendLine, namespaceSelection, parseSignalTrends, trendLines, trendURL, trendWindow, trendValue, type SignalTrends } from "./signalTrends";
import { chartBuckets } from "./SignalTrendsChart";
import { fixtureQuery as q, carriedTrendFixture, trendFixture } from "./signalTrends.testFixtures";

describe("bounded retained signal trends", () => {
  it("reports a safe field reason without echoing response identifiers", () => {
    const data = trendFixture(q);
    data.context = "synthetic-private-context";
    expect(() => parseSignalTrends(data, q)).toThrow("context, schemaVersion or query bounds mismatch");
    expect(() => parseSignalTrends(data, q)).not.toThrow(/synthetic-private-context/);
    data.context = q.context;
    data.severity[0].points[0].sourceAgeSeconds = -1;
    expect(() => parseSignalTrends(data, q)).toThrow("point sourceAgeSeconds invalid");
  });
  it("accepts exact context, aligned complete timelines and explicit nulls without filling zeros", () => {
    const data = parseSignalTrends(trendFixture(q), q);
    expect(data.severity[0].points[1].counts).toBeNull();
    expect(trendLines(data.nodes, "topChanges10", "active")[0].metric).toBe("changes");
    expect(trendLines(data.rules, "topSignals10", "changes")[0].metric).toBe("total");
  });
  const mutations: Array<[string, (d: SignalTrends) => void]> = [
    ["context", d => { d.context = "wrong"; }], ["version", d => { d.schemaVersion = 2 as 1; }],
    ["range", d => { d.to = "2026-01-03T00:00:00Z"; }], ["missing hour", d => { d.rules[0].points.pop(); }],
    ["unaligned hour", d => { d.rules[0].points[1].at = q.from; }], ["negative count", d => { d.rules[0].points[0].counts!.high = -1; }],
    ["score mismatch", d => { d.rules[0].changesScore = 0; }], ["unsafe count", d => { d.diagnostics.snapshotCount = Number.MAX_SAFE_INTEGER + 1; }],
    ["node key", d => { d.nodes[0].key = "synthetic-worker"; }], ["duplicates", d => { d.rules.push(d.rules[0]); }],
    ["top bound", d => { d.rules = Array.from({ length: 11 }, (_, i) => ({ ...d.rules[0], key: String(i) })); }],
    ["long label", d => { d.nodes[0].label = "x".repeat(1025); }], ["null object", d => { d.diagnostics.reasons = null as never; }],
    ["future source", d => { d.rules[0].points[0].sourceAt = q.to; }], ["missing metadata", d => { delete (d.rules[0].points[0] as Partial<typeof d.rules[0]["points"][0]>).sampleAt; }],
    ["reason bound", d => { d.diagnostics.reasons = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), 1])); }],
  ];
  it.each(mutations)("rejects %s", (_, mutate) => { const data = trendFixture(q); mutate(data); expect(() => parseSignalTrends(data, q)).toThrow(/Invalid or mismatched/); });
  it("checks fixed period ranking and selected membership, not per-point sorting", () => {
    const data = trendFixture(q); data.rules.push({ ...data.rules[0], key: "aaa" });
    expect(() => parseSignalTrends(data, q)).toThrow();
    data.rules.reverse(); expect(parseSignalTrends(data, q).rules.map(s => s.key)).toEqual(["aaa", "synthetic_rule"]);
    expect(() => parseSignalTrends(data, { ...q, rulesMode: "custom", rules: ["synthetic_rule"] })).toThrow();
  });
  it("sums individual transitions for coarser intervals and never sums active counts and retains last evidence with degraded coverage", () => {
    const point = trendFixture(q).severity[0].points[0];
    const points = [point, { ...point, counts: { high: 2, medium: 3, low: 1, changes: 2 } }];
    expect(chartBuckets(points, 2)[0].counts).toEqual({ high: 2, medium: 3, low: 1, changes: 6 });
    expect(chartBuckets([...points, { ...point, counts: null }], 6)[0]).toMatchObject({ counts: { high: 2, changes: 6 }, coverage: "unknown" });
  });
  it("preserves partial subtotals, defaults legacy coverage to unknown and accepts zero source time", () => {
    const data = trendFixture(q);
    const point = data.nodes[0].points[0];
    Object.assign(point, { coverage: "partial", reason: "membership-unknown", sourceAt: "0001-01-01T00:00:00Z" });
    Object.assign(data.diagnostics, { supportedRules: null, unsupportedRules: null });
    const parsed = parseSignalTrends(data, q);
    expect(parsed.nodes[0].points[0]).toMatchObject({ coverage: "partial", counts: { high: 2, changes: 4 } });
    expect(parsed.severity[0].points[0].coverage).toBe("unknown");
    expect(parsed.diagnostics.supportedRules).toEqual([]);
    expect(parsed.diagnostics.unsupportedRules).toEqual([]);
    expect(chartBuckets([point, { ...point, coverage: "complete" }], 2)[0]).toMatchObject({ coverage: "partial", counts: { high: 2, changes: 8 } });
    // A confirmed disappearance can retain transitions without an active source.
    point.counts = { high: 0, medium: 0, low: 0, changes: 1 };
    data.nodes[0].totalScore = 0; data.nodes[0].changesScore = 1;
    expect(parseSignalTrends(data, q).nodes[0].points[0].counts).toEqual({ high: 0, medium: 0, low: 0, changes: 1 });
    Object.assign(point, { coverage: "invented" });
    expect(() => parseSignalTrends(data, q)).toThrow();
  });
  it.each(["complete", "partial", "unknown"] as const)("parses independent changes coverage %s and worst-degrades coarse subtotals", changesCoverage => {
    const data = trendFixture(q);
    const point = data.rules[0].points[0];
    Object.assign(point, { coverage: "complete", changesCoverage });
    expect(parseSignalTrends(data, q).rules[0].points[0]).toMatchObject({ coverage: "complete", changesCoverage, counts: { changes: 4 } });
    expect(chartBuckets([point, { ...point, changesCoverage: "complete" }], 2, "changes")[0]).toMatchObject({ coverage: "complete", changesCoverage, counts: { changes: 8 } });
    expect(chartBuckets([point, { ...point, counts: null }], 2, "changes")[0]).toMatchObject({ changesCoverage: "unknown", counts: { changes: 4 } });
  });
  it("does not infer transition coverage from active coverage or confirmed counts", () => {
    const data = trendFixture(q);
    Object.assign(data.rules[0].points[0], { coverage: "complete" });
    expect(parseSignalTrends(data, q).rules[0].points[0].changesCoverage).toBe("unknown");
    Object.assign(data.rules[0].points[0], { changesCoverage: "invented" });
    expect(() => parseSignalTrends(data, q)).toThrow();
    expect(chartBuckets([{ ...trendFixture(q).rules[0].points[0], counts: null }], 2, "changes")[0].counts).toBeNull();
  });
  it("accepts independent projection totals without equating node memberships to global severity", () => {
    const data = trendFixture(q);
    data.nodes[0].points[0].counts!.high = 7;
    data.nodes[0].totalScore = 11;
    data.nodes[0].points[0].coverage = "partial";
    data.severity[0].points[0].coverage = "complete";
    const parsed = parseSignalTrends(data, q);
    expect(parsed.nodes[0].points[0].counts?.high).toBe(7);
    expect(parsed.severity[0].points[0].counts?.high).toBe(2);
    expect(parsed.nodes[0].points[0].coverage).toBe("partial");
    expect(parsed.severity[0].points[0].coverage).toBe("complete");
  });
  it("uses the existing generic node ranking field and plots all active severities in Node Top signals mode", () => {
    const query = { ...q, nodesMode: "topSignals10" as const };
    const data = parseSignalTrends(trendFixture(query), query);
    const url = new URL(trendURL(query), "http://fixture.invalid");
    expect(url.searchParams.get("nodesMode")).toBe("topSignals10");
    expect(url.searchParams.getAll("node")).toEqual([]);
    expect(trendLines(data.nodes, query.nodesMode, "active")[0].metric).toBe("total");
    expect(trendValue(data.nodes[0].points[0], "high")).toBe(2);
    expect(trendValue(data.nodes[0].points[0], "changes")).toBe(4);
  });
  it("uses one bounded range query with exact repeated keys", () => {
    const node = '["synthetic-worker","synthetic-uid"]';
    const p = new URL(trendURL({ ...q, nodesMode: "custom", nodes: [node] }), "http://fixture.invalid");
    expect(p.pathname).toBe("/api/history/signal-trends"); expect(p.searchParams.getAll("node")).toEqual([node]);
    expect(trendWindow(1, Date.parse("2026-01-01T12:30:00Z"))).toEqual({ from: "2025-12-31T13:00:00.000Z", to: "2026-01-01T13:00:00.000Z" });
  });
});
describe("publication carry-forward wire contract", () => {
  it("parses overnight carry from outside the window without inventing observations or events", () => {
    const data = parseSignalTrends(carriedTrendFixture(q), q), points = data.severity[0].points;
    expect(points).toHaveLength(24);
    expect(points.every(p => p.sampleAt === "2025-12-31T23:00:00.000Z" && p.counts?.high === 2)).toBe(true);
    expect(data.severity[0].totalScore).toBe(144);
    expect(data.severity[0].changesScore).toBe(0);
    expect(points.every(p => trendValue(p, "changes") === null)).toBe(true);
    const coarse = chartBuckets(points, 24)[0];
    expect(coarse).toMatchObject({ sampleAt: points[0].sampleAt, sourceAt: points[0].sourceAt, carriedForward: true, freshness: "stale", sourceAgeSeconds: 90000, coverage: "partial", changesCoverage: "unknown", counts: { high: 2 } });
  });
  it.each(["unmarked", "future", "no-source", "no-sample", "fresh", "no-asof", "event", "invented-age"])("rejects invalid carried provenance: %s", mutation => {
    const data = carriedTrendFixture(q), point = data.rules[0].points[0];
    if (mutation === "unmarked") point.carriedForward = false;
    if (mutation === "future") point.sampleAt = q.to;
    if (mutation === "no-source") point.sourceAt = "0001-01-01T00:00:00Z";
    if (mutation === "no-sample") point.sampleAt = "0001-01-01T00:00:00Z";
    if (mutation === "fresh") point.freshness = "fresh";
    if (mutation === "no-asof") delete data.asOf;
    if (mutation === "event") { point.confirmedChanges = 1; data.rules[0].changesScore = 1; }
    if (mutation === "invented-age") point.sourceAgeSeconds = 0;
    expect(() => parseSignalTrends(data, q)).toThrow();
  });
  it("does not fill before first evidence or plot future evidence beyond asOf", () => {
    const data = trendFixture(q); data.asOf = "2026-01-01T00:30:00Z";
    expect(parseSignalTrends(data, q).severity[0].points[1].counts).toBeNull();
    data.rules[0].points[0].sampleAt = "2026-01-01T00:31:00Z";
    expect(() => parseSignalTrends(data, q)).toThrow();
  });
  it("ranks and plots independent confirmed changes despite null active counts", () => {
    const data = trendFixture(q), series = data.rules[0], point = series.points[0];
    Object.assign(point, { counts: null, confirmedChanges: 7, changesCoverage: "partial" });
    series.totalScore = 0; series.changesScore = 7;
    const parsed = parseSignalTrends(data, q).rules[0].points;
    expect(trendValue(parsed[0], "changes")).toBe(7);
    expect(trendValue(parsed[1], "changes")).toBeNull();
    expect(chartBuckets(parsed, 6, "changes")[0]).toMatchObject({ counts: null, confirmedChanges: 7, changesCoverage: "unknown" });
    series.changesScore = 0;
    expect(() => parseSignalTrends(data, q)).toThrow();
  });
  it("keeps legacy missing metadata unknown and an explicit confirmed lower bound independent", () => {
    const point = parseSignalTrends(trendFixture(q), q).rules[0].points[0];
    expect(point.coverage).toBe("unknown");
    expect(trendValue({ ...point, confirmedChanges: 2 }, "changes")).toBe(2);
    expect(trendValue({ ...point, counts: { ...point.counts!, changes: 0 } }, "changes")).toBeNull();
    expect(trendValue({ ...point, counts: null, confirmedChanges: 0, changesCoverage: "complete" }, "changes")).toBe(0);
  });
});
describe("whole-window zero-only display filtering", () => {
  const base = trendFixture(q).rules[0];
  const zero = { ...base.points[0], counts: { high: 0, medium: 0, low: 0, changes: 0 }, coverage: "complete" as const, changesCoverage: "complete" as const };
  const line = (points: typeof base.points, mode: "topSignals10" | "topChanges10" | "custom" = "topSignals10") => trendLines([{ ...base, points }], mode, "active")[0];
  it("hides exact observed zero, but never empty, unknown-only or incomplete zero", () => {
    expect(isZeroTrendLine(line([zero, zero]))).toBe(true);
    expect(isZeroTrendLine(line([zero, { ...zero, counts: null }]))).toBe(true);
    expect(isZeroTrendLine(line([]))).toBe(false);
    expect(isZeroTrendLine(line([{ ...zero, counts: null }]))).toBe(false);
    for (const coverage of ["partial", "unknown", undefined] as const) expect(isZeroTrendLine(line([{ ...zero, coverage }]))).toBe(false);
  });
  it("filters each plotted measure independently despite other severities and confirmed changes", () => {
    const point = { ...zero, counts: { high: 0, medium: 3, low: 4, changes: 5 }, confirmedChanges: 5, changesCoverage: "unknown" as const };
    expect(isZeroTrendLine(line([point]))).toBe(false);
    expect(isZeroTrendLine(line([point], "topChanges10"))).toBe(false);
    expect(isZeroTrendLine({ ...line([point]), metric: "medium" })).toBe(false);
    expect(isZeroTrendLine({ ...line([point]), metric: "low" })).toBe(false);
    expect(isZeroTrendLine(line([{ ...point, counts: null }]))).toBe(false);
  });
  it("retains an earlier exact positive even when the coarse last value is zero", () => {
    const original = line([{ ...zero, counts: { ...zero.counts, high: 1 } }, zero]);
    expect(chartBuckets(original.points, 24)[0].counts?.high).toBe(0);
    expect(isZeroTrendLine(original)).toBe(false);
    expect(isZeroTrendLine(line([zero]))).toBe(true); // a different requested period
  });
  it("uses confirmed events independently of unchanged active counts and coverage", () => {
    const changed = { ...zero, confirmedChanges: 2, changesCoverage: "unknown" as const };
    expect(isZeroTrendLine(line([changed, zero], "topChanges10"))).toBe(false);
    expect(isZeroTrendLine(line([{ ...changed, counts: null }], "topChanges10"))).toBe(false);
    expect(isZeroTrendLine(line([zero], "topChanges10"))).toBe(true);
    expect(isZeroTrendLine(line([{ ...zero, changesCoverage: "unknown" }], "topChanges10"))).toBe(false);
  });
  it("leaves Custom input identities and point arrays unchanged", () => {
    const source = [{ ...base, points: [zero] }], before = structuredClone(source);
    const lines = trendLines(source, "custom", "active");
    expect(lines.filter(item => !isZeroTrendLine(item))).toEqual([]);
    expect(source).toEqual(before);
    expect(lines[0].points).toBe(source[0].points);
  });
});
describe("all-severity active totals", () => {
  it.each(["topSignals10", "custom", "favourites", "recent", "tag"] as const)("plots totals in %s, preserving null, partial and carry evidence", mode => {
    const source = trendFixture(q).nodes[0];
    source.points[0] = { ...source.points[0], counts: { high: 0, medium: 50, low: 1, changes: 9 }, coverage: "partial", carriedForward: true };
    const line = trendLines([source], mode, "active")[0];
    expect(line.metric).toBe("total");
    expect(trendValue(line.points[0], line.metric)).toBe(51);
    expect(trendValue(line.points[1], line.metric)).toBeNull();
    expect(isZeroTrendLine(line)).toBe(false);
    const coarse = chartBuckets(line.points, 6, "total")[0];
    expect(trendValue(coarse, "total")).toBe(51);
    expect(coarse).toMatchObject({ coverage: "unknown", carriedForward: true });
  });
  it("validates ranking by summed total rather than High and rejects wrong scores/order", () => {
    const data = trendFixture(q), first = data.nodes[0];
    first.points[0].counts = { high: 1, medium: 50, low: 0, changes: 4 }; first.totalScore = 51;
    const second = structuredClone(first); second.key = '["high-worker","uid"]';
    second.points[0].counts = { high: 10, medium: 0, low: 0, changes: 4 }; second.totalScore = 10;
    data.nodes.push(second);
    expect(parseSignalTrends(data, q).nodes.map(s => s.totalScore)).toEqual([51, 10]);
    first.totalScore = 1; expect(() => parseSignalTrends(data, q)).toThrow(/scores/);
    first.totalScore = 51; data.nodes.reverse(); expect(() => parseSignalTrends(data, q)).toThrow(/ranking/);
  });
});
describe("current namespace selection", () => {
  const input = { context: "synthetic-context", token: "synthetic-token", favourites: ["apps", "apps"], recent: ["recent"], custom: ["custom"], tag: "team", inventory: { context: "synthetic-context", token: "synthetic-token", items: [{ name: "apps" }, { name: "other" }] } };
  it("uses exact current favourites/recent and preserves overflow for explicit blocking", () => {
    expect(namespaceSelection("favourites", input)).toEqual(["apps"]); expect(namespaceSelection("recent", input)).toEqual(["recent"]);
    expect(namespaceSelection("custom", input)).toEqual(["custom"]);
    expect(namespaceSelection("favourites", { ...input, favourites: Array.from({ length: 21 }, (_, i) => `ns-${i}`) })).toHaveLength(21);
  });
  it("requires enabled tags and exact context/token inventory, never assignment-key namespace guesses", () => {
    const tags = { ...defaultResourceTagsSettings(), enabled: true, definitions: [{ id: "team", name: "Team", color: "#123456" }], assignments: { "synthetic-context/namespaces//apps": ["team"], "synthetic-context/namespaces//deleted": ["team"], "wrong/namespaces//other": ["team"] } };
    expect(namespaceSelection("tag", { ...input, tags })).toEqual(["apps"]);
    expect(namespaceSelection("tag", { ...input, tags: { ...tags, enabled: false } })).toEqual([]);
    expect(namespaceSelection("tag", { ...input, tags, context: "wrong" })).toEqual([]);
    expect(namespaceSelection("tag", { ...input, tags, token: "other" })).toEqual([]);
  });
  it("resolves enabled auto-tag rules against actual namespace names/metadata", () => {
    const tags = { ...defaultResourceTagsSettings(), enabled: true, definitions: [{ id: "team", name: "Team", color: "#123456" }], autoTagRules: [{ id: "rule", enabled: true, tagIds: ["team"], context: input.context, resources: ["namespaces" as const], source: "name" as const, key: "", pattern: "^app", flags: "" }] };
    expect(namespaceSelection("tag", { ...input, tags })).toEqual(["apps"]);
    expect(namespaceSelection("tag", { ...input, tags: { ...tags, autoTagRules: [{ ...tags.autoTagRules[0], source: "label", key: "team", pattern: "ops" }] } })).toEqual([]);
  });
});
