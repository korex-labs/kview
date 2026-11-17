import {
  applySettingsTransferBundle,
  parseFullProfileJSON,
  parseSettingsTransferJSON,
  parseUserSettingsJSON,
  settingsTransferSectionIds,
  settingsTransferSections,
  type KviewUserSettingsV2,
  type SettingsTransferBundleV1,
  type SettingsTransferMergeStrategy,
  type SettingsTransferSection,
} from "../../settings";
import type { AppStateV1 } from "../../state";

// Exhaustive: adding a supported settings field must also add a review section.
export const fullSettingsSectionLabels = {
  appearance: "Appearance",
  history: "History chart preferences",
  logs: "Log preferences",
  smartFilters: "Smart filters",
  resourceTags: "Resource tags",
  resourceMacros: "Resource macros",
  dynamicLinks: "Dynamic links",
  savedViews: "Saved views",
  operatorProfiles: "Saved operator profiles",
  customCommands: "Custom commands",
  customActions: "Custom actions",
  keyboard: "Keyboard shortcuts",
  podDebug: "Pod Debug defaults",
  dataplane: "Dataplane settings",
} satisfies Record<Exclude<keyof KviewUserSettingsV2, "v">, string>;

type FullSettingsSection = keyof typeof fullSettingsSectionLabels;
export type SettingsImportSection = FullSettingsSection | "appState" | SettingsTransferSection;
export type SettingsImportState = { settings: KviewUserSettingsV2; appState: AppStateV1 };
export type ImportChangeKind = "added" | "changed" | "removed";
export type ImportChangeCounts = Record<ImportChangeKind, number>;
export type ImportValueChange = {
  /** JSON pointer; arrays are a single changed value, not guessed item identities. */
  path: string;
  kind: ImportChangeKind;
  before?: unknown;
  after?: unknown;
};
export type ImportNormalizationDiagnostic = Pick<ImportValueChange, "path" | "kind">;
export type SettingsImportDocument = (
  | { kind: "fullProfile"; settings: KviewUserSettingsV2; appState: AppStateV1 }
  | { kind: "userSettings"; settings: KviewUserSettingsV2 }
  | { kind: "transfer"; bundle: SettingsTransferBundleV1 }
) & { diagnostics: ImportNormalizationDiagnostic[] };

export const remoteImportSections: ReadonlySet<SettingsImportSection> = new Set([
  "signalSuppressions", "signalAcknowledgements", "signalHistory", "investigationSnapshots",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pointerKey(key: string): string { return key.replace(/~/g, "~0").replace(/\//g, "~1"); }
function equalValue(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, index) => equalValue(value, after[index]));
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = Object.keys(before);
    return keys.length === Object.keys(after).length && keys.every((key) => Object.prototype.hasOwnProperty.call(after, key) && equalValue(before[key], after[key]));
  }
  return false;
}

// Preview values only. Never feed the redacted result back into a parser or apply.
// Commands, templates, patches, links and freeform notes can embed credentials;
// conservatively hide their payloads rather than attempting to parse shell syntax.
const sensitivePath = /password|passwd|secret|token|credential|authorization|cookie|private.?key|api.?key|command|script|template|url|headers?|environment|patch|comment|notes?|markdown|investigation/i;
function previewValue(value: unknown, path: string): unknown {
  if (sensitivePath.test(path)) return "[redacted]";
  if (typeof value === "string" && /(?:https?:\/\/|bearer\s|-----BEGIN .*PRIVATE KEY|(?:password|token|secret)\s*[=:])/i.test(value)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => previewValue(item, path));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, previewValue(item, `${path}/${pointerKey(key)}`)]));
  return value;
}

/** Compare unredacted values first, then redact display values without losing counts. */
export function diffImportValues(before: unknown, after: unknown, path = ""): ImportValueChange[] {
  if (equalValue(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => {
      const child = `${path}/${pointerKey(key)}`;
      if (!Object.prototype.hasOwnProperty.call(before, key)) return [{ path: child, kind: "added" as const, after: previewValue(after[key], child) }];
      if (!Object.prototype.hasOwnProperty.call(after, key)) return [{ path: child, kind: "removed" as const, before: previewValue(before[key], child) }];
      return diffImportValues(before[key], after[key], child);
    });
  }
  return [{ path, kind: "changed", before: previewValue(before, path), after: previewValue(after, path) }];
}

function diagnostics(before: unknown, after: unknown): ImportNormalizationDiagnostic[] {
  // No discarded raw values in warnings, including unknown credentials.
  // Parsers may materialize optional undefined fields that JSON intentionally omits.
  return diffImportValues(before, JSON.parse(JSON.stringify(after)))
    // In-memory compatibility aliases are intentionally absent from canonical
    // exports; restoring them does not change the imported configuration.
    .filter(({ path, kind }) => kind !== "added" || !/(?:\/keyboard\/(?:homeRowTableNavigation|singleLetterGlobalSearch|vimTableNavigation)|\/dataplane\/global\/(?:dashboard\/restartElevatedThreshold|metrics\/(?:containerNearLimitPct|nodePressurePct)))$/.test(path))
    .map(({ path, kind }) => ({ path, kind }));
}

