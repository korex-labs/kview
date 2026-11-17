import { useLayoutEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../../api";
import {
  applySettingsTransferBundle, exportSettingsTransferJSON, settingsTransferMergeStrategies, settingsTransferSectionIds,
  type KviewUserSettingsV2, type SettingsTransferBundleV1, type SettingsTransferMergeStrategy,
  type SettingsTransferSection, type SignalHistoryTransferRecord, type SignalSuppressionsTransferSection,
} from "../../settings";
import type { AppStateV1 } from "../../state";
import type { InvestigationSnapshot } from "../../types/api";
import { deleteInvestigationSnapshot, listInvestigationSnapshots, saveInvestigationSnapshotRecord } from "../../investigationSnapshots";
import { dispatchSignalSuppressionsChanged } from "../../signalSuppressions";

type Message = { severity: "success" | "error"; text: string } | null;
type Options = {
  token: string;
  activeContext: string;
  contextOptions: string[];
  settings: KviewUserSettingsV2;
  appState: AppStateV1;
  transferSections: SettingsTransferSection[];
  transferImportSections: SettingsTransferSection[];
  transferStrategy: SettingsTransferMergeStrategy;
  replaceSettings: (settings: KviewUserSettingsV2) => void;
  setAppState: (state: AppStateV1) => void;
  setImportText: (text: string) => void;
  setImportMessage: (message: Message) => void;
  setTransferDialogMessage: (message: Message) => void;
};

function snapshotTransferKey(snapshot: InvestigationSnapshot): string {
  const ref = snapshot.primaryResource;
  return [
    snapshot.context || "",
    ref.kind || "",
    ref.namespace || "",
    ref.name || "",
    snapshot.title || "",
    String(snapshot.createdAt || 0),
  ].join("\x00");
}

function uniqueSnapshots(snapshots: InvestigationSnapshot[]): InvestigationSnapshot[] {
  const seen = new Set<string>();
  const out: InvestigationSnapshot[] = [];
  for (const snapshot of snapshots) {
    const key = snapshot.id ? `${snapshot.context || ""}\x00id\x00${snapshot.id}` : snapshotTransferKey(snapshot);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(snapshot);
  }
  return out;
}

async function listSnapshotsForContexts(token: string, contextNames: string[], signal: AbortSignal): Promise<InvestigationSnapshot[]> {
  const contexts = Array.from(new Set(contextNames.map((item) => item.trim()).filter(Boolean)));
  const groups = await Promise.all(contexts.map((contextName) => listInvestigationSnapshots(token, contextName, { signal })));
  return uniqueSnapshots(groups.flat());
}

async function importInvestigationSnapshotTransfer(input: {
  token: string;
  snapshots: InvestigationSnapshot[];
  strategy: SettingsTransferMergeStrategy;
  signal: AbortSignal;
}): Promise<{ imported: number; skipped: number; deleted: number }> {
  const incoming = uniqueSnapshots(input.snapshots);
  if (incoming.length === 0) return { imported: 0, skipped: 0, deleted: 0 };
  const contextNames = Array.from(new Set(incoming.map((snapshot) => snapshot.context || "").filter(Boolean)));
  const existing = await listSnapshotsForContexts(input.token, contextNames, input.signal);
  input.signal.throwIfAborted();
  let deleted = 0;
  let baseline = existing;
  if (input.strategy === "replaceSections") {
    for (const snapshot of existing) {
      if (!snapshot.id) continue;
      await deleteInvestigationSnapshot(input.token, snapshot.id, { signal: input.signal });
      input.signal.throwIfAborted();
      deleted += 1;
    }
    baseline = [];
  }
  const existingByID = new Map(baseline.filter((snapshot) => snapshot.id).map((snapshot) => [snapshot.id || "", snapshot]));
  const existingByStableKey = new Map(baseline.map((snapshot) => [snapshotTransferKey(snapshot), snapshot]));
  let imported = 0;
  let skipped = 0;
  for (const snapshot of incoming) {
    const existingIDMatch = snapshot.id ? existingByID.get(snapshot.id) : undefined;
    const stableMatch = existingByStableKey.get(snapshotTransferKey(snapshot));
    if (input.strategy === "keepMine" && (existingIDMatch || stableMatch)) {
      skipped += 1;
      continue;
    }
    const toSave = input.strategy === "useImported" && stableMatch?.id && snapshot.id !== stableMatch.id
      ? { ...snapshot, id: stableMatch.id }
      : snapshot;
    await saveInvestigationSnapshotRecord(input.token, toSave, { signal: input.signal });
    input.signal.throwIfAborted();
    imported += 1;
  }
  return { imported, skipped, deleted };
}

/** Selective bundle orchestration only; review/selection and legacy profile/reset flows stay in the view. */
export function useSettingsTransfer(options: Options) {
  const { token, activeContext, contextOptions, settings, appState, transferSections,
    transferImportSections, transferStrategy, setImportMessage, setTransferDialogMessage } = options;
  const latest = useRef(options);
  const exportRequest = useRef<AbortController | null>(null);
  const importRequest = useRef<AbortController | null>(null);
  const [transferImportBusy, setTransferImportBusy] = useState(false);

  useLayoutEffect(() => { latest.current = options; });
  useLayoutEffect(() => {
    setTransferImportBusy(false);
    return () => {
      exportRequest.current?.abort();
      importRequest.current?.abort();
      exportRequest.current = null;
      importRequest.current = null;
    };
  }, [token, activeContext]);

  const cancelTransferImport = () => {
    importRequest.current?.abort();
    importRequest.current = null;
    setTransferImportBusy(false);
  };

  const exportTransferSettings = async () => {
    if (transferSections.length === 0) {
      setImportMessage({ severity: "error", text: "Select at least one section to export." });
      return;
    }
    exportRequest.current?.abort();
    const request = new AbortController();
    exportRequest.current = request;
    try {
      let signalAcknowledgements: Record<string, Record<string, {
        acknowledgedAt: number;
        acknowledgedBy?: string;
        comment?: string;
        updatedAt: number;
      }>> | undefined;
      let signalHistory: Record<string, Record<string, SignalHistoryTransferRecord>> | undefined;
      let investigationSnapshots: InvestigationSnapshot[] | undefined;
      let signalSuppressions: SignalSuppressionsTransferSection | undefined;
      if (transferSections.includes("signalSuppressions")) {
        const res = await apiGet<{ active?: string; items?: SignalSuppressionsTransferSection["items"] }>(
          "/api/dataplane/signals/suppressions/export",
          token,
          { signal: request.signal },
        );
        request.signal.throwIfAborted();
        signalSuppressions = {
          sourceContext: res.active || activeContext,
          items: res.items || {},
        };
      }
      if (transferSections.includes("signalAcknowledgements") && activeContext) {
        const res = await apiGet<{ active: string; items: Record<string, {
          acknowledgedAt: number;
          acknowledgedBy?: string;
          comment?: string;
          updatedAt: number;
        }> }>("/api/dataplane/signals/ack/export", token, { signal: request.signal });
        request.signal.throwIfAborted();
        signalAcknowledgements = res.active ? { [res.active]: res.items || {} } : {};
      }
      if (transferSections.includes("signalHistory") && activeContext) {
        const res = await apiGet<{ active: string; items: Record<string, SignalHistoryTransferRecord> }>(
          "/api/dataplane/signals/history/export",
          token,
          { signal: request.signal },
        );
        request.signal.throwIfAborted();
        signalHistory = res.active ? { [res.active]: res.items || {} } : {};
      }
      if (transferSections.includes("investigationSnapshots")) {
        investigationSnapshots = await listSnapshotsForContexts(token, contextOptions, request.signal);
        request.signal.throwIfAborted();
      }
      const blob = new Blob([
        exportSettingsTransferJSON({
          settings,
          appState,
          sections: transferSections,
          signalAcknowledgements,
          signalHistory,
          investigationSnapshots,
          signalSuppressions,
        }),
      ], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kview-settings-transfer.json";
      a.click();
      URL.revokeObjectURL(url);
      latest.current.setImportMessage({ severity: "success", text: "Transfer bundle exported." });
    } catch (err) {
      if (request.signal.aborted) return;
      latest.current.setImportMessage({ severity: "error", text: (err as Error).message || "Export failed." });
    } finally {
      if (exportRequest.current === request) exportRequest.current = null;
    }
  };

  const applyTransferImport = async (bundle: SettingsTransferBundleV1, text: string) => {
    // Do not abort an accepted write when a duplicate Apply event arrives.
    if (importRequest.current) return;
    const available = settingsTransferSectionIds(bundle);
    const selected = transferImportSections.filter((id) => available.includes(id));
    if (selected.length === 0) {
      setTransferDialogMessage({ severity: "error", text: "Select at least one transfer section to import." });
      return;
    }
    const request = new AbortController();
    importRequest.current = request;
    setTransferImportBusy(true);
    setTransferDialogMessage(null);
    try {
      if (selected.includes("signalAcknowledgements") && bundle.sections.signalAcknowledgements) {
        await apiPost("/api/dataplane/signals/ack/import", token, {
          strategy: transferStrategy,
          contexts: bundle.sections.signalAcknowledgements,
        }, { signal: request.signal });
        request.signal.throwIfAborted();
      }
      let signalSuppressionsImportResult: { imported: number; skipped: number; replaced: number } | null = null;
      if (selected.includes("signalSuppressions") && bundle.sections.signalSuppressions) {
        const res = await apiPost<{
          active?: string;
          result?: { imported?: number; skipped?: number; replaced?: number };
        }>("/api/dataplane/signals/suppressions/import", token, {
          strategy: transferStrategy,
          items: bundle.sections.signalSuppressions.items,
        }, { signal: request.signal });
        request.signal.throwIfAborted();
        signalSuppressionsImportResult = {
          imported: res.result?.imported || 0,
          skipped: res.result?.skipped || 0,
          replaced: res.result?.replaced || 0,
        };
        dispatchSignalSuppressionsChanged();
      }
      let signalHistoryImportResult: { imported: number; skipped: number; replaced: number } | null = null;
      if (selected.includes("signalHistory") && bundle.sections.signalHistory) {
        const res = await apiPost<{
          items: Record<string, { imported: number; skipped: number; replaced: number }>;
        }>("/api/dataplane/signals/history/import", token, {
          strategy: transferStrategy,
          contexts: bundle.sections.signalHistory,
        }, { signal: request.signal });
        request.signal.throwIfAborted();
        signalHistoryImportResult = Object.values(res.items || {}).reduce(
          (total, item) => ({
            imported: total.imported + (item.imported || 0),
            skipped: total.skipped + (item.skipped || 0),
            replaced: total.replaced + (item.replaced || 0),
          }),
          { imported: 0, skipped: 0, replaced: 0 },
        );
      }
      let snapshotImportResult: Awaited<ReturnType<typeof importInvestigationSnapshotTransfer>> | null = null;
      if (selected.includes("investigationSnapshots") && bundle.sections.investigationSnapshots) {
        snapshotImportResult = await importInvestigationSnapshotTransfer({
          token,
          snapshots: bundle.sections.investigationSnapshots,
          strategy: transferStrategy,
          signal: request.signal,
        });
      }
      request.signal.throwIfAborted();
      // Merge only at the accepted local commit boundary, preserving edits made while awaiting remote writes.
      const applied = applySettingsTransferBundle({
        settings: latest.current.settings,
        appState: latest.current.appState,
        bundle,
        sections: selected,
        strategy: transferStrategy,
      });
      latest.current.replaceSettings(applied.settings);
      latest.current.setAppState(applied.appState);
      latest.current.setImportText(text);
      const signalHistorySuffix = signalHistoryImportResult
        ? ` Signal memory: ${signalHistoryImportResult.imported} imported, ${signalHistoryImportResult.skipped} skipped${signalHistoryImportResult.replaced ? `, ${signalHistoryImportResult.replaced} replaced` : ""}.`
        : "";
      const signalSuppressionsSuffix = signalSuppressionsImportResult
        ? ` Signal suppressions: ${signalSuppressionsImportResult.imported} imported, ${signalSuppressionsImportResult.skipped} skipped${signalSuppressionsImportResult.replaced ? `, ${signalSuppressionsImportResult.replaced} replaced` : ""}.`
        : "";
      const snapshotSuffix = snapshotImportResult
        ? ` Investigation snapshots: ${snapshotImportResult.imported} imported, ${snapshotImportResult.skipped} skipped${snapshotImportResult.deleted ? `, ${snapshotImportResult.deleted} replaced` : ""}.`
        : "";
      latest.current.setTransferDialogMessage({
        severity: "success",
        text: `${selected.length} section${selected.length === 1 ? "" : "s"} imported with "${settingsTransferMergeStrategies.find((item) => item.id === transferStrategy)?.label || transferStrategy}".${signalSuppressionsSuffix}${signalHistorySuffix}${snapshotSuffix}`,
      });
      latest.current.setImportMessage({ severity: "success", text: "Transfer bundle imported." });
    } catch (err) {
      if (request.signal.aborted) return;
      const message = (err as Error).message || "Import failed.";
      latest.current.setTransferDialogMessage({ severity: "error", text: message });
      latest.current.setImportMessage({ severity: "error", text: message });
    } finally {
      if (importRequest.current === request) {
        importRequest.current = null;
        setTransferImportBusy(false);
      }
    }
  };

  return { exportTransferSettings, applyTransferImport, cancelTransferImport, transferImportBusy };
}
