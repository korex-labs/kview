import { apiGet, apiGetWithContext, apiPost } from "./api";
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
export const INVESTIGATION_SNAPSHOTS_CHANGED_EVENT = "kview:investigation-snapshots-changed";

function notifyInvestigationSnapshotsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT));
  }
}

export type InvestigationSnapshotResourceTarget = {
  resource: string;
  namespace?: string | null;
  name: string;
};

export type InvestigationSnapshotSearchItem = {
  snapshot: InvestigationSnapshot;
  matchReason: string;
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
  return saveInvestigationSnapshotRecord(token, buildInvestigationSnapshot(result));
}

export async function saveInvestigationSnapshotRecord(token: string, snapshot: InvestigationSnapshot): Promise<InvestigationSnapshot> {
  const response = await apiPost<InvestigationSnapshotResponse>(
    "/api/investigations/snapshots",
    token,
    snapshot,
  );
  if (!response.item) throw new Error("Investigation snapshot save returned no item");
  notifyInvestigationSnapshotsChanged();
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

export async function listInvestigationSnapshots(
  token: string,
  activeContext = "",
  opts?: { signal?: AbortSignal },
): Promise<InvestigationSnapshot[]> {
  if (!token) return [];
  const response = activeContext
    ? await apiGetWithContext<InvestigationSnapshotListResponse>("/api/investigations/snapshots", token, activeContext, opts)
    : await apiGet<InvestigationSnapshotListResponse>("/api/investigations/snapshots", token, { signal: opts?.signal });
  return Array.isArray(response.items) ? response.items : [];
}

export async function deleteInvestigationSnapshot(token: string, id: string): Promise<void> {
  const cleaned = id.trim();
  if (!token || !cleaned) return;
  const res = await fetch(`/api/investigations/snapshots/${encodeURIComponent(cleaned)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(res.statusText || "Failed to delete investigation snapshot");
  notifyInvestigationSnapshotsChanged();
}

function snapshotSearchFields(snapshot: InvestigationSnapshot): Array<{ label: string; value?: string | string[] }> {
  return [
    { label: "title", value: snapshot.title },
    { label: "state", value: snapshot.triageState },
    { label: "signal", value: [snapshot.signal?.type, snapshot.signal?.title, snapshot.signal?.severity, snapshot.signal?.category].filter(Boolean) as string[] },
    { label: "resource", value: [snapshot.primaryResource?.kind, snapshot.primaryResource?.namespace, snapshot.primaryResource?.name].filter(Boolean) as string[] },
    { label: "related signal", value: snapshot.relatedSignalTypes || [] },
    { label: "note", value: snapshot.operatorNote },
  ];
}

export function searchInvestigationSnapshots(
  snapshots: InvestigationSnapshot[],
  query: string,
  limit = 5,
): InvestigationSnapshotSearchItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const out: InvestigationSnapshotSearchItem[] = [];
  for (const snapshot of snapshots) {
    const fields = snapshotSearchFields(snapshot);
    let firstReason = "snapshot";
    let matchedAll = true;
    for (const term of terms) {
      let matchedTerm = false;
      for (const field of fields) {
        const values = Array.isArray(field.value) ? field.value : [field.value || ""];
        if (!values.some((value) => value.toLowerCase().includes(term))) continue;
        if (firstReason === "snapshot") firstReason = field.label;
        matchedTerm = true;
        break;
      }
      if (!matchedTerm) {
        matchedAll = false;
        break;
      }
    }
    if (!matchedAll) continue;
    out.push({ snapshot, matchReason: firstReason });
    if (out.length >= limit) break;
  }
  return out;
}
