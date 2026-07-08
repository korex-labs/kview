import { apiGet, apiPost } from "./api";
import type {
  DashboardSignalItem,
  InvestigationSnapshot,
  InvestigationSnapshotListResponse,
  InvestigationSnapshotResponse,
  InvestigationSnapshotResourceRef,
  SignalInvestigationResourceRef,
  SignalInvestigationResult,
} from "./types/api";

export const INVESTIGATION_SNAPSHOT_SOURCE = "investigate-signal";

export type InvestigationSnapshotResourceTarget = {
  resource: string;
  namespace?: string | null;
  name: string;
};

function compactText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\s+/g, " ") || fallback;
}

function signalType(signal: DashboardSignalItem): string {
  return compactText(signal.signalType) || compactText(signal.reason) || compactText(signal.kind, "signal");
}

function signalTitle(signal: DashboardSignalItem): string {
  const resource = compactText(signal.resourceName) || compactText(signal.name) || compactText(signal.namespace);
  const kind = compactText(signal.resourceKind) || compactText(signal.kind);
  const reason = compactText(signal.reason, signalType(signal));
  if (resource && kind) return `${reason} on ${kind} ${resource}`;
  if (resource) return `${reason} on ${resource}`;
  return reason;
}

function snapshotTitle(result: SignalInvestigationResult): string {
  return `Investigation: ${signalTitle(result.signal)}`;
}

function signalObservedAt(signal: DashboardSignalItem, fallback: number): number {
  return signal.lastSeenAt || signal.firstSeenAt || fallback || Date.now();
}

function resourceRef(ref: SignalInvestigationResourceRef): InvestigationSnapshotResourceRef {
  return {
    kind: compactText(ref.kind),
    namespace: compactText(ref.namespace),
    name: compactText(ref.name),
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = compactText(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function buildInvestigationSnapshot(result: SignalInvestigationResult): InvestigationSnapshot {
  const generatedAt = result.generatedAt || Date.now();
  return {
    title: snapshotTitle(result),
    triageState: "investigating",
    signal: {
      type: signalType(result.signal),
      title: signalTitle(result.signal),
      severity: compactText(result.signal.severity),
      category: compactText(result.signal.section || result.signal.kind),
      observedAt: signalObservedAt(result.signal, generatedAt),
    },
    primaryResource: resourceRef(result.primaryResource),
    relatedResources: (result.relatedResources || []).map(resourceRef),
    relatedSignalTypes: uniqueStrings([
      result.signal.signalType || "",
      ...(result.relatedSignals || []).map((item) => item.signalType || item.reason || item.kind || ""),
      ...(result.contextSignals || []).map((item) => item.signalType || item.reason || item.kind || ""),
    ]),
    markdown: result.exportMarkdown || "",
    operatorNote: result.diagnosis?.summary || "",
    runbookUrls: [],
    source: INVESTIGATION_SNAPSHOT_SOURCE,
  };
}

export async function saveInvestigationSnapshot(token: string, result: SignalInvestigationResult): Promise<InvestigationSnapshot> {
  const response = await apiPost<InvestigationSnapshotResponse>(
    "/api/investigations/snapshots",
    token,
    buildInvestigationSnapshot(result),
  );
  if (!response.item) throw new Error("Investigation snapshot save returned no item");
  return response.item;
}

export async function listResourceInvestigationSnapshots(
  token: string,
  target: InvestigationSnapshotResourceTarget,
): Promise<InvestigationSnapshot[]> {
  if (!token || !target.name || !target.resource) return [];
  const params = new URLSearchParams();
  params.set("kind", target.resource);
  if (target.namespace) params.set("namespace", target.namespace);
  params.set("name", target.name);
  const response = await apiGet<InvestigationSnapshotListResponse>(
    `/api/investigations/snapshots?${params.toString()}`,
    token,
  );
  return Array.isArray(response.items) ? response.items : [];
}
