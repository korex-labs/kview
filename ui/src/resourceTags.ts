import type { ResourceTagDefinition, ResourceTagsSettings } from "./settings";
import type { ListResourceKey } from "./utils/k8sResources";

export type ResourceTagTarget = {
  context: string;
  resource: ListResourceKey;
  namespace?: string | null;
  name: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type ResolvedResourceTag = ResourceTagDefinition & {
  inherited: boolean;
  source: "direct" | "auto" | "inherited";
};

export type ResourceTagsIndex = {
  definitionsById: Map<string, ResourceTagDefinition>;
  assignmentsByKey: Map<string, string[]>;
};

function keyPart(value: string | null | undefined): string {
  return encodeURIComponent((value || "").trim());
}

export function resourceTagTargetKey(target: ResourceTagTarget): string {
  return [
    keyPart(target.context),
    keyPart(target.resource),
    keyPart(target.namespace),
    keyPart(target.name),
  ].join("/");
}

export function namespaceTagTarget(context: string, namespace: string): ResourceTagTarget {
  return {
    context,
    resource: "namespaces",
    namespace: "",
    name: namespace,
  };
}

export function buildResourceTagsIndex(settings: ResourceTagsSettings): ResourceTagsIndex {
  return {
    definitionsById: new Map(settings.definitions.map((definition) => [definition.id, definition])),
    assignmentsByKey: new Map(Object.entries(settings.assignments)),
  };
}

function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function regexMatches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function autoTagRuleMatches(target: ResourceTagTarget, rule: ResourceTagsSettings["autoTagRules"][number]): boolean {
  if (!rule?.enabled) return false;
  if (rule.context && rule.context !== target.context) return false;
  if (rule.resources.length > 0 && !rule.resources.includes(target.resource)) return false;
  if (!rule.pattern.trim()) return false;

  const pattern = safeRegex(rule.pattern, rule.flags);
  if (!pattern) return false;
  if (rule.source === "name") return regexMatches(pattern, target.name);

  const values = rule.source === "label" ? target.labels : target.annotations;
  if (!values) return false;
  if (rule.key) return regexMatches(pattern, values[rule.key] || "");
  return Object.values(values).some((value) => regexMatches(pattern, value));
}

function autoTagIdsForTarget(settings: ResourceTagsSettings, target: ResourceTagTarget): string[] {
  const ids: string[] = [];
  for (const rule of settings.autoTagRules) {
    if (!rule.enabled) continue;
    if (!autoTagRuleMatches(target, rule)) continue;
    ids.push(...rule.tagIds);
  }
  return Array.from(new Set(ids));
}

export function resourceTagsForTarget(
  settings: ResourceTagsSettings,
  index: ResourceTagsIndex,
  target: ResourceTagTarget,
): ResolvedResourceTag[] {
  if (!settings.enabled) return [];
  const directIds = index.assignmentsByKey.get(resourceTagTargetKey(target)) || [];
  const autoIds = autoTagIdsForTarget(settings, target);
  const inheritedIds = [] as string[];
  if (settings.inheritNamespaceTags && target.resource !== "namespaces" && target.namespace) {
    const namespaceTarget = namespaceTagTarget(target.context, target.namespace);
    inheritedIds.push(...(index.assignmentsByKey.get(resourceTagTargetKey(namespaceTarget)) || []));
    inheritedIds.push(...autoTagIdsForTarget(settings, namespaceTarget));
  }

  const directSet = new Set(directIds);
  const autoSet = new Set(autoIds);
  const out: ResolvedResourceTag[] = [];
  const seen = new Set<string>();
  for (const id of [...directIds, ...autoIds, ...inheritedIds]) {
    if (seen.has(id)) continue;
    const definition = index.definitionsById.get(id);
    if (!definition) continue;
    seen.add(id);
    const source = directSet.has(id) ? "direct" : autoSet.has(id) ? "auto" : "inherited";
    out.push({
      ...definition,
      inherited: source === "inherited",
      source,
    });
  }
  return out;
}

export function assignmentTagIdsForTarget(settings: ResourceTagsSettings, target: ResourceTagTarget): string[] {
  if (!settings.enabled) return [];
  return settings.assignments[resourceTagTargetKey(target)] || [];
}

export function withResourceTagAssignment(
  settings: ResourceTagsSettings,
  target: ResourceTagTarget,
  tagIds: string[],
): ResourceTagsSettings {
  const allowed = new Set(settings.definitions.map((definition) => definition.id));
  const key = resourceTagTargetKey(target);
  const clean = Array.from(new Set(tagIds.filter((id) => allowed.has(id))));
  const assignments = { ...settings.assignments };
  if (clean.length === 0) {
    delete assignments[key];
  } else {
    assignments[key] = clean;
  }
  return {
    ...settings,
    assignments,
  };
}

export function cleanupResourceTagAssignmentsForScope(
  settings: ResourceTagsSettings,
  existingTargets: Iterable<ResourceTagTarget>,
  shouldCleanup: boolean,
): ResourceTagsSettings {
  if (!settings.cleanupMissingAssignments || !shouldCleanup) return settings;
  const existing = new Set(Array.from(existingTargets, resourceTagTargetKey));
  if (existing.size === 0) return settings;
  let changed = false;
  const assignments = { ...settings.assignments };
  for (const key of Object.keys(assignments)) {
    if (existing.has(key)) continue;
    const [context, resource, namespace] = key.split("/");
    const belongsToScope = Array.from(existing).some((existingKey) => {
      const [existingContext, existingResource, existingNamespace] = existingKey.split("/");
      return context === existingContext && resource === existingResource && namespace === existingNamespace;
    });
    if (!belongsToScope) continue;
    delete assignments[key];
    changed = true;
  }
  return changed ? { ...settings, assignments } : settings;
}

export function resourceTagFilterMatches(
  settings: ResourceTagsSettings,
  index: ResourceTagsIndex,
  target: ResourceTagTarget,
  query: string,
): boolean {
  if (!settings.enabled) return false;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed.startsWith("tag:")) return false;
  const wanted = trimmed.slice(4).trim();
  if (!wanted) return false;
  return resourceTagsForTarget(settings, index, target).some((tag) =>
    tag.name.toLowerCase().includes(wanted) || tag.id.toLowerCase().includes(wanted),
  );
}
