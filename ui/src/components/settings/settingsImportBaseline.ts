import { apiGetWithContext } from "../../api";
import type { SettingsTransferBundleV1, SettingsTransferMergeStrategy } from "../../settings";
import type { InvestigationSnapshot } from "../../types/api";
import { diffImportValues, type SettingsImportSection } from "./settingsImportReview";
import { snapshotTransferKey, uniqueSnapshots } from "./useSettingsTransfer";

export type RemoteImportBaseline =
  | { kind: "records"; before: Record<string, Record<string, unknown>>; incoming: Record<string, Record<string, unknown>> }
  | { kind: "snapshots"; before: InvestigationSnapshot[]; incoming: InvestigationSnapshot[] };

/** Only persisted export/list endpoints; never Kubernetes discovery or live reads. */
export async function loadSettingsImportBaseline(
  id: SettingsImportSection, bundle: SettingsTransferBundleV1, token: string, context: string, signal: AbortSignal,
): Promise<RemoteImportBaseline> {
  if (!token || !context) throw new Error("Select a context to load the current values.");
  if (id === "investigationSnapshots") {
    const incoming = uniqueSnapshots(bundle.sections.investigationSnapshots || []);
    const contexts = [...new Set(incoming.map((item) => item.context || "").filter(Boolean))];
    const groups = await Promise.all(contexts.map(async (name) => {
      const response = await apiGetWithContext<{ items: InvestigationSnapshot[] }>("/api/investigations/snapshots", token, name, { signal });
      if (!Array.isArray(response.items)) throw new Error("Current snapshots unavailable.");
      return response.items;
    }));
    signal.throwIfAborted();
    return { kind: "snapshots", before: uniqueSnapshots(groups.flat()), incoming };
  }
  const incoming = id === "signalSuppressions"
    ? { [context]: bundle.sections.signalSuppressions?.items || {} }
    : id === "signalAcknowledgements" ? bundle.sections.signalAcknowledgements || {}
      : id === "signalHistory" ? bundle.sections.signalHistory || {} : null;
  if (!incoming) throw new Error("Unsupported remote section.");
  const path = id === "signalSuppressions" ? "suppressions" : id === "signalAcknowledgements" ? "ack" : "history";
  const entries = await Promise.all(Object.keys(incoming).map(async (name) => {
    const response = await apiGetWithContext<{ active: string; items: Record<string, unknown> }>(
      `/api/dataplane/signals/${path}/export`, token, name, { signal },
    );
    if (response.active !== name || !response.items || typeof response.items !== "object" || Array.isArray(response.items)) {
      throw new Error("Current values unavailable for the requested context.");
    }
    return [name, response.items] as const;
  }));
  signal.throwIfAborted();
  return { kind: "records", before: Object.fromEntries(entries), incoming };
}

/** Compare the intended transfer with an actual persisted baseline, using existing merge identities. */
export function remoteImportChanges(baseline: RemoteImportBaseline, strategy: SettingsTransferMergeStrategy, id: SettingsImportSection) {
  if (baseline.kind === "records") {
    const after = Object.fromEntries(Object.entries(baseline.incoming).map(([context, incoming]) => {
      const current = baseline.before[context] || {};
      return [context, strategy === "replaceSections" ? incoming
        : strategy === "keepMine" ? { ...incoming, ...current } : { ...current, ...incoming }];
    }));
    return diffImportValues(baseline.before, after, `/${id}`);
  }
  // The importer's replacement is restricted to the contexts present in incoming records.
  let after = strategy === "replaceSections" ? [] : [...baseline.before];
  const byID = new Map(baseline.before.filter((item) => item.id).map((item) => [item.id, item]));
  const byKey = new Map(baseline.before.map((item) => [snapshotTransferKey(item), item]));
  for (const item of baseline.incoming) {
    const stable = strategy === "replaceSections" ? undefined : byKey.get(snapshotTransferKey(item));
    const match = strategy === "replaceSections" ? undefined : (item.id ? byID.get(item.id) : undefined) || stable;
    if (strategy === "keepMine" && match) continue;
    const next = strategy === "useImported" && stable?.id && stable.id !== item.id ? { ...item, id: stable.id } : item;
    after = after.filter((existing) => !next.id || existing.id !== next.id);
    after.push(next);
  }
  return diffImportValues(baseline.before, after, `/${id}`);
}
