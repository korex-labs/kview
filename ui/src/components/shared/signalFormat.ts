import type { DashboardSignalItem } from "../../types/api";
import { fmtTimeAgo } from "../../utils/format";

export function signalSeverityColor(severity?: string): "error" | "warning" | "info" | "default" {
  if (severity === "high" || severity === "error") return "error";
  if (severity === "medium" || severity === "warning") return "warning";
  if (severity === "low" || severity === "info") return "info";
  return "default";
}

export function normalizeSignalText(value?: string): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

export function signalCalculatedText(signal: DashboardSignalItem): string {
  const reason = normalizeSignalText(signal.reason);
  const actual = normalizeSignalText(signal.actualData);
  const calculated = normalizeSignalText(signal.calculatedData);
  if (!calculated || calculated === reason || calculated === actual) return "";
  return calculated;
}

export function signalMetaText(signal: DashboardSignalItem, showMissing = false): string {
  if (!showMissing && !signal.firstSeenAt && !signal.lastSeenAt) return "";
  return `First seen ${signalFirstSeenText(signal)} · Last verified ${signalLastSeenText(signal)}`;
}

export function signalFirstSeenText(signal: DashboardSignalItem): string {
  return signal.firstSeenAt ? fmtTimeAgo(signal.firstSeenAt) : "-";
}

export function signalLastSeenText(signal: DashboardSignalItem): string {
  return signal.lastSeenAt ? fmtTimeAgo(signal.lastSeenAt) : "-";
}

export function signalTooltipText(signal: DashboardSignalItem): string {
  const calculated = signalCalculatedText(signal);
  const parts = [signal.reason];
  if (calculated) parts.push(calculated);
  if (signal.likelyCause) parts.push(`Likely cause: ${signal.likelyCause}`);
  if (signal.suggestedAction) parts.push(`Next step: ${signal.suggestedAction}`);
  parts.push(signalMetaText(signal, true));
  return parts.join(" ");
}

export function signalSeverityRank(severity?: string): number {
  switch (severity) {
    case "high":
    case "error":
      return 0;
    case "medium":
    case "warning":
      return 1;
    case "low":
    case "info":
      return 2;
    default:
      return 3;
  }
}

function signalFreshnessTime(signal: DashboardSignalItem): number {
  return Math.max(signal.lastSeenAt || 0, signal.firstSeenAt || 0);
}

function signalActionabilityRank(signal: DashboardSignalItem): number {
  let rank = 0;
  if (signal.suggestedAction) rank += 4;
  if (signal.likelyCause) rank += 2;
  if (signal.actualData || signal.calculatedData) rank += 1;
  return rank;
}

function signalIdentityText(signal: DashboardSignalItem): string {
  return [
    signal.signalType,
    signal.resourceKind || signal.kind,
    signal.scope,
    signal.scopeLocation,
    signal.namespace,
    signal.resourceName || signal.name,
    signal.reason,
  ].filter(Boolean).join("|");
}

export function rankAttentionSignals(signals: DashboardSignalItem[]): DashboardSignalItem[] {
  return [...signals].sort((a, b) => {
    const severityDelta = signalSeverityRank(a.severity) - signalSeverityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;

    const freshnessDelta = signalFreshnessTime(b) - signalFreshnessTime(a);
    if (freshnessDelta !== 0) return freshnessDelta;

    const priorityDelta = (a.signalPriority ?? 10) - (b.signalPriority ?? 10);
    if (priorityDelta !== 0) return priorityDelta;

    if (a.score !== b.score) return b.score - a.score;

    const actionabilityDelta = signalActionabilityRank(b) - signalActionabilityRank(a);
    if (actionabilityDelta !== 0) return actionabilityDelta;

    return signalIdentityText(a).localeCompare(signalIdentityText(b));
  });
}
