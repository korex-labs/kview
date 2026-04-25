import type { SmartFilterMatchContext, SmartFilterRule } from "../settings";
import { labelForSmartFilterRules, refreshIntervalOptions } from "../settings";

export type QuickFilter = { id: string; label: string; value: string; count: number };

export function buildQuickFilters<T>(
  rows: T[],
  getKey: (row: T) => string,
  rules: SmartFilterRule[],
  matchContext: SmartFilterMatchContext,
  minCount = 3,
): QuickFilter[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const name = getKey(row) || "";
    const key = labelForSmartFilterRules(name, rules, matchContext);
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ id: k, label: k, value: k, count: c }));
}

export const refreshOptions = refreshIntervalOptions;
