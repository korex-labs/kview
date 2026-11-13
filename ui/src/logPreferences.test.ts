// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { normalizeLogPreferences, logLineOptions } from "./logPreferences";
import {
  addOperatorProfile, applyOperatorProfile, applySettingsTransferBundle,
  defaultUserSettings, exportFullProfileJSON, exportSettingsTransferJSON,
  exportUserSettingsJSON, loadUserSettings, parseFullProfileJSON,
  parseSettingsTransferJSON, parseUserSettingsJSON, saveUserSettings,
  settingsTransferSectionIds, USER_SETTINGS_KEY, validateUserSettings,
} from "./settings";
import type { AppStateV1 } from "./state";

const chosen = { lines: 1000, pretty: false, wrap: false };
const defaults = { lines: 100, pretty: true, wrap: true };
const appState: AppStateV1 = { v: 1, favouriteNamespacesByContext: {} };
afterEach(() => localStorage.clear());

describe("global log preferences", () => {
  it("uses defaults only for absent or invalid values, preserving explicit false", () => {
    expect(defaultUserSettings().logs).toEqual(defaults);
    expect(validateUserSettings({ v: 1 })?.logs).toEqual(defaults);
    expect(validateUserSettings({ v: 2 })?.logs).toEqual(defaults);
    expect(normalizeLogPreferences({ wrap: false })).toEqual({ ...defaults, wrap: false });
    expect(normalizeLogPreferences({ lines: 999999, wrap: "false", pretty: null })).toEqual(defaults);
    expect(normalizeLogPreferences(null)).toEqual(defaults);
    for (const lines of logLineOptions) expect(normalizeLogPreferences({ ...chosen, lines })).toEqual({ ...chosen, lines });
  });

  it("persists under the existing user settings key without storing stream state", () => {
    saveUserSettings({ ...defaultUserSettings(), logs: chosen });
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_KEY)!).logs).toEqual(chosen);
    expect(loadUserSettings().logs).toEqual(chosen);
    expect(Object.keys(loadUserSettings().logs).sort()).toEqual(["lines", "pretty", "wrap"]);
  });

  it("round-trips settings and full-profile backups", () => {
    const settings = { ...defaultUserSettings(), logs: chosen };
    expect(parseUserSettingsJSON(exportUserSettingsJSON(settings)).logs).toEqual(chosen);
    expect(parseFullProfileJSON(exportFullProfileJSON({ settings, appState }))?.settings.logs).toEqual(chosen);
  });

  it("captures and restores operator profiles, with defaults for older snapshots", () => {
    const saved = addOperatorProfile({ ...defaultUserSettings(), logs: chosen }, { name: "Fixture operator" });
    const id = saved.operatorProfiles.activeProfileId;
    expect(applyOperatorProfile({ ...saved, logs: defaults }, id).logs).toEqual(chosen);
    const legacy = JSON.parse(exportUserSettingsJSON(saved));
    delete legacy.logs;
    delete legacy.operatorProfiles.definitions[0].snapshot.logs;
    const loaded = parseUserSettingsJSON(JSON.stringify(legacy));
    expect(applyOperatorProfile(loaded, id).logs).toEqual(defaults);
  });

  it.each(["keepMine", "useImported", "replaceSections"] as const)("supports selective transfer with %s semantics", (strategy) => {
    const settings = defaultUserSettings();
    const bundle = parseSettingsTransferJSON(exportSettingsTransferJSON({
      settings: { ...settings, logs: chosen }, appState, sections: ["logs"],
    }));
    expect(settingsTransferSectionIds(bundle)).toEqual(["logs"]);
    expect(bundle.sections.logs).toEqual(chosen);
    expect(applySettingsTransferBundle({ settings, appState, bundle, sections: ["logs"], strategy }).settings.logs)
      .toEqual(strategy === "keepMine" ? defaults : chosen);
    expect(applySettingsTransferBundle({ settings, appState, bundle, sections: [], strategy }).settings.logs).toEqual(defaults);
  });
});
