// @vitest-environment node

import { describe, expect, it } from "vitest";
import { defaultUserSettings } from "./settings";
import {
  applySignalExclusionsToSettings,
  buildQuickSignalExclusionDraft,
  buildQuickSignalExclusionRule,
  escapeRE2Literal,
  quickSignalExclusionTarget,
} from "./signalExclusions";

describe("quick signal exclusions", () => {
  it("builds anchored namespace and resource-name conditions", () => {
    const target = quickSignalExclusionTarget({
      signalType: "pod_restarts",
      kind: "Pod",
      namespace: "apps.prod",
      name: "api[0]",
      severity: "high",
      score: 1,
      reason: "Restarts",
    });
    expect(target).not.toBeNull();
    const rule = buildQuickSignalExclusionRule(target!, "quick-rule");
    expect(rule).toMatchObject({ id: "quick-rule", match: "all", enabled: true });
    expect(rule.conditions).toEqual([
      { source: "namespace", operator: "regex", pattern: "^apps\\.prod$" },
      { source: "name", operator: "regex", pattern: "^api\\[0\\]$" },
    ]);
    expect(escapeRE2Literal("a+b")) .toBe("a\\+b");
  });

  it("does not offer quick exclusion for unconfigurable fallback signals", () => {
    expect(quickSignalExclusionTarget({
      signalType: "resource_needs_attention_fallback",
      kind: "Pod",
      name: "api-0",
      severity: "high",
      score: 1,
      reason: "Fallback",
    })).toBeNull();
  });

  it("copies inherited global rules into a safe context replacement", () => {
    const settings = defaultUserSettings();
    settings.dataplane.global.signals.overrides.pod_restarts = {
      exclusions: { rules: [{ id: "global", conditions: [{ source: "name", pattern: "^global$" }] }] },
    };
    const target = {
      signalType: "pod_restarts",
      signalLabel: "Pod Restarts",
      resourceKind: "Pod",
      namespace: "apps",
      resourceName: "api-0",
    };
    const draft = buildQuickSignalExclusionDraft(settings, target, "context", "prod", "quick");
    expect(draft.rules.map((rule) => rule.id)).toEqual(["quick", "global"]);
    expect(settings.dataplane.contextOverrides.prod).toBeUndefined();

    const next = applySignalExclusionsToSettings(settings, target.signalType, "context", "prod", draft);
    expect(next.dataplane.contextOverrides.prod.signals?.overrides.pod_restarts.exclusions?.rules.map((rule) => rule.id)).toEqual(["quick", "global"]);
    expect(next.dataplane.global.signals.overrides.pod_restarts.exclusions?.rules.map((rule) => rule.id)).toEqual(["global"]);

    const duplicateDraft = buildQuickSignalExclusionDraft(next, target, "context", "prod", "duplicate");
    expect(duplicateDraft.rules.map((rule) => rule.id)).toEqual(["quick", "global"]);

    const globalNext = applySignalExclusionsToSettings(next, target.signalType, "global", "prod", { rules: [draft.rules[0]] });
    expect(globalNext.dataplane.global.signals.overrides.pod_restarts.exclusions?.rules.map((rule) => rule.id)).toEqual(["quick"]);
    expect(globalNext.dataplane.contextOverrides.prod.signals?.overrides.pod_restarts.exclusions?.rules.map((rule) => rule.id)).toEqual(["quick", "global"]);
  });
});
