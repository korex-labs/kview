// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStatisticsConsent, statisticsConsent, useInstallationStatistics } from "./installationStatistics";
import { addOperatorProfile, applyOperatorProfile, defaultUserSettings, exportFullProfileJSON,
  exportSettingsTransferJSON, parseFullProfileJSON, parseSettingsTransferJSON, applySettingsTransferBundle,
  saveUserSettings } from "./settings";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await Promise.resolve(); }); }

describe("installation statistics consent", () => {
  it("defaults off, requires a token, and posts only the explicit consent to the local API", async () => {
    const hook = renderHook(({ token }) => useInstallationStatistics(token), { initialProps: { token: "" } });
    expect(statisticsConsent()).toBe(false);
    act(() => setStatisticsConsent(true));
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    hook.rerender({ token: "secret" });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/statistics", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: '{"consent":true}',
    }));
    act(() => setStatisticsConsent(false));
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately on opt-out and unmount, including cross-tab consent changes", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    setStatisticsConsent(true);
    const hook = renderHook(() => useInstallationStatistics("secret"));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    act(() => setStatisticsConsent(false));
    expect(signal?.aborted).toBe(true);
    act(() => setStatisticsConsent(true));
    const nextSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    act(() => {
      localStorage.setItem("kview:installationStatisticsConsent:v1", "false");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(nextSignal?.aborted).toBe(true);
    act(() => setStatisticsConsent(true));
    const finalSignal = vi.mocked(fetch).mock.calls[2][1]?.signal;
    hook.unmount();
    expect(finalSignal?.aborted).toBe(true);
  });

  it("skips hidden tabs, resumes on visibility, and never overlaps slow attempts", async () => {
    let visible: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible);
    setStatisticsConsent(true);
    renderHook(() => useInstallationStatistics("secret"));
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    act(() => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("does not import, export or apply consent through full profiles and transfer bundles", () => {
    const settings = addOperatorProfile(defaultUserSettings(), { name: "Test" });
    const appState = { v: 1 as const, favouriteNamespacesByContext: {} };
    setStatisticsConsent(true);
    const full = exportFullProfileJSON({ settings, appState });
    const transfer = exportSettingsTransferJSON({ settings, appState, sections: ["keyboard"] });
    expect(full + transfer).not.toMatch(/installationStatistics|installation_id/);
    setStatisticsConsent(false);
    const injected = JSON.parse(full);
    injected.settings.installationStatisticsConsent = true;
    injected.settings.appearance.installationStatisticsConsent = true;
    const imported = parseFullProfileJSON(JSON.stringify(injected));
    saveUserSettings(imported!.settings);
    saveUserSettings(applyOperatorProfile(settings, settings.operatorProfiles.definitions[0].id));
    const bundle = parseSettingsTransferJSON(transfer);
    saveUserSettings(applySettingsTransferBundle({ settings, appState, bundle, sections: ["keyboard"], strategy: "replaceSections" }).settings);
    expect(statisticsConsent()).toBe(false);
  });

  it("stops even if writing an opt-out fails", async () => {
    setStatisticsConsent(true);
    renderHook(() => useInstallationStatistics("secret"));
    await flush();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    act(() => setStatisticsConsent(false));
    expect(statisticsConsent()).toBe(false);
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors cross-tab enable after opt-out and fails closed on a failed opt-out write", async () => {
    setStatisticsConsent(true);
    renderHook(() => useInstallationStatistics("secret"));
    await flush();
    act(() => setStatisticsConsent(false));
    act(() => {
      localStorage.setItem("kview:installationStatisticsConsent:v1", "true");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    await flush();
    expect(statisticsConsent()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    act(() => setStatisticsConsent(false));
    expect(statisticsConsent()).toBe(false);
    await act(async () => { vi.advanceTimersByTime(30 * 60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    act(() => setStatisticsConsent(true));
    renderHook(() => useInstallationStatistics("secret"));
    expect(statisticsConsent()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
