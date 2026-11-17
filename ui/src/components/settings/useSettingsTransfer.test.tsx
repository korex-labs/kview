// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiGetWithContext, apiPost } from "../../api";
import { defaultUserSettings, type SettingsTransferBundleV1, type SettingsTransferMergeStrategy } from "../../settings";
import type { InvestigationSnapshot } from "../../types/api";
import { INVESTIGATION_SNAPSHOTS_CHANGED_EVENT } from "../../investigationSnapshots";
import { SIGNAL_SUPPRESSIONS_CHANGED_EVENT } from "../../signalSuppressions";
import { useSettingsTransfer } from "./useSettingsTransfer";

vi.mock("../../api", () => ({ apiGet: vi.fn(), apiGetWithContext: vi.fn(), apiPost: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function options(): Parameters<typeof useSettingsTransfer>[0] {
  return {
    token: "fixture-token", activeContext: "fixture-a", contextOptions: ["fixture-a", "fixture-b", " fixture-a ", ""],
    settings: defaultUserSettings(), appState: { v: 1, favouriteNamespacesByContext: {} },
    transferSections: ["signalSuppressions", "signalAcknowledgements", "signalHistory", "investigationSnapshots"],
    transferImportSections: ["signalSuppressions"], transferStrategy: "useImported",
    replaceSettings: vi.fn(), setAppState: vi.fn(), setImportText: vi.fn(),
    setImportMessage: vi.fn(), setTransferDialogMessage: vi.fn(),
  };
}

const snapshot: InvestigationSnapshot = {
  id: "incoming", context: "fixture-a", title: "Fixture investigation", createdAt: 1000,
  triageState: "investigating", signal: { type: "fixture-signal", title: "Fixture signal" },
  primaryResource: { kind: "pods", namespace: "fixture-ns", name: "fixture-pod" },
  relatedResources: [], relatedSignalTypes: [], markdown: "Fixture evidence", operatorNote: "", runbookUrls: [], source: "investigate-signal",
};
const suppression = { mode: "snooze" as const, createdAt: 1000, updatedAt: 1001, expiresAt: 4600, fingerprintVersion: 1 as const };
function bundle(sections: SettingsTransferBundleV1["sections"] = { signalSuppressions: { sourceContext: "fixture-a", items: { "signal:fixture": suppression } } }): SettingsTransferBundleV1 {
  return { kind: "kview.settingsTransfer", v: 1, exportedAt: "2026-01-01T00:00:00.000Z", sections };
}
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockResolvedValue({});
  vi.mocked(apiGetWithContext).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(apiPost).mockReset().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:fixture") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("selective settings transfer orchestration", () => {
  it("exports in the existing order, scopes/deduplicates snapshots, and keeps the file contract", async () => {
    const opts = options();
    const order: string[] = [];
    const acknowledgement = { acknowledgedAt: 1000, acknowledgedBy: "fixture-operator", comment: "Reviewed", updatedAt: 1001 };
    const history = { firstSeenAt: 1000, lastSeenAt: 2000, seenCount: 2, observedDays: [1, 2] };
    vi.mocked(apiGet).mockImplementation(async (path) => {
      order.push(path);
      if (path.includes("suppressions")) return { items: { valid: suppression, invalid: { mode: "snooze" } } };
      return { active: "fixture-a", items: { "signal:fixture": path.includes("/ack/") ? acknowledgement : history } };
    });
    vi.mocked(apiGetWithContext).mockImplementation(async (path, _token, context) => {
      order.push(`${path}:${context}`);
      return { items: context === "fixture-a" ? [snapshot, snapshot] : [] };
    });
    const { result } = renderHook(() => useSettingsTransfer(opts));
    await act(() => result.current.exportTransferSettings());
    expect(order).toEqual([
      "/api/dataplane/signals/suppressions/export", "/api/dataplane/signals/ack/export", "/api/dataplane/signals/history/export",
      "/api/investigations/snapshots:fixture-a", "/api/investigations/snapshots:fixture-b",
    ]);
    const signal = vi.mocked(apiGet).mock.calls[0][2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(vi.mocked(apiGetWithContext).mock.calls).toEqual([
      ["/api/investigations/snapshots", "fixture-token", "fixture-a", { signal }],
      ["/api/investigations/snapshots", "fixture-token", "fixture-b", { signal }],
    ]);
    const file = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(file.type).toBe("application/json");
    const exported = JSON.parse(await blobText(file));
    expect(exported.sections.signalSuppressions).toEqual({ sourceContext: "fixture-a", items: { valid: suppression } });
    expect(exported.kind).toBe("kview.settingsTransfer");
    expect(exported.v).toBe(1);
    expect(exported.sections.signalAcknowledgements).toEqual({ "fixture-a": { "signal:fixture": acknowledgement } });
    expect(exported.sections.signalHistory).toEqual({ "fixture-a": { "signal:fixture": history } });
    expect(exported.sections.investigationSnapshots).toHaveLength(1);
    const clicked = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts[0] as HTMLAnchorElement;
    expect(clicked.download).toBe("kview-settings-transfer.json");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
  });

  it("lets the latest export win without an old rejection/finally aborting it", async () => {
    const old = deferred<object>();
    const latest = deferred<object>();
    vi.mocked(apiGet).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const opts = { ...options(), transferSections: ["signalSuppressions"] as const };
    const { result } = renderHook(() => useSettingsTransfer({ ...opts, transferSections: [...opts.transferSections] }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.exportTransferSettings(); second = result.current.exportTransferSettings(); });
    const [oldRequest, newRequest] = vi.mocked(apiGet).mock.calls.map((call) => call[2]?.signal);
    expect(oldRequest?.aborted).toBe(true);
    await act(async () => { old.reject(new Error("old export failed")); await first; });
    expect(newRequest?.aborted).toBe(false);
    expect(opts.setImportMessage).not.toHaveBeenCalled();
    await act(async () => { latest.resolve({ items: {} }); await second; });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(opts.setImportMessage).toHaveBeenCalledWith({ severity: "success", text: "Transfer bundle exported." });
  });

  it("ignores duplicate Apply without aborting the accepted write and cancels without publishing", async () => {
    const pending = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(pending.promise);
    const opts = options();
    const changed = vi.fn();
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, changed);
    const { result } = renderHook(() => useSettingsTransfer(opts));
    let first!: Promise<void>;
    act(() => { first = result.current.applyTransferImport(bundle(), "fixture"); });
    await act(() => result.current.applyTransferImport(bundle(), "duplicate"));
    expect(apiPost).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(apiPost).mock.calls[0][3]?.signal;
    expect(signal?.aborted).toBe(false);
    act(() => result.current.cancelTransferImport());
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({}); await first; });
    expect(opts.replaceSettings).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, changed);
  });

  it.each(["context", "token"])("protects the newer import busy state and callbacks on a %s switch", async (identity) => {
    const old = deferred<object>();
    const latest = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const opts = options();
    const { result, rerender } = renderHook(useSettingsTransfer, { initialProps: opts });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.applyTransferImport(bundle(), "old"); });
    const next = { ...options(), activeContext: identity === "context" ? "fixture-b" : opts.activeContext, token: identity === "token" ? "other-token" : opts.token };
    rerender(next);
    act(() => { second = result.current.applyTransferImport(bundle(), "latest"); });
    expect(vi.mocked(apiPost).mock.calls[0][3]?.signal?.aborted).toBe(true);
    await act(async () => { old.reject(new Error("obsolete")); await first; });
    expect(result.current.transferImportBusy).toBe(true);
    expect(next.setImportMessage).not.toHaveBeenCalled();
    expect(opts.replaceSettings).not.toHaveBeenCalled();
    await act(async () => { latest.resolve({}); await second; });
    expect(result.current.transferImportBusy).toBe(false);
    expect(next.replaceSettings).toHaveBeenCalledTimes(1);
    expect(next.setImportText).toHaveBeenCalledWith("latest");
  });

  it.each<SettingsTransferMergeStrategy>(["keepMine", "useImported", "replaceSections"])("preserves snapshot %s matching and replacement order", async (strategy) => {
    const opts = options();
    opts.transferStrategy = strategy;
    opts.transferImportSections = ["investigationSnapshots"];
    const existing = { ...snapshot, id: "stored" };
    const order: string[] = [];
    vi.mocked(apiGetWithContext).mockImplementation(async () => { order.push("list"); return { items: [existing] }; });
    vi.mocked(fetch).mockImplementation(async () => { order.push("delete"); return { ok: true } as Response; });
    vi.mocked(apiPost).mockImplementation(async (_path, _token, value) => { order.push("save"); return { item: value }; });
    const { result } = renderHook(() => useSettingsTransfer(opts));
    await act(() => result.current.applyTransferImport(bundle({ investigationSnapshots: [snapshot, snapshot] }), "snapshots"));
    expect(order).toEqual(strategy === "keepMine" ? ["list"] : strategy === "replaceSections" ? ["list", "delete", "save"] : ["list", "save"]);
    if (strategy !== "keepMine") {
      expect(vi.mocked(apiPost).mock.calls[0][2]).toEqual({ ...snapshot, id: strategy === "useImported" ? "stored" : "incoming" });
    }
    if (strategy === "replaceSections") expect(fetch).toHaveBeenCalledWith("/api/investigations/snapshots/stored", expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }));
    expect(opts.setTransferDialogMessage).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "success", text: expect.stringContaining(strategy === "keepMine" ? "0 imported, 1 skipped" : "1 imported, 0 skipped") }));
  });

  it.each(["list", "delete", "save"])("stops after cancellation during snapshot %s, including stale notification suppression", async (step) => {
    const pending = deferred<unknown>();
    const opts = options();
    opts.transferImportSections = ["investigationSnapshots"];
    opts.transferStrategy = step === "delete" ? "replaceSections" : "useImported";
    vi.mocked(apiGetWithContext).mockImplementation(async () => step === "list" ? pending.promise : { items: step === "delete" ? [{ ...snapshot, id: "stored" }, { ...snapshot, id: "stored-2" }] : [] });
    vi.mocked(fetch).mockImplementation(async () => pending.promise as Promise<Response>);
    vi.mocked(apiPost).mockImplementation(async () => pending.promise);
    const notify = vi.fn();
    window.addEventListener(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT, notify);
    const { result, unmount } = renderHook(() => useSettingsTransfer(opts));
    let run!: Promise<void>;
    await act(async () => { run = result.current.applyTransferImport(bundle({ investigationSnapshots: [snapshot, { ...snapshot, id: "second" }] }), "snapshots"); });
    unmount();
    await act(async () => { pending.resolve(step === "list" ? { items: [] } : step === "delete" ? { ok: true } : { item: snapshot }); await run; });
    expect(apiPost).toHaveBeenCalledTimes(step === "save" ? 1 : 0);
    expect(fetch).toHaveBeenCalledTimes(step === "delete" ? 1 : 0);
    expect(opts.replaceSettings).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    window.removeEventListener(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT, notify);
  });

  it("keeps Signal memory separate from History and commits locally only after every selected remote step", async () => {
    const opts = options();
    opts.transferImportSections = ["signalAcknowledgements", "signalSuppressions", "signalHistory", "investigationSnapshots", "favourites"];
    const incoming = bundle({
      signalAcknowledgements: { "fixture-a": {} }, signalSuppressions: { sourceContext: "fixture-a", items: { fixture: suppression } },
      signalHistory: { "fixture-a": {}, "fixture-b": {} }, investigationSnapshots: [snapshot],
      favourites: { favouriteNamespacesByContext: { "fixture-b": ["fixture-ns"] } },
    });
    const order: string[] = [];
    vi.mocked(apiPost).mockImplementation(async (path) => {
      order.push(path);
      expect(opts.replaceSettings).not.toHaveBeenCalled();
      if (path.includes("/history/")) return { items: { "fixture-a": { imported: 1, skipped: 2, replaced: 0 }, "fixture-b": { imported: 3, skipped: 4, replaced: 5 } } };
      if (path.includes("snapshots")) return { item: snapshot };
      return { result: { imported: 1 } };
    });
    const { result } = renderHook(() => useSettingsTransfer(opts));
    await act(() => result.current.applyTransferImport(incoming, "all"));
    expect(order).toEqual(["/api/dataplane/signals/ack/import", "/api/dataplane/signals/suppressions/import", "/api/dataplane/signals/history/import", "/api/investigations/snapshots"]);
    expect(vi.mocked(apiPost).mock.calls[2][2]).toEqual({ strategy: "useImported", contexts: incoming.sections.signalHistory });
    expect(opts.setAppState).toHaveBeenCalledWith(expect.objectContaining({ favouriteNamespacesByContext: { "fixture-b": ["fixture-ns"] } }));
    expect(opts.setTransferDialogMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Signal memory: 4 imported, 6 skipped, 5 replaced.") }));
    expect(opts.replaceSettings).toHaveBeenCalledTimes(1);
  });
});
