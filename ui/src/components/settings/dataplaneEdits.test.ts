import { describe, expect, it } from "vitest";
import { defaultUserSettings, dataplaneSettingsForContext, parseUserSettingsJSON, type DataplaneSettings } from "../../settings";
import {
  deepMerge, patchDataplaneSection, pruneContextOverride, resetDataplaneOverridePath,
  setDataplanePrimitive, stripUndefinedDeep, updateDataplane,
} from "./dataplaneEdits";

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe("dataplane scope operations", () => {
  it("merges global nested patches without losing siblings or rewriting existing overrides", () => {
    const prev = defaultUserSettings();
    prev.dataplane.contextOverrides.selected = { metrics: { enabled: false } };
    freezeDeep(prev);
    const next = patchDataplaneSection(prev, "global", "selected", "namespaceEnrichment", {
      sweep: { idleQuietMs: 71 } as DataplaneSettings["namespaceEnrichment"]["sweep"],
    });
    expect(next.dataplane.global.namespaceEnrichment.sweep).toEqual({ ...prev.dataplane.global.namespaceEnrichment.sweep, idleQuietMs: 71 });
    expect(next.dataplane.contextOverrides).toBe(prev.dataplane.contextOverrides);
  });

  it("merges only selected-context fields, prunes equal defaults and preserves untouched contexts", () => {
    const prev = defaultUserSettings();
    prev.dataplane.global.metrics.enabled = true;
    prev.dataplane.global.backgroundBudget.longRunNoticeSec = 45;
    prev.dataplane.contextOverrides.selected = { namespaceEnrichment: { sweep: { idleQuietMs: 71 } as DataplaneSettings["namespaceEnrichment"]["sweep"] } };
    prev.dataplane.contextOverrides.other = { metrics: { enabled: false } };
    freezeDeep(prev);
    let next = patchDataplaneSection(prev, "context", " selected ", "namespaceEnrichment", {
      sweep: { maxNamespacesPerCycle: 3 } as DataplaneSettings["namespaceEnrichment"]["sweep"],
    });
    next = patchDataplaneSection(next, "context", "selected", "metrics", { enabled: false });
    next = patchDataplaneSection(next, "context", "selected", "backgroundBudget", { longRunNoticeSec: 0 });
    expect(next.dataplane.contextOverrides.selected).toEqual({
      namespaceEnrichment: { sweep: { idleQuietMs: 71, maxNamespacesPerCycle: 3 } },
      metrics: { enabled: false }, backgroundBudget: { longRunNoticeSec: 0 },
    });
    expect(next.dataplane.global).toBe(prev.dataplane.global);
    expect(next.dataplane.contextOverrides.other).toBe(prev.dataplane.contextOverrides.other);
    next = patchDataplaneSection(next, "context", "selected", "metrics", { enabled: true });
    expect(next.dataplane.contextOverrides.selected.metrics).toBeUndefined();
    expect(prev.dataplane.contextOverrides.selected).toEqual({ namespaceEnrichment: { sweep: { idleQuietMs: 71 } } });
  });

  it("resets a nested field or whole section, drops empty ancestors and resumes inheritance", () => {
    const prev = defaultUserSettings();
    prev.dataplane.contextOverrides.selected = { dashboard: { signalLimit: 19, newestSignalLimit: 23 }, metrics: { enabled: false } };
    prev.dataplane.contextOverrides.other = { dashboard: { signalLimit: 11 } };
    freezeDeep(prev);
    const fieldReset = resetDataplaneOverridePath(prev, "selected", ["dashboard", "signalLimit"]);
    expect(fieldReset.dataplane.contextOverrides.selected.dashboard).toEqual({ newestSignalLimit: 23 });
    expect(dataplaneSettingsForContext(fieldReset.dataplane, "selected").dashboard.signalLimit).toBe(prev.dataplane.global.dashboard.signalLimit);
    const sectionReset = resetDataplaneOverridePath(fieldReset, "selected", ["dashboard"]);
    expect(sectionReset.dataplane.contextOverrides.selected).toEqual({ metrics: { enabled: false } });
    const allReset = resetDataplaneOverridePath(sectionReset, " selected ", ["metrics"]);
    expect(allReset.dataplane.contextOverrides).toEqual({ other: prev.dataplane.contextOverrides.other });
    expect(allReset.dataplane.contextOverrides.other).toBe(prev.dataplane.contextOverrides.other);
    expect(allReset.dataplane.global).toBe(prev.dataplane.global);
    expect(resetDataplaneOverridePath(allReset, "selected", ["namespaceEnrichment", "sweep", "enabled"]).dataplane.contextOverrides).toEqual(allReset.dataplane.contextOverrides);
  });

  it("sets primitive profiles in the chosen scope and prunes values matching global", () => {
    const prev = freezeDeep(defaultUserSettings());
    const global = setDataplanePrimitive(prev, "global", "selected", "profile", "diagnostic");
    expect(global.dataplane.global.profile).toBe("diagnostic");
    const overridden = setDataplanePrimitive(global, "context", "selected", "profile", "manual");
    expect(overridden.dataplane.contextOverrides.selected).toEqual({ profile: "manual" });
    const inherited = setDataplanePrimitive(overridden, "context", "selected", "profile", "diagnostic");
    expect(inherited.dataplane.contextOverrides.selected).toBeUndefined();
    expect(inherited.dataplane.global.backgroundBudget).toBe(prev.dataplane.global.backgroundBudget);
  });

  it("does not edit context state without a nonblank active context", () => {
    const prev = freezeDeep(defaultUserSettings());
    expect(patchDataplaneSection(prev, "context", "  ", "metrics", { enabled: false })).toBe(prev);
    expect(setDataplanePrimitive(prev, "context", "", "profile", "manual")).toBe(prev);
    expect(resetDataplaneOverridePath(prev, "  ", ["metrics"])).toBe(prev);
  });
});

