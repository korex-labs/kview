import { expect, it } from "vitest";
import { formatTrendLegendValue, trendLegendColorIndex, trendLegendStats } from "./signalTrendsLegend";
import type { ChartLine } from "./signalTrends";

function line(values: Array<number | null>, metric: ChartLine["metric"] = "high"): ChartLine {
  return { key: "series", label: "Series", metric, points: values.map(value => ({ at: "", sampleAt: "", sourceAt: "", counts: value === null ? null : { high: value, medium: 3, low: 2, changes: 9 }, coverage: "complete", changesCoverage: "complete" })) };
}
it("excludes unknown buckets from min/mean/max, preserves zero, and never backfills Last", () => {
  expect(trendLegendStats(line([null, 0, 4, null]))).toEqual({ min: 0, avg: 2, max: 4, last: null });
  expect(trendLegendStats(line([4, null, 0]))).toEqual({ min: 0, avg: 2, max: 4, last: 0 });
  expect(trendLegendStats(line([null, null]))).toEqual({ min: null, avg: null, max: null, last: null });
  expect(trendLegendStats(line([]))).toEqual({ min: null, avg: null, max: null, last: null });
});
it("uses individual severity layers, totals and authoritative interval counts", () => {
  expect(trendLegendStats(line([1, 2], "medium")).avg).toBe(3);
  expect(trendLegendStats(line([1, 2], "total")).avg).toBe(6.5);
  const changes = line([9, 9, 9], "changes");
  changes.points.forEach((point, i) => { point.confirmedChanges = i === 0 ? 4 : 0; point.changesCoverage = i === 1 ? "unknown" : "complete"; });
  expect(trendLegendStats(changes)).toEqual({ min: 0, avg: 2, max: 4, last: 0 });
});
it("formats unknown distinctly from zero and bounds fractional averages", () => {
  expect(formatTrendLegendValue(null)).toBe("—");
  expect(formatTrendLegendValue(0)).toBe("0");
  expect(formatTrendLegendValue(1 / 3)).toBe((0.33).toLocaleString());
});
it("assigns colors by identity rather than rank or visible peers", () => {
  const keys = ["alpha", "beta", '["worker","uid"]'];
  const before = new Map(keys.map(key => [key, trendLegendColorIndex(key, 10)]));
  for (const key of keys.reverse()) expect(trendLegendColorIndex(key, 10)).toBe(before.get(key));
});
