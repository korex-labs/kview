import type { SmartFilterMatchContext, SmartFilterRule } from "../settings";
import type { ResourceTagsSettings } from "../settings";
import { labelForSmartFilterRules, refreshIntervalOptions } from "../settings";
import {
  buildResourceTagsIndex,
  resourceTagsForTarget,
  type ResourceTagTarget,
} from "../resourceTags";

export type QuickFilter = {
  id: string;
  label: string;
  value: string;
  count: number;
  kind?: "search" | "tag";
  color?: string;
};

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
    .map(([k, c]) => ({ id: k, label: k, value: k, count: c, kind: "search" }));
}

export function buildTagQuickFilters<T>(
  rows: T[],
  settings: ResourceTagsSettings,
  getTarget: (row: T) => ResourceTagTarget | null,
): QuickFilter[] {
  if (!settings.enabled || !settings.quickFiltersEnabled || settings.definitions.length === 0) return [];
  const index = buildResourceTagsIndex(settings);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const target = getTarget(row);
    if (!target) continue;
    const rowTagIds = new Set(resourceTagsForTarget(settings, index, target).map((tag) => tag.id));
    for (const tagId of rowTagIds) {
      counts.set(tagId, (counts.get(tagId) || 0) + 1);
    }
  }
  return settings.definitions.flatMap((tag) => {
    const count = counts.get(tag.id) || 0;
    return count > 0
      ? [{ id: `tag:${tag.id}`, label: tag.name, value: `tag:${tag.id}`, count, kind: "tag", color: tag.color }]
      : [];
  });
}

export const refreshOptions = refreshIntervalOptions;
