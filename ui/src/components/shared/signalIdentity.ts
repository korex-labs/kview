import type { DashboardSignalItem } from "../../types/api";

export function signalHistoryKey(signal: DashboardSignalItem): string {
  if (signal.historyKey) return signal.historyKey;
  return [
    signal.signalType || "signal",
    signal.scope,
    signal.scopeLocation,
    signal.resourceKind || signal.kind,
    signal.resourceName || signal.name,
    signal.namespace,
    signal.reason,
  ].filter(Boolean).join("|");
}

export function signalWithHistoryKey(signal: DashboardSignalItem): DashboardSignalItem {
  const historyKey = signalHistoryKey(signal);
  if (!historyKey || signal.historyKey === historyKey) return signal;
  return { ...signal, historyKey };
}
