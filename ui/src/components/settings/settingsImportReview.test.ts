import { describe, expect, it } from "vitest";
import { applySettingsTransferBundle, defaultUserSettings, exportFullProfileJSON, exportSettingsTransferJSON, exportUserSettingsJSON, operatorProfileSnapshotFromSettings, parseFullProfileJSON, parseUserSettingsJSON } from "../../settings";
import type { AppStateV1 } from "../../state";
import { createSettingsImportReview, diffImportValues, fullSettingsSectionLabels, parseSettingsImport, projectSettingsImport } from "./settingsImportReview";

const appState: AppStateV1 = { v: 1, activeContext: "local", activeNamespace: "demo", favouriteNamespacesByContext: { local: ["demo"] }, recentNamespacesByContext: {} };
const baseline = () => ({ settings: defaultUserSettings(), appState: structuredClone(appState) });

describe("settings import review", () => {
  it("does not require normalization acknowledgement for canonical exports", () => {
    const current = baseline();
    for (const text of [exportUserSettingsJSON(current.settings), exportFullProfileJSON(current), exportSettingsTransferJSON({ ...current, sections: ["logs", "keyboard", "signalSettings"] })]) {
      expect(parseSettingsImport(text).diagnostics).toEqual([]);
    }
  });

  it("selective projection preserves every unselected settings reference without normalizing it", () => {
    const current = baseline();
    const incoming = baseline();
    incoming.settings.logs.wrap = false;
    const document = parseSettingsImport(exportSettingsTransferJSON({ ...incoming, sections: ["logs", "keyboard"] }));
    const projected = projectSettingsImport(document, current, ["logs"], "useImported");
    expect(projected.settings.logs.wrap).toBe(false);
    for (const key of Object.keys(fullSettingsSectionLabels) as Array<keyof typeof fullSettingsSectionLabels>) {
      if (key !== "logs") expect(projected.settings[key]).toBe(current.settings[key]);
    }
    expect(projected.appState).toBe(current.appState);
  });

  it("covers every full settings section, retaining full-only data and all app state", () => {
    const current = baseline();
    const incoming = baseline();
    incoming.settings.appearance.textViewerFontSizePx = 18;
    incoming.settings.logs.wrap = false;
    incoming.settings.dataplane.global.profile = "wide";
    incoming.settings.dataplane.contextOverrides = { imported: { profile: "focused" } };
    incoming.settings.history = { days: 30, hours: 6, contexts: { imported: { rulesMode: "custom", nodesMode: "topChanges10", namespaceMode: "recent", rules: ["rule"], nodes: [], namespaces: ["demo"], tag: "" } } };
    incoming.settings.operatorProfiles = { activeProfileId: "saved", definitions: [{ id: "saved", name: "Saved", description: "Offline fixture", createdAt: 1, updatedAt: 2, snapshot: operatorProfileSnapshotFromSettings(incoming.settings) }] };
    incoming.appState = { ...appState, activeContext: "imported", activeNamespace: "other", activityPanelOpen: false, activityPanelHeightPx: 320, recentSections: ["pods"], sidebarCollapsedGroups: { workloads: true } };
    const text = exportFullProfileJSON(incoming);
    const document = parseSettingsImport(text);
    expect(Object.keys(fullSettingsSectionLabels).sort()).toEqual(Object.keys(incoming.settings).filter((key) => key !== "v").sort());
    expect(document.kind).toBe("fullProfile");
    const review = createSettingsImportReview(document, current);
    expect(projectSettingsImport(document, current, review.sections.map((s) => s.id))).toEqual(parseFullProfileJSON(text));
    expect(review.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["appearance", "operatorProfiles", "history", "dataplane", "appState"]));
  });

  it("appearance-only replacement preserves all deselected references, including navigation and full dataplane", () => {
    const current = baseline();
    const incoming = baseline();
    incoming.settings.appearance.textViewerFontSizePx = 18;
    incoming.settings.dataplane.global.profile = "wide";
    incoming.appState.activeContext = "imported";
    const document = parseSettingsImport(exportFullProfileJSON(incoming));
    const before = structuredClone(current);
    const projected = projectSettingsImport(document, current, ["appearance"]);
    expect(projected.settings.appearance.textViewerFontSizePx).toBe(18);
    for (const key of Object.keys(fullSettingsSectionLabels) as Array<keyof typeof fullSettingsSectionLabels>) {
      if (key !== "appearance") expect(projected.settings[key]).toBe(current.settings[key]);
    }
    expect(projected.appState).toBe(current.appState);
    expect(current).toEqual(before);
    expect(projectSettingsImport(document, current, [])).toEqual(current);
    const review = createSettingsImportReview(document, current, ["appearance"]);
    expect(review.localCounts).toEqual({ added: 0, changed: 1, removed: 0 });
  });

  it.each([1, 2])("uses the existing raw v%s parser without inventing app state", (v) => {
    const text = JSON.stringify({ v, appearance: { textViewerFontSizePx: 18 } });
    const document = parseSettingsImport(text);
    const current = baseline();
    const review = createSettingsImportReview(document, current);
    expect(projectSettingsImport(document, current, review.sections.map((s) => s.id))).toEqual({ settings: parseUserSettingsJSON(text), appState: current.appState });
    expect(review.sections.some((s) => s.id === "appState")).toBe(false);
    expect(document.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(["keepMine", "useImported", "replaceSections"] as const)("retains selective %s semantics and truthful local counts", (strategy) => {
    const current = baseline();
    const incoming = baseline();
    incoming.settings.logs.wrap = !current.settings.logs.wrap;
    const document = parseSettingsImport(exportSettingsTransferJSON({ ...incoming, sections: ["logs"] }));
    if (document.kind !== "transfer") throw new Error("expected transfer");
    const expected = applySettingsTransferBundle({ ...current, bundle: document.bundle, sections: ["logs"], strategy });
    const review = createSettingsImportReview(document, current, ["logs"], strategy);
    expect(review.projection).toEqual(expected);
    expect(review.localCounts.changed).toBe(strategy === "keepMine" ? 0 : 1);
    expect(review.canApply).toBe(strategy !== "keepMine");
    expect(projectSettingsImport(document, current, [], strategy)).toEqual(current);
  });

  it("does not fabricate counts or authorize writes for unreviewed remote sections", () => {
    const document = parseSettingsImport(JSON.stringify({ kind: "kview.settingsTransfer", v: 1, sections: { signalHistory: { demo: { signal: { firstSeenAt: 1, lastSeenAt: 2, observedDays: [1] } } } } }));
    const current = baseline();
    const review = createSettingsImportReview(document, current);
    expect(review.sections[0].status).toBe("remoteBaselineRequired");
    expect(review.sections[0].counts).toBeNull();
    expect(review.canApply).toBe(false);
    expect(review.projection).toEqual(current);
  });

  it("computes stable added/changed/removed paths, treating arrays as one value and missing separately from null", () => {
    const rows = diffImportValues({ z: false, remove: 1, array: [1], nil: null }, { z: true, added: 0, array: [], nil: null, explicitNull: null });
    expect(rows.map(({ path, kind }) => [path, kind])).toEqual([
      ["/added", "added"], ["/array", "changed"], ["/explicitNull", "added"], ["/remove", "removed"], ["/z", "changed"],
    ]);
    expect(diffImportValues({ b: 1, a: 2 }, { a: 2, b: 1 })).toEqual([]);
    expect(diffImportValues({ "a/b~c": 1 }, { "a/b~c": 2 })[0].path).toBe("/a~1b~0c");
  });

  it("shows real removals in optional app state and disables identical/empty selection", () => {
    const current = baseline();
    const document = parseSettingsImport(exportFullProfileJSON(current));
    expect(createSettingsImportReview(document, current, []).canApply).toBe(false);
    expect(createSettingsImportReview(document, current).canApply).toBe(false);
    const incoming = { ...current, appState: { v: 1 as const, favouriteNamespacesByContext: {} } };
    const review = createSettingsImportReview(parseSettingsImport(exportFullProfileJSON(incoming)), current, ["appState"]);
    expect(review.localCounts.removed).toBe(3);
    expect(review.projection.appState.activeContext).toBeUndefined();
  });

  it("reports normalization and unsupported fields without exposing discarded values", () => {
    const document = parseSettingsImport(JSON.stringify({ ...defaultUserSettings(), appearance: { ...defaultUserSettings().appearance, textViewerFontSizePx: -99 }, futureSecret: "DO-NOT-DISPLAY" }));
    expect(document.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/futureSecret", kind: "removed" }),
      expect.objectContaining({ path: "/appearance/textViewerFontSizePx", kind: "changed" }),
    ]));
    expect(JSON.stringify(document.diagnostics)).not.toContain("DO-NOT-DISPLAY");
    expect(createSettingsImportReview(document, baseline()).requiresNormalizationAcknowledgement).toBe(true);
  });

  it("redacts credential-like fields and executable/url payloads in preview only", () => {
    const before = { password: "old-password", nested: { token: "old-token" }, command: "echo private", urlTemplate: "https://user:pass@example.test/?token=secret" };
    const after = { password: "new-password", nested: { token: "new-token" }, command: "echo changed-private", urlTemplate: "https://example.test/?token=changed" };
    const rows = diffImportValues(before, after);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.before === "[redacted]" && row.after === "[redacted]")).toBe(true);
    expect(after.password).toBe("new-password");
  });

  it.each([
    "{", "null", "[]", '{"kind":"other","v":2}',
    '{"kind":"kview.fullProfile","version":2,"settings":{"v":2}}',
    '{"kind":"kview.fullProfile","settings":{"v":2}}',
    '{"kind":"kview.settingsTransfer","v":2,"sections":{"logs":{}}}',
    '{"v":3}',
  ])("rejects malformed/unsupported input without format fallthrough: %s", (text) => {
    expect(() => parseSettingsImport(text)).toThrow();
  });
});