/** Keep each existing format intact; a recognized invalid envelope never falls through. */
export function parseSettingsImport(text: string): SettingsImportDocument {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Settings JSON is not valid."); }
  if (!isRecord(raw)) throw new Error("Settings JSON must contain an object.");
  if (raw.kind === "kview.fullProfile") {
    if (raw.version !== 1) throw new Error("Unsupported full profile version; expected version 1.");
    const profile = parseFullProfileJSON(text);
    if (!profile) throw new Error("Invalid full profile backup.");
    return {
      kind: "fullProfile", ...profile,
      diagnostics: diagnostics(raw, { kind: raw.kind, version: 1, exportedAt: raw.exportedAt, ...profile }),
    };
  }
  if (raw.kind === "kview.settingsTransfer") {
    const bundle = parseSettingsTransferJSON(text);
    return { kind: "transfer", bundle, diagnostics: diagnostics(raw, bundle) };
  }
  if (Object.prototype.hasOwnProperty.call(raw, "kind")) throw new Error("Unsupported settings document kind.");
  const settings = parseUserSettingsJSON(text);
  return { kind: "userSettings", settings, diagnostics: diagnostics(raw, settings) };
}

function availableSections(document: SettingsImportDocument): Array<{ id: SettingsImportSection; label: string }> {
  if (document.kind === "transfer") {
    const available = new Set(settingsTransferSectionIds(document.bundle));
    return settingsTransferSections.filter(({ id }) => available.has(id));
  }
  const sections: Array<{ id: SettingsImportSection; label: string }> = Object.entries(fullSettingsSectionLabels)
    .map(([id, label]) => ({ id: id as FullSettingsSection, label }));
  if (document.kind === "fullProfile") sections.push({ id: "appState", label: "Navigation, favourites and layout" });
  return sections;
}

/** Pure local projection only. Remote writes remain owned by useSettingsTransfer. */
export function projectSettingsImport(
  document: SettingsImportDocument,
  current: SettingsImportState,
  sections: readonly SettingsImportSection[],
  strategy: SettingsTransferMergeStrategy = "replaceSections",
): SettingsImportState {
  const available = availableSections(document);
  const selected = new Set(available.filter(({ id }) => sections.includes(id)).map(({ id }) => id));
  if (selected.size === 0) return current;
  if (document.kind === "transfer") {
    const local = settingsTransferSectionIds(document.bundle).filter((id) => selected.has(id) && !remoteImportSections.has(id));
    if (local.length === 0) return current;
    return applySettingsTransferBundle({ ...current, bundle: document.bundle, sections: local, strategy });
  }
  let settings = current.settings;
  for (const key of Object.keys(fullSettingsSectionLabels) as FullSettingsSection[]) {
    if (selected.has(key)) settings = { ...settings, [key]: document.settings[key] };
  }
  return {
    settings,
    appState: document.kind === "fullProfile" && selected.has("appState") ? document.appState : current.appState,
  };
}

export type SettingsImportSectionReview = {
  id: SettingsImportSection;
  label: string;
  selected: boolean;
  status: "ready" | "remoteBaselineRequired";
  changes: ImportValueChange[];
  counts: ImportChangeCounts | null;
};
function countChanges(changes: ImportValueChange[]): ImportChangeCounts {
  const counts: ImportChangeCounts = { added: 0, changed: 0, removed: 0 };
  for (const { kind } of changes) counts[kind] += 1;
  return counts;
}

/** Recompute against the current baseline on every selection/strategy change. */
export function createSettingsImportReview(
  document: SettingsImportDocument,
  current: SettingsImportState,
  selected: readonly SettingsImportSection[] = availableSections(document).map(({ id }) => id),
  strategy: SettingsTransferMergeStrategy = "replaceSections",
  normalizationAcknowledged = false,
) {
  const sections: SettingsImportSectionReview[] = availableSections(document).map(({ id, label }) => {
    const common = { id, label, selected: selected.includes(id) };
    if (remoteImportSections.has(id)) return { ...common, status: "remoteBaselineRequired", changes: [], counts: null };
    const projected = projectSettingsImport(document, current, [id], strategy);
    const changes = diffImportValues(current, projected);
    return { ...common, status: "ready", changes, counts: countChanges(changes) };
  });
  const projection = projectSettingsImport(document, current, selected, strategy);
  const localCounts = countChanges(diffImportValues(current, projection));
  const hasLocalChanges = Object.values(localCounts).some((count) => count > 0);
  const requiresRemoteBaseline = sections.some((section) => section.selected && section.status === "remoteBaselineRequired");
  return {
    sections, projection, localCounts,
    // Unknown/discarded fields and parser defaults must never be silently accepted.
    requiresNormalizationAcknowledgement: document.diagnostics.length > 0,
    requiresRemoteBaseline,
    canApply: hasLocalChanges && !requiresRemoteBaseline && (document.diagnostics.length === 0 || normalizationAcknowledged),
  };
}
