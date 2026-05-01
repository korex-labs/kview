import type { Section } from "../state";
import { getResourceLabel, type ListResourceKey } from "../utils/k8sResources";

export type KeyboardCommandAction =
  | { type: "section"; section: Section }
  | { type: "namespace"; namespace: string }
  | { type: "context"; context: string }
  | { type: "settings" };

export type CommandSuggestion = {
  value: string;
  label: string;
  description: string;
  category: "Resource" | "Namespace" | "Context" | "App";
  aliases?: string[];
  action: KeyboardCommandAction;
};

const resourceAliases: Record<Section, string[]> = {
  dashboard: ["dashboard", "dash"],
  pods: ["pods", "pod", "po"],
  nodes: ["nodes", "node", "no"],
  namespaces: ["namespaces", "namespace", "ns"],
  deployments: ["deployments", "deployment", "deploy", "dp"],
  daemonsets: ["daemonsets", "daemonset", "ds"],
  statefulsets: ["statefulsets", "statefulset", "sts"],
  replicasets: ["replicasets", "replicaset", "rs"],
  jobs: ["jobs", "job"],
  cronjobs: ["cronjobs", "cronjob", "cj"],
  horizontalpodautoscalers: ["horizontalpodautoscalers", "horizontalpodautoscaler", "hpa"],
  services: ["services", "service", "svc"],
  ingresses: ["ingresses", "ingress", "ing"],
  configmaps: ["configmaps", "configmap", "cm"],
  secrets: ["secrets", "secret"],
  serviceaccounts: ["serviceaccounts", "serviceaccount", "sa"],
  roles: ["roles", "role"],
  rolebindings: ["rolebindings", "rolebinding", "rb"],
  clusterroles: ["clusterroles", "clusterrole", "cr"],
  clusterrolebindings: ["clusterrolebindings", "clusterrolebinding", "crb"],
  persistentvolumes: ["persistentvolumes", "persistentvolume", "pv"],
  persistentvolumeclaims: ["persistentvolumeclaims", "persistentvolumeclaim", "pvc"],
  customresourcedefinitions: ["customresourcedefinitions", "customresourcedefinition", "crd", "crds"],
  customresources: ["customresources", "customresource", "crs"],
  clusterresources: ["clusterresources", "clusterresource"],
  helm: ["helm", "helmreleases", "helmrelease", "releases"],
  helmcharts: ["helmcharts", "helmchart", "charts"],
};

const aliasToSection = new Map<string, Section>();
for (const [section, aliases] of Object.entries(resourceAliases) as Array<[Section, string[]]>) {
  for (const alias of aliases) aliasToSection.set(alias, section);
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/^:/, "").trim().toLowerCase();
}

function compact(value: string): string {
  return normalizeCommand(value).replace(/[\s:_/-]+/g, "");
}

function fuzzyIncludes(candidate: string, query: string): boolean {
  if (!query) return true;
  let queryIndex = 0;
  for (const ch of candidate) {
    if (ch === query[queryIndex]) queryIndex += 1;
    if (queryIndex >= query.length) return true;
  }
  return false;
}

function suggestionScore(suggestion: CommandSuggestion, query: string): number {
  const q = normalizeCommand(query);
  if (!q) return 0;
  const qCompact = compact(q);
  const values = [
    suggestion.value,
    suggestion.label,
    suggestion.description,
    ...(suggestion.aliases || []),
  ].map((v) => normalizeCommand(v));
  const compactValues = values.map(compact);

  if (values.some((value) => value === q)) return 1;
  if (compactValues.some((value) => value === qCompact)) return 2;
  if (values.some((value) => value.startsWith(q))) return 3;
  if (compactValues.some((value) => value.startsWith(qCompact))) return 4;
  if (values.some((value) => value.includes(q))) return 5;
  if (compactValues.some((value) => value.includes(qCompact))) return 6;
  if (compactValues.some((value) => fuzzyIncludes(value, qCompact))) return 8;
  return Number.POSITIVE_INFINITY;
}

export function resourceCommandSuggestions(): CommandSuggestion[] {
  return (Object.keys(resourceAliases) as Section[]).map((section) => {
    const primary = resourceAliases[section][0];
    const label = getResourceLabel(section as ListResourceKey);
    return {
      value: `:${primary}`,
      label,
      description: `Go to ${label}`,
      category: "Resource",
      aliases: resourceAliases[section].slice(1),
      action: { type: "section", section },
    };
  });
}

export function buildCommandSuggestions({
  query,
  namespaces,
  contexts,
}: {
  query: string;
  namespaces: string[];
  contexts: string[];
}): CommandSuggestion[] {
  const resourceSuggestions = resourceCommandSuggestions();
  const namespaceSuggestions = namespaces.map((namespace) => ({
    value: `:ns ${namespace}`,
    label: `Namespace: ${namespace}`,
    description: "Switch namespace",
    category: "Namespace" as const,
    aliases: ["ns", "namespace"],
    action: { type: "namespace", namespace } as KeyboardCommandAction,
  }));
  const contextSuggestions = contexts.map((context) => ({
    value: `:ctx ${context}`,
    label: `Context: ${context}`,
    description: "Switch context",
    category: "Context" as const,
    aliases: ["ctx", "context"],
    action: { type: "context", context } as KeyboardCommandAction,
  }));
  const settingsSuggestion: CommandSuggestion = {
    value: ":settings",
    label: "Settings",
    description: "Open settings",
    category: "App",
    aliases: ["preferences"],
    action: { type: "settings" },
  };

  return [...resourceSuggestions, ...namespaceSuggestions, ...contextSuggestions, settingsSuggestion]
    .map((suggestion) => ({ suggestion, score: suggestionScore(suggestion, query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const categoryOrder = ["Resource", "Namespace", "Context", "App"];
      const ca = categoryOrder.indexOf(a.suggestion.category);
      const cb = categoryOrder.indexOf(b.suggestion.category);
      if (ca !== cb) return ca - cb;
      return a.suggestion.label.localeCompare(b.suggestion.label);
    })
    .map((item) => item.suggestion)
    .slice(0, 12);
}

export function parseKeyboardCommand(raw: string, namespaces: string[], contexts: string[]): KeyboardCommandAction | null {
  const command = raw.trim().replace(/^:/, "").trim();
  if (!command) return null;
  const commandLower = command.toLowerCase();

  if (commandLower === "settings" || commandLower === "preferences") return { type: "settings" };

  const [rawHead, ...tail] = command.split(/\s+/);
  const head = rawHead.toLowerCase();
  const arg = tail.join(" ").trim();
  const argLower = arg.toLowerCase();

  if (head === "ns" || head === "namespace") {
    if (!arg) return null;
    const match = namespaces.find((namespace) => namespace.toLowerCase() === argLower) || arg;
    return { type: "namespace", namespace: match };
  }

  if (head === "ctx" || head === "context") {
    if (!arg) return null;
    const match = contexts.find((context) => context.toLowerCase() === argLower) || arg;
    return { type: "context", context: match };
  }

  const section = aliasToSection.get(head);
  if (section) return { type: "section", section };

  return null;
}

export function aliasesForSection(section: Section): string[] {
  return resourceAliases[section] || [];
}
