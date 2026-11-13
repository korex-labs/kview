// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { normalizeTextViewerFontSize } from "./textViewerPreferences";
import {
  addOperatorProfile, applyOperatorProfile,
  defaultUserSettings, exportFullProfileJSON,
  exportUserSettingsJSON, loadUserSettings, parseFullProfileJSON,
  parseUserSettingsJSON, saveUserSettings, validateUserSettings,
} from "./settings";
import type { AppStateV1 } from "./state";

const appState: AppStateV1 = { v: 1, favouriteNamespacesByContext: {} };
const chosen = () => {
  const settings = defaultUserSettings();
  return { ...settings, appearance: { ...settings.appearance, textViewerFontSizePx: 19 } };
};
afterEach(() => localStorage.clear());

describe("text viewer preference", () => {
  it.each([[undefined, 13], [null, 13], ["18", 13], [NaN, 13], [Infinity, 13], [-1, 10], [100, 24], [15.6, 16], [10, 10], [24, 24]])("normalizes %s to %s", (input, expected) => {
    expect(normalizeTextViewerFontSize(input)).toBe(expected);
    expect(validateUserSettings({ v: 2, appearance: { textViewerFontSizePx: input } })?.appearance.textViewerFontSizePx).toBe(expected);
  });

  it("defaults legacy settings and round-trips persistence and full backups", () => {
    expect(validateUserSettings({ v: 1 })?.appearance.textViewerFontSizePx).toBe(13);
    saveUserSettings(chosen());
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(19);
    expect(parseUserSettingsJSON(exportUserSettingsJSON(chosen())).appearance.textViewerFontSizePx).toBe(19);
    expect(parseFullProfileJSON(exportFullProfileJSON({ settings: chosen(), appState }))?.settings.appearance.textViewerFontSizePx).toBe(19);
  });

  it("normalizes older operator snapshots and restores saved sizes", () => {
    const saved = addOperatorProfile(chosen(), { name: "Fixture viewer" });
    const id = saved.operatorProfiles.activeProfileId;
    expect(applyOperatorProfile({ ...saved, appearance: defaultUserSettings().appearance }, id).appearance.textViewerFontSizePx).toBe(19);
    const legacy = JSON.parse(exportUserSettingsJSON(saved));
    delete legacy.operatorProfiles.definitions[0].snapshot.appearance.textViewerFontSizePx;
    expect(applyOperatorProfile(parseUserSettingsJSON(JSON.stringify(legacy)), id).appearance.textViewerFontSizePx).toBe(13);
  });

  it("preserves independent log preferences in settings backups", () => {
    const settings = { ...chosen(), logs: { lines: 500, pretty: false, wrap: false } };
    const result = parseUserSettingsJSON(exportUserSettingsJSON(settings));
    expect(result.appearance.textViewerFontSizePx).toBe(19);
    expect(result.logs).toEqual(settings.logs);
  });
});