describe("dataplane edit primitives", () => {
  it("patches global defaults without mutating settings or touching context overrides", () => {
    const prev = defaultUserSettings();
    prev.dataplane.contextOverrides.other = { metrics: { enabled: false } };
    freezeDeep(prev);
    const next = updateDataplane(prev, { dashboard: { ...prev.dataplane.global.dashboard, signalLimit: 27 } });
    expect(next.dataplane.global.dashboard.signalLimit).toBe(27);
    expect(next.dataplane.contextOverrides).toBe(prev.dataplane.contextOverrides);
    expect(next.appearance).toBe(prev.appearance);
    expect(next.dataplane.global.metrics).toBe(prev.dataplane.global.metrics);
  });

  it("deep merges nested sweep edits, skips undefined, and replaces arrays without deduplication", () => {
    const base = freezeDeep({ sweep: { enabled: true, idleQuietMs: 40 }, names: ["a"], enabled: true });
    const patch = { sweep: { enabled: false, idleQuietMs: 0 }, names: ["b", "b"], enabled: undefined };
    expect(deepMerge(base, patch)).toEqual({ sweep: { enabled: false, idleQuietMs: 0 }, names: ["b", "b"], enabled: true });
    expect(deepMerge(base, { names: [] }).names).toEqual([]);
    expect(base.names).toEqual(["a"]);
  });

  it("prunes equal defaults and empty ancestors but preserves explicit false and zero", () => {
    const global = defaultUserSettings().dataplane.global;
    global.metrics.enabled = true;
    global.backgroundBudget.longRunNoticeSec = 45;
    const override = freezeDeep({
      metrics: { enabled: false, podMetricsTtlSec: global.metrics.podMetricsTtlSec },
      backgroundBudget: { longRunNoticeSec: 0 },
      observers: { enabled: global.observers.enabled },
    });
    expect(pruneContextOverride(override, global)).toEqual({ metrics: { enabled: false }, backgroundBudget: { longRunNoticeSec: 0 } });
    expect(pruneContextOverride({ metrics: { enabled: true } }, global)).toBeUndefined();
  });

  it("treats arrays as ordered replacements, keeping empty and duplicate values when unequal", () => {
    const global = defaultUserSettings().dataplane.global;
    global.namespaceEnrichment.warmResourceKinds = ["pods", "services"];
    expect(pruneContextOverride({ namespaceEnrichment: { warmResourceKinds: [] } }, global))
      .toEqual({ namespaceEnrichment: { warmResourceKinds: [] } });
    expect(pruneContextOverride({ namespaceEnrichment: { warmResourceKinds: ["pods", "services"] } }, global)).toBeUndefined();
    expect(pruneContextOverride({ namespaceEnrichment: { warmResourceKinds: ["services", "pods", "pods"] } }, global))
      .toEqual({ namespaceEnrichment: { warmResourceKinds: ["services", "pods", "pods"] } });
  });

  it("strips undefined/empty objects without dropping false, zero, or empty arrays", () => {
    expect(stripUndefinedDeep({ gone: { x: undefined }, enabled: false, n: 0, list: [] }))
      .toEqual({ enabled: false, n: 0, list: [] });
    expect(stripUndefinedDeep({ gone: {} })).toBeUndefined();
  });

  it("leaves validation to the existing settings parser rather than filling sparse edits", () => {
    const prev = defaultUserSettings();
    const next = updateDataplane(prev, {
      dashboard: deepMerge(prev.dataplane.global.dashboard, { signalLimit: -1 }),
      namespaceEnrichment: deepMerge(prev.dataplane.global.namespaceEnrichment, { warmResourceKinds: ["pods", "pods", "invalid-kind"] }),
    });
    expect(next.dataplane.global.dashboard.signalLimit).toBe(-1);
    expect(next.dataplane.global.namespaceEnrichment.warmResourceKinds).toEqual(["pods", "pods", "invalid-kind"]);
    const parsed = parseUserSettingsJSON(JSON.stringify(next));
    expect(parsed.dataplane.global.dashboard.signalLimit).toBe(prev.dataplane.global.dashboard.signalLimit);
    expect(parsed.dataplane.global.namespaceEnrichment.warmResourceKinds).toEqual(["pods"]);
  });
});
