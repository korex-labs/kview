import type { ResourceTagDefinition, ResourceTagsSettings } from "./settings";
import type { ListResourceKey } from "./utils/k8sResources";

export type ResourceTagTarget = {
  context: string;
  resource: ListResourceKey;
  namespace?: string | null;
  name: string;
};

export type ResolvedResourceTag = ResourceTagDefinition & {
  inherited: boolean;
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

export function resourceTagsForTarget(
  settings: ResourceTagsSettings,
  index: ResourceTagsIndex,
  target: ResourceTagTarget,
): ResolvedResourceTag[] {
  if (!settings.enabled) return [];
  const directIds = index.assignmentsByKey.get(resourceTagTargetKey(target)) || [];
  const inheritedIds =
    settings.inheritNamespaceTags && target.resource !== "namespaces" && target.namespace
      ? index.assignmentsByKey.get(resourceTagTargetKey(namespaceTagTarget(target.context, target.namespace))) || []
      : [];

  const directSet = new Set(directIds);
  const out: ResolvedResourceTag[] = [];
  const seen = new Set<string>();
  for (const id of [...directIds, ...inheritedIds]) {
    if (seen.has(id)) continue;
    const definition = index.definitionsById.get(id);
    if (!definition) continue;
    seen.add(id);
    out.push({
      ...definition,
      inherited: !directSet.has(id),
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
