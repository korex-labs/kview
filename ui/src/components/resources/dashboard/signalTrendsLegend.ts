import { trendValue, type ChartLine } from "./signalTrends";

// Input is the displayed bucket projection, not the raw hourly window or stack totals.
export function trendLegendStats(line: ChartLine) {
  const values = line.points.map(point => trendValue(point, line.metric));
  const known = values.filter((value): value is number => value !== null);
  return {
    min: known.length ? Math.min(...known) : null,
    avg: known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null,
    max: known.length ? Math.max(...known) : null,
    last: values[values.length - 1] ?? null,
  };
}

export function formatTrendLegendValue(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Color must not depend on ranking, hidden peers, or transient highlighting.
export function trendLegendColorIndex(key: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  return hash % count;
}
