// @vitest-environment jsdom
import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { UserSettingsProvider, useUserSettings } from "../../settingsContext";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, defaultUserSettings, exportFullProfileJSON, exportSettingsTransferJSON, loadUserSettings, operatorProfileSnapshotFromSettings, saveUserSettings } from "../../settings";
import { apiGetWithContext, apiPost } from "../../api";
import type { AppStateV1 } from "../../state";

vi.mock("../../api", () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiGetWithContext: vi.fn(), apiPostWithContext: vi.fn() }));
const initialState: AppStateV1 = { v: 1, activeContext: "fixture-a", activeNamespace: "demo", favouriteNamespacesByContext: {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount() {
  const publish = vi.fn();
  let edit!: ReturnType<typeof useUserSettings>["setSettings"];
  function Probe() {
    const { setSettings } = useUserSettings();
    useEffect(() => { edit = setSettings; }, [setSettings]);
    return null;
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => <UserSettingsProvider>
    <KeyboardProvider settingsOpen={false} keyboardSettings={defaultKeyboardSettings()} onFocusGlobalSearch={vi.fn()} onSelectSection={vi.fn()} onOpenSettings={vi.fn()}>
      <Probe />{children}
    </KeyboardProvider>
  </UserSettingsProvider>;
  const view = (context = "fixture-a", token = "fixture-token") => <SettingsView token={token} activeContext={context}
    activeNamespace="demo" contexts={[{ name: context }]} namespaces={["demo"]} appState={initialState} setAppState={publish} onClose={vi.fn()} />;
  const mounted = render(view(), { wrapper });
  fireEvent.click(screen.getByText("Import / Export"));
  return { ...mounted, publish, view, edit: (update: Parameters<typeof edit>[0]) => act(() => edit(update)) };
}
function upload(text: string | Promise<string>) {
  const file = new File([], "settings.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
function paste(text: string) {
  fireEvent.change(screen.getByLabelText("Paste JSON"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
}
function acknowledge(dialog: HTMLElement) {
  const checkbox = within(dialog).queryByRole("checkbox", { name: "I understand the normalization changes" });
  if (checkbox && !(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
}
function applyButton(dialog: HTMLElement) { return within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement; }

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(apiGetWithContext).mockImplementation(async (_path, _token, context) => ({ active: context, items: {} }));
  vi.mocked(apiPost).mockResolvedValue({});
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("SettingsView JSON import review", () => {
  it.each(["raw", "full", "selective"])("uploads %s without native confirmation or mutation and Cancel discards it", async (kind) => {
    const initial = defaultUserSettings();
    saveUserSettings(initial);
    const { publish } = mount();
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const incoming = defaultUserSettings();
    incoming.logs.wrap = false;
    const text = kind === "raw" ? JSON.stringify(incoming) : kind === "full" ? exportFullProfileJSON({ settings: incoming, appState: { ...initialState, activeContext: "fixture-b" } })
      : exportSettingsTransferJSON({ settings: incoming, appState: initialState, sections: ["logs"] });
    upload(text);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/Added \d+ · Changed 1 · Removed \d+/).length).toBeGreaterThan(0);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    expect(loadUserSettings()).toEqual(initial);
  });

  it("applies only Appearance from raw settings, preserving every other section exactly", async () => {
    const initial = defaultUserSettings();
    initial.logs.wrap = false;
    initial.dataplane.contextOverrides = { isolated: { profile: "wide" } };
    saveUserSettings(initial);
    const { publish } = mount();
    const incoming = defaultUserSettings();
    incoming.appearance.textViewerFontSizePx = 18;
    upload(JSON.stringify(incoming));
    const dialog = await screen.findByRole("dialog", { name: "Import Settings" });
    acknowledge(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Deselect all" }));
    expect(applyButton(dialog).disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("Appearance"));
    fireEvent.click(applyButton(dialog));
    expect(loadUserSettings()).toEqual({ ...initial, appearance: incoming.appearance });
    expect(publish).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("pastes a full profile without losing saved profiles, and changes navigation only when explicitly selected on Apply", () => {
    const initial = defaultUserSettings();
    saveUserSettings(initial);
    const { publish } = mount();
    const incoming = defaultUserSettings();
    incoming.operatorProfiles = { activeProfileId: "saved", definitions: [{ id: "saved", name: "Saved", description: "Offline", createdAt: 1, updatedAt: 2, snapshot: operatorProfileSnapshotFromSettings(incoming) }] };
    const appState = { ...initialState, activeContext: "fixture-b" };
    paste(exportFullProfileJSON({ settings: incoming, appState }));
    const dialog = screen.getByRole("dialog", { name: "Import Full Profile" });
    acknowledge(dialog);
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Deselect all" }));
    fireEvent.click(within(dialog).getByLabelText("Saved operator profiles"));
    fireEvent.click(within(dialog).getByLabelText("Navigation, favourites and layout"));
    fireEvent.click(applyButton(dialog));
    expect(loadUserSettings().operatorProfiles).toEqual(incoming.operatorProfiles);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ activeContext: "fixture-b" }));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("refreshes stale local differences and requires another Apply while preserving excluded edits", () => {
    const { edit } = mount();
    const incoming = defaultUserSettings();
    incoming.appearance.textViewerFontSizePx = 18;
    paste(JSON.stringify(incoming));
    const dialog = screen.getByRole("dialog");
    acknowledge(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Deselect all" }));
    fireEvent.click(within(dialog).getByLabelText("Appearance"));
    edit((prev) => ({ ...prev, logs: { ...prev.logs, wrap: false }, appearance: { ...prev.appearance, textViewerFontSizePx: 16 } }));
    fireEvent.click(applyButton(dialog));
    expect(within(dialog).getByText(/Differences have been refreshed/)).toBeTruthy();
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(16);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Show differences" })[0]);
    expect(within(dialog).getByText("Before: 16")).toBeTruthy();
    fireEvent.click(applyButton(dialog));
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(18);
    expect(loadUserSettings().logs.wrap).toBe(false);
  });

  it("blocks a failed remote baseline without fabricated counts; retry and deselection recover", async () => {
    vi.mocked(apiGetWithContext).mockRejectedValueOnce(new Error("offline"));
    mount();
    const incoming = defaultUserSettings();
    incoming.logs.wrap = false;
    const text = exportSettingsTransferJSON({ settings: incoming, appState: initialState, sections: ["logs", "signalAcknowledgements"],
      signalAcknowledgements: { "fixture-a": { sample: { acknowledgedAt: 1, updatedAt: 1 } } } });
    paste(text);
    const dialog = screen.getByRole("dialog");
    acknowledge(dialog);
    await within(dialog).findByText(/Current values unavailable/);
    expect(applyButton(dialog).disabled).toBe(true);
    const remoteRow = within(dialog).getByLabelText("Signal acknowledgements").closest('label')!.parentElement!.parentElement!;
    expect(within(remoteRow).queryByText(/Added \d/)).toBeNull();
    fireEvent.click(within(dialog).getByLabelText("Signal acknowledgements"));
    expect(applyButton(dialog).disabled).toBe(false);
    fireEvent.click(within(dialog).getByLabelText("Signal acknowledgements"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry current values" }));
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false));
    expect(apiGetWithContext).toHaveBeenCalledWith("/api/dataplane/signals/ack/export", "fixture-token", "fixture-a", { signal: expect.any(AbortSignal) });
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("refreshes baselines after partial remote failure without retrying writes or losing the dialog error", async () => {
    const initial = defaultUserSettings();
    saveUserSettings(initial);
    const { publish } = mount();
    const incoming = defaultUserSettings();
    incoming.logs.wrap = false;
    vi.mocked(apiPost).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("second remote failed"));
    paste(exportSettingsTransferJSON({ settings: incoming, appState: initialState,
      sections: ["logs", "signalAcknowledgements", "signalSuppressions"],
      signalAcknowledgements: { "fixture-a": { sample: { acknowledgedAt: 1, updatedAt: 1 } } },
      signalSuppressions: { sourceContext: "fixture-a", items: { sample: {
        mode: "snooze", createdAt: 1, updatedAt: 1, expiresAt: 3601, fingerprintVersion: 1,
      } } },
    }));
    const dialog = screen.getByRole("dialog");
    acknowledge(dialog);
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false));
    const baselineReads = vi.mocked(apiGetWithContext).mock.calls.length;
    fireEvent.click(applyButton(dialog));
    await within(dialog).findByText(/second remote failed.*Local settings were not applied/);
    await waitFor(() => expect(vi.mocked(apiGetWithContext).mock.calls.length).toBe(baselineReads * 2));
    await waitFor(() => expect(applyButton(dialog).disabled).toBe(false));
    expect(within(dialog).getByText(/Earlier remote writes may already have completed/)).toBeTruthy();
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiPost).mock.calls.map(([path]) => path)).toEqual([
      "/api/dataplane/signals/ack/import", "/api/dataplane/signals/suppressions/import",
    ]);
    expect(loadUserSettings()).toEqual(initial);
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(loadUserSettings()).toEqual(initial);
  });

  it("shows a brief normalization acknowledgement and permits valid normalized imports", () => {
    mount();
    const incoming = { ...defaultUserSettings(), futureSecret: "never-display" };
    incoming.appearance.textViewerFontSizePx = 18;
    paste(JSON.stringify(incoming));
    const dialog = screen.getByRole("dialog");
    expect(applyButton(dialog).disabled).toBe(true);
    expect(dialog.textContent).not.toContain("never-display");
    acknowledge(dialog);
    fireEvent.click(applyButton(dialog));
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(18);
    expect(loadUserSettings()).not.toHaveProperty("futureSecret");
  });

  it("lets file B win over late file A and catches parse/read failures", async () => {
    mount();
    const a = deferred<string>();
    const b = defaultUserSettings();
    b.logs.wrap = false;
    upload(a.promise);
    upload(JSON.stringify(b));
    const dialog = await screen.findByRole("dialog");
    await act(async () => a.resolve('{"v":3}'));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.queryByText(/Unsupported/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    upload("{");
    await screen.findByText("Settings JSON is not valid.");
    expect(screen.queryByRole("dialog")).toBeNull();
    upload(Promise.reject(new Error("read failed")));
    await screen.findByText("read failed");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it.each(["context", "token", "unmount"])("ignores file completion after %s invalidation", async (change) => {
    const mounted = mount();
    const pending = deferred<string>();
    upload(pending.promise);
    if (change === "unmount") mounted.unmount();
    else mounted.rerender(mounted.view(change === "context" ? "fixture-b" : "fixture-a", change === "token" ? "new-token" : "fixture-token"));
    await act(async () => pending.resolve(JSON.stringify(defaultUserSettings())));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mounted.publish).not.toHaveBeenCalled();
  });
});
