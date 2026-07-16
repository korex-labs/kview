import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listInvestigationSnapshots, INVESTIGATION_SNAPSHOTS_CHANGED_EVENT } from "./investigationSnapshots";
import type { DashboardSignalItem, InvestigationSnapshot } from "./types/api";

export type SignalMemoryDecision = {
  snapshot: InvestigationSnapshot;
  label: string;
  note: string;
};

type SignalMemoryContextValue = {
  snapshots: InvestigationSnapshot[];
  decisionForSignal: (signal: DashboardSignalItem) => SignalMemoryDecision | null;
  openSnapshot: (snapshot: InvestigationSnapshot) => void;
};

const SignalMemoryContext = createContext<SignalMemoryContextValue>({
  snapshots: [],
  decisionForSignal: () => null,
  openSnapshot: () => undefined,
});

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function signalTypeCandidates(signal: DashboardSignalItem): string[] {
  return [signal.signalType, signal.reason, signal.kind].map(clean).filter(Boolean);
}

function signalKindCandidates(signal: DashboardSignalItem): string[] {
  return [signal.focus?.resource, signal.resourceKind, signal.kind].map(clean).filter(Boolean);
}

function signalResourceName(signal: DashboardSignalItem): string {
  return clean(signal.resourceName || signal.name || signal.focus?.filter);
}

function snapshotTimestamp(snapshot: InvestigationSnapshot): number {
  return snapshot.updatedAt || snapshot.createdAt || 0;
}

export function snapshotMatchesSignal(snapshot: InvestigationSnapshot, signal: DashboardSignalItem): boolean {
  const snapshotType = clean(snapshot.signal?.type);
  const ref = snapshot.primaryResource;
  if (!snapshotType || !ref?.name || !ref.kind) return false;
  if (!signalTypeCandidates(signal).includes(snapshotType)) return false;
  if (!signalKindCandidates(signal).includes(clean(ref.kind))) return false;
  if (signalResourceName(signal) !== clean(ref.name)) return false;
  return clean(signal.namespace || signal.focus?.namespace) === clean(ref.namespace);
}

function decisionLabel(snapshot: InvestigationSnapshot): string {
  switch (snapshot.triageState) {
    case "resolved":
      return "Previously resolved";
    case "known":
      return "Known";
    case "ignored":
      return "Known noisy";
    case "watching":
      return "Watching";
    default:
      return "Previously investigated";
  }
}

export function latestSignalDecision(
  snapshots: InvestigationSnapshot[],
  signal: DashboardSignalItem,
): SignalMemoryDecision | null {
  const snapshot = snapshots
    .filter((item) => snapshotMatchesSignal(item, signal))
    .sort((a, b) => snapshotTimestamp(b) - snapshotTimestamp(a))[0];
  if (!snapshot) return null;
  return {
    snapshot,
    label: decisionLabel(snapshot),
    note: (snapshot.operatorNote || "").trim(),
  };
}

export function SignalMemoryProvider({
  token,
  activeContext,
  onOpenSnapshot,
  children,
}: {
  token: string;
  activeContext: string;
  onOpenSnapshot: (snapshot: InvestigationSnapshot) => void;
  children: React.ReactNode;
}) {
  const [snapshots, setSnapshots] = useState<InvestigationSnapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      if (!token || !activeContext) {
        setSnapshots([]);
        return;
      }
      listInvestigationSnapshots(token, activeContext, { signal: requestController.signal })
        .then((items) => {
          if (!cancelled && !requestController.signal.aborted) setSnapshots(items);
        })
        .catch(() => {
          if (!cancelled && !requestController.signal.aborted) setSnapshots([]);
        });
    };

    load();
    window.addEventListener(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      controller?.abort();
      window.removeEventListener(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT, load);
    };
  }, [activeContext, token]);

  const decisionForSignal = useCallback(
    (signal: DashboardSignalItem) => latestSignalDecision(snapshots, signal),
    [snapshots],
  );
  const value = useMemo<SignalMemoryContextValue>(
    () => ({ snapshots, decisionForSignal, openSnapshot: onOpenSnapshot }),
    [decisionForSignal, onOpenSnapshot, snapshots],
  );

  return <SignalMemoryContext.Provider value={value}>{children}</SignalMemoryContext.Provider>;
}

export function useSignalMemory(): SignalMemoryContextValue {
  return useContext(SignalMemoryContext);
}
