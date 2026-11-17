// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { effectiveHistoryNamespaceRanking, historyNamespaceRankings, normalizeHistoryContextPreferences, normalizeHistoryPreferences } from "./historyPreferences";
import { addOperatorProfile, applyOperatorProfile, defaultUserSettings, exportFullProfileJSON, exportUserSettingsJSON, loadUserSettings, parseFullProfileJSON, parseUserSettingsJSON, saveUserSettings, validateUserSettings } from "./settings";

afterEach(() => localStorage.clear());
it("projects optional namespace rankings without mutating persisted preferences", () => {
  const off = { favourites: false, recent: false, tags: false, tagIds: ["synthetic-tag"] };
  expect(historyNamespaceRankings(off)).toEqual(["topSignals10", "topChanges10", "custom"]);
  for (const mode of ["favourites", "recent", "tag"] as const) {
    expect(effectiveHistoryNamespaceRanking(mode, "synthetic-tag", off)).toBe("topSignals10");
    expect(effectiveHistoryNamespaceRanking(mode, "synthetic-tag", { ...off, [mode === "tag" ? "tags" : mode]: true })).toBe(mode);
  }
  for (const mode of ["topSignals10", "topChanges10", "custom"] as const) expect(effectiveHistoryNamespaceRanking(mode, "", off)).toBe(mode);
  expect(effectiveHistoryNamespaceRanking("tag", "missing", { ...off, tags: true })).toBe("topSignals10");
  expect(effectiveHistoryNamespaceRanking("tag", "", { ...off, tags: true, tagIds: [] })).toBe("topSignals10");
  expect(effectiveHistoryNamespaceRanking("tag", "", { ...off, tags: true })).toBe("tag");
});
it("migrates saved Top High rankings through settings and profile normalization without losing context", () => {
  const context = { rulesMode: "topHigh10", nodesMode: "topHigh10", namespaceMode: "topHigh10", rules: ["retained"], nodes: ['["worker","uid"]'], namespaces: ["apps"], tag: "tag-a" };
  const history = { days: 30, hours: 6, contexts: { "exact context": context, other: { ...context, rulesMode: "custom", nodesMode: "topChanges10", namespaceMode: "tag" } } };
  const expected = normalizeHistoryPreferences(history);
  expect(expected).toMatchObject({ days: 30, hours: 6, contexts: { "exact context": { ...context, rulesMode: "topSignals10", nodesMode: "topSignals10", namespaceMode: "topSignals10" }, other: history.contexts.other } });
  const raw = { ...defaultUserSettings(), history };
  expect(parseUserSettingsJSON(JSON.stringify(raw)).history).toEqual(expected);
  const profile = addOperatorProfile(defaultUserSettings(), { name: "Migrated history" });
  const serialized = JSON.parse(exportUserSettingsJSON(profile));
  serialized.operatorProfiles.definitions[0].snapshot.history = history;
  const imported = parseUserSettingsJSON(JSON.stringify(serialized));
  expect(applyOperatorProfile(imported, imported.operatorProfiles.activeProfileId).history).toEqual(expected);
});
const node = '["synthetic-worker","synthetic-uid"]';
it("defaults missing and unsupported options safely, including Node Top signals", () => {
  for (const input of [undefined, null, [], false, { days: -1, hours: "24", contexts: [] }]) expect(normalizeHistoryPreferences(input)).toEqual({ days: 1, hours: 1, contexts: {} });
  const fallback = normalizeHistoryContextPreferences();
  expect(fallback).toMatchObject({ rulesMode: "topSignals10", nodesMode: "topSignals10", namespaceMode: "topSignals10" });
  expect(normalizeHistoryContextPreferences({ rulesMode: "tag", nodesMode: "favourites", namespaceMode: "invalid" })).toEqual(fallback);
  expect(validateUserSettings({ v: 1 })?.history).toEqual(normalizeHistoryPreferences());
  expect(validateUserSettings({ v: 2 })?.history).toEqual(normalizeHistoryPreferences());
});
it("preserves valid modes, explicit empty Custom, exact bounded identities and drops malformed values", () => {
  expect(normalizeHistoryContextPreferences({ nodesMode: "topChanges10" }).nodesMode).toBe("topChanges10");
  expect(normalizeHistoryContextPreferences({ nodesMode: "custom", nodes: [] })).toMatchObject({ nodesMode: "custom", nodes: [] });
  expect(normalizeHistoryContextPreferences({ nodes: [node, node, "worker", '[ "worker", "uid" ]'], namespaces: ["synthetic-apps", "synthetic-apps", false, "", "x".repeat(1025)], tag: "synthetic-tag" })).toMatchObject({ nodes: [node], namespaces: ["synthetic-apps"], tag: "synthetic-tag" });
  expect(normalizeHistoryContextPreferences({ rules: Array.from({ length: 25 }, (_, i) => `rule-${i}`) }).rules).toHaveLength(20);
});
it("round-trips through existing settings, full backups and operator profiles without losing independent contexts or false settings", () => {
  const settings = defaultUserSettings();
  settings.history = normalizeHistoryPreferences({ days: 30, hours: 6, contexts: {
    "synthetic-a": { nodesMode: "custom", nodes: [node], namespaceMode: "tag", tag: "synthetic-tag" },
    "synthetic-b": { nodesMode: "topChanges10", namespaceMode: "custom", namespaces: [] },
  } });
  settings.logs.pretty = false; settings.logs.wrap = false;
  settings.resourceTags.enabled = false;
  saveUserSettings(settings);
  const full = parseFullProfileJSON(exportFullProfileJSON({ settings, appState: { v: 1, favouriteNamespacesByContext: {} } }))!;
  const profile = addOperatorProfile(settings, { name: "Synthetic history" });
  const imported = parseUserSettingsJSON(exportUserSettingsJSON(profile));
  const applied = applyOperatorProfile({ ...imported, history: normalizeHistoryPreferences() }, imported.operatorProfiles.activeProfileId);
  for (const result of [loadUserSettings(), parseUserSettingsJSON(exportUserSettingsJSON(settings)), full.settings, applied]) {
    expect(result.history).toEqual(settings.history);
    expect(result.logs.pretty).toBe(false); expect(result.logs.wrap).toBe(false);
    expect(result.resourceTags.enabled).toBe(false);
  }
  const legacy = JSON.parse(exportUserSettingsJSON(profile));
  delete legacy.operatorProfiles.definitions[0].snapshot.history;
  expect(parseUserSettingsJSON(JSON.stringify(legacy)).operatorProfiles.definitions[0].snapshot.history).toEqual(normalizeHistoryPreferences());
});
