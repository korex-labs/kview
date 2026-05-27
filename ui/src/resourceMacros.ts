import type {
  DynamicLinkDefinition,
  DynamicLinksSettings,
  ResourceMacroDefinition,
  ResourceMacroExtractorDefinition,
  ResourceMacrosSettings,
  ResourceMacroScopeRef,
} from "./settings";
import type { ListResourceKey } from "./utils/k8sResources";

export type ResourceMacroTarget = {
  context: string;
  resource: ListResourceKey;
  namespace?: string | null;
  name: string;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type ResolvedMacro = {
  name: string;
  value: string;
  rawValue: string;
  source: "manual" | "extracted";
  definitionId: string;
  scopeRank: number;
  error?: string;
};

export type MacroResolutionResult = {
  macros: Record<string, ResolvedMacro>;
  errors: string[];
};

export type ResolvedDynamicLink = {
  id: string;
  label: string;
  url: string;
};

const macroRefPattern = /\$(?:\{([A-Z][A-Z0-9_]*)\}|([A-Z][A-Z0-9_]*))/g;

function scopeRank(scope: ResourceMacroScopeRef["scope"]): number {
  switch (scope) {
    case "resource":
      return 50;
    case "node":
      return 40;
    case "namespace":
      return 30;
    case "context":
      return 20;
    case "global":
    default:
      return 10;
  }
}

function effectiveNamespace(target: ResourceMacroTarget): string {
  if (target.resource === "namespaces") return target.name;
  return target.namespace || "";
}

function scopeMatches(scope: ResourceMacroScopeRef, target: ResourceMacroTarget): boolean {
  if (scope.context && scope.context !== target.context) return false;
  switch (scope.scope) {
    case "global":
      return true;
    case "context":
      return Boolean(target.context);
    case "namespace":
      return Boolean(effectiveNamespace(target)) && (!scope.namespace || scope.namespace === effectiveNamespace(target));
    case "node":
      return Boolean(target.nodeName) && (!scope.node || scope.node === target.nodeName);
    case "resource":
      if (scope.resource && scope.resource !== target.resource) return false;
      if (scope.namespace && scope.namespace !== effectiveNamespace(target)) return false;
      return !scope.name || scope.name === target.name;
    default:
      return false;
  }
}

function resourceMatches(resources: ListResourceKey[], resource: ListResourceKey): boolean {
  return resources.length === 0 || resources.includes(resource);
}

function renderReplacementTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\$|&|`|'|\d{1,2})/g, (raw, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0] ?? "";
    if (token === "`" || token === "'") return "";
    const index = Number(token);
    if (!Number.isInteger(index)) return raw;
    return match[index] ?? "";
  });
}

function transformExtractedValue(value: string, transform: ResourceMacroExtractorDefinition["transform"]): string {
  switch (transform) {
    case "uppercase":
      return value.toUpperCase();
    case "lowercase":
      return value.toLowerCase();
    case "ucfirst":
      return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
    case "none":
    default:
      return value;
  }
}

function extractedValue(extractor: ResourceMacroExtractorDefinition, target: ResourceMacroTarget): string | null {
  if (!extractor.enabled || !resourceMatches(extractor.resources, target.resource)) return null;
  let source: string;
  if (extractor.source === "name") {
    source = target.name;
  } else if (extractor.source === "label") {
    if (!extractor.key) return null;
    source = target.labels?.[extractor.key] || "";
  } else {
    if (!extractor.key) return null;
    source = target.annotations?.[extractor.key] || "";
  }
  if (!source) return null;
  try {
    const match = source.match(new RegExp(extractor.pattern, extractor.flags));
    if (!match) return null;
    const value = transformExtractedValue(renderReplacementTemplate(extractor.valueTemplate || "$1", match).trim(), extractor.transform);
    return value || null;
  } catch {
    return null;
  }
}

function setBestMacro(macros: Map<string, ResolvedMacro>, macro: ResolvedMacro) {
  const existing = macros.get(macro.name);
  if (!existing || macro.scopeRank >= existing.scopeRank) macros.set(macro.name, macro);
}

export function resolveResourceMacros(
  settings: ResourceMacrosSettings,
  target: ResourceMacroTarget,
): MacroResolutionResult {
  if (!settings.enabled) return { macros: {}, errors: [] };
  const macros = new Map<string, ResolvedMacro>();

  for (const definition of settings.definitions) {
    if (!definition.enabled || !scopeMatches(definition.scope, target)) continue;
    setBestMacro(macros, {
      name: definition.macroName,
      value: definition.value,
      rawValue: definition.value,
      source: "manual",
      definitionId: definition.id,
      scopeRank: scopeRank(definition.scope.scope),
    });
  }

  for (const extractor of settings.extractors) {
    const value = extractedValue(extractor, target);
    if (!value) continue;
    setBestMacro(macros, {
      name: extractor.macroName,
      value,
      rawValue: value,
      source: "extracted",
      definitionId: extractor.id,
      scopeRank: 45,
    });
  }

  const errors: string[] = [];
  const resolving = new Set<string>();
  const resolved = new Map<string, string>();
  const maxDepth = Math.max(1, Math.min(20, settings.maxResolveDepth || 10));

  const resolveName = (name: string, depth: number): string => {
    const macro = macros.get(name);
    if (!macro) return `$${name}`;
    if (resolved.has(name)) return resolved.get(name) || "";
    if (depth > maxDepth) {
      macro.error = `Exceeded macro resolution depth (${maxDepth}).`;
      errors.push(`${name}: ${macro.error}`);
      return macro.rawValue;
    }
    if (resolving.has(name)) {
      macro.error = "Recursive macro cycle detected.";
      errors.push(`${name}: ${macro.error}`);
      return macro.rawValue;
    }
    resolving.add(name);
    const value = macro.rawValue.replace(macroRefPattern, (_raw, braced: string | undefined, plain: string | undefined) =>
      resolveName(braced || plain || "", depth + 1),
    );
    resolving.delete(name);
    macro.value = value;
    resolved.set(name, value);
    return value;
  };

  for (const name of macros.keys()) resolveName(name, 0);
  return { macros: Object.fromEntries(macros.entries()), errors };
}

export function unresolvedMacroNames(template: string, macros: Record<string, ResolvedMacro>): string[] {
  const missing = new Set<string>();
  for (const match of template.matchAll(macroRefPattern)) {
    const name = match[1] || match[2] || "";
    if (name && !macros[name]) missing.add(name);
  }
  return Array.from(missing);
}

export function expandMacroTemplate(template: string, macros: Record<string, ResolvedMacro>): string {
  return template.replace(macroRefPattern, (raw, braced: string | undefined, plain: string | undefined) => {
    const name = braced || plain || "";
    return macros[name]?.value ?? raw;
  });
}

function isAllowedURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function dynamicLinksForResource(
  macroSettings: ResourceMacrosSettings,
  linkSettings: DynamicLinksSettings,
  target: ResourceMacroTarget,
): ResolvedDynamicLink[] {
  if (!macroSettings.enabled || !linkSettings.enabled) return [];
  const resolved = resolveResourceMacros(macroSettings, target);
  return linkSettings.definitions
    .filter((link: DynamicLinkDefinition) => link.enabled)
    .flatMap((link) => {
      if (unresolvedMacroNames(link.urlTemplate, resolved.macros).length > 0) return [];
      const url = expandMacroTemplate(link.urlTemplate, resolved.macros);
      if (!isAllowedURL(url)) return [];
      return [{ id: link.id, label: link.label, url }];
    });
}
