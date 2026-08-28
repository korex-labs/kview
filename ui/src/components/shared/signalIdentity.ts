import type { DashboardSignalItem } from "../../types/api";

export function signalHistoryKey(signal: DashboardSignalItem): string {
  const backendHistoryKey = signal.historyKey?.trim();
  if (backendHistoryKey) return backendHistoryKey;
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
  if (signal.historyKey?.trim()) return signal;
  const historyKey = signalHistoryKey(signal);
  if (!historyKey) return signal;
  return { ...signal, historyKey, clientSynthesizedHistoryKey: true };
}
