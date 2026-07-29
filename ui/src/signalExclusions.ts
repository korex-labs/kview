import { useEffect, useState } from "react";
import type {
  KviewUserSettingsV2,
  SignalExclusionCondition,
  SignalExclusionRule,
  SignalExclusionSet,
  SignalOverride,
} from "./settings";
import type { DashboardSignalItem } from "./types/api";

export type SignalExclusionScope = "global" | "context";

export type QuickSignalExclusionTarget = {
  signalType: string;
  signalLabel: string;
  resourceKind: string;
  namespace: string;
  resourceName: string;
};

export const SIGNAL_EXCLUSIONS_CHANGED_EVENT = "kview:signal-exclusions-changed";

export function escapeRE2Literal(value: string): string {
  return value.replace(/[\\.^$|?*+()[\]{}]/g, "\\$&");
}

export function quickSignalExclusionTarget(signal: DashboardSignalItem): QuickSignalExclusionTarget | null {
  const signalType = (signal.signalType || "").trim();
  const resourceName = (signal.resourceName || signal.name || "").trim();
  if (!signalType || !resourceName || signalType === "resource_needs_attention_fallback") return null;
  const resourceKind = (signal.resourceKind || signal.kind || "Resource").trim();
  const namespace = (signal.namespace || "").trim();
  return {
    signalType,
    signalLabel: signalType.split("_").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
    resourceKind,
    namespace,
    resourceName,
  };
}

function quickRuleID(target: QuickSignalExclusionTarget): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const base = `exclude-${target.resourceKind}-${target.namespace}-${target.resourceName}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `${base || "exclude-resource"}-${suffix}`.slice(0, 80);
}

export function buildQuickSignalExclusionRule(
  target: QuickSignalExclusionTarget,
  id = quickRuleID(target),
): SignalExclusionRule {
  const conditions: SignalExclusionCondition[] = [];
  if (target.namespace) {
    conditions.push({ source: "namespace", operator: "regex", pattern: `^${escapeRE2Literal(target.namespace)}$` });
  }
  conditions.push({ source: "name", operator: "regex", pattern: `^${escapeRE2Literal(target.resourceName)}$` });
  const displayName = target.namespace ? `${target.namespace}/${target.resourceName}` : target.resourceName;
  return {
    id,
    enabled: true,
    description: `Exclude ${target.resourceKind} ${displayName}`.slice(0, 200),
    match: "all",
    conditions,
  };
}

function rulesForScope(
  settings: KviewUserSettingsV2,
  signalType: string,
  scope: SignalExclusionScope,
  contextName: string,
): SignalExclusionRule[] {
  const globalRules = settings.dataplane.global.signals.overrides[signalType]?.exclusions?.rules || [];
  if (scope === "global" || !contextName) return globalRules;
  return settings.dataplane.contextOverrides[contextName]?.signals?.overrides[signalType]?.exclusions?.rules || globalRules;
}

export function buildQuickSignalExclusionDraft(
  settings: KviewUserSettingsV2,
  target: QuickSignalExclusionTarget,
  scope: SignalExclusionScope,
  contextName: string,
  ruleID?: string,
): SignalExclusionSet {
  const existing = rulesForScope(settings, target.signalType, scope, contextName)
    .map((rule) => ({ ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })) }));
  const generated = buildQuickSignalExclusionRule(target, ruleID);
  const equivalentIndex = existing.findIndex((rule) => {
    if (rule.enabled === false || (rule.match || "all") !== "all" || rule.conditions.length !== generated.conditions.length) return false;
    return generated.conditions.every((expected) => rule.conditions.some((condition) =>
      condition.source === expected.source
      && (condition.operator || "regex") === "regex"
      && condition.pattern === expected.pattern
      && !(condition.flags || ""),
    ));
  });
  if (equivalentIndex >= 0) {
    return { rules: [existing[equivalentIndex], ...existing.filter((_, index) => index !== equivalentIndex)] };
  }
  return { rules: [generated, ...existing] };
}

export function applySignalExclusionsToSettings(
  settings: KviewUserSettingsV2,
  signalType: string,
  scope: SignalExclusionScope,
  contextName: string,
  exclusions: SignalExclusionSet,
): KviewUserSettingsV2 {
  if (scope === "global") {
    const signals = settings.dataplane.global.signals;
    const current: SignalOverride = signals.overrides[signalType] || {};
    return {
      ...settings,
      dataplane: {
        ...settings.dataplane,
        global: {
          ...settings.dataplane.global,
          signals: {
            ...signals,
            overrides: { ...signals.overrides, [signalType]: { ...current, exclusions } },
          },
        },
      },
    };
  }
  if (!contextName) return settings;
  const contextOverride = settings.dataplane.contextOverrides[contextName] || {};
  const contextSignals = contextOverride.signals || { overrides: {} };
  const current: SignalOverride = contextSignals.overrides[signalType] || {};
  return {
    ...settings,
    dataplane: {
      ...settings.dataplane,
      contextOverrides: {
        ...settings.dataplane.contextOverrides,
        [contextName]: {
          ...contextOverride,
          signals: {
            ...contextSignals,
            overrides: { ...contextSignals.overrides, [signalType]: { ...current, exclusions } },
          },
        },
      },
    },
  };
}

export function dispatchSignalExclusionsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SIGNAL_EXCLUSIONS_CHANGED_EVENT));
}

export function useSignalExclusionsRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((current) => current + 1);
    window.addEventListener(SIGNAL_EXCLUSIONS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(SIGNAL_EXCLUSIONS_CHANGED_EVENT, changed);
  }, []);
  return revision;
}
