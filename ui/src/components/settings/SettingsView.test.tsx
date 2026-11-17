// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { UserSettingsProvider } from "../../settingsContext";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, defaultUserSettings, loadUserSettings, saveUserSettings } from "../../settings";
import { apiGet, apiPost, apiGetWithContext, apiPostWithContext } from "../../api";
import { SIGNAL_SUPPRESSIONS_CHANGED_EVENT } from "../../signalSuppressions";

vi.mock("../../api", () => ({
  apiGet: vi.fn(async () => ({})),
  apiGetWithContext: vi.fn(async (path: string) => path.includes("/api/dataplane/signals/catalog")
    ? {
        items: [{
          type: "pod_restarts",
          label: "Pod restarts",
          defaultEnabled: true,
          defaultPriority: 10,
          defaultSeverity: "medium",
        }],
      }
    : {}),
  apiPost: vi.fn(async () => ({})),
  apiPostWithContext: vi.fn(async () => ({})),
}));

function renderSettings(onClose = vi.fn()) {
  render(
    <UserSettingsProvider>
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={defaultKeyboardSettings()}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <SettingsView
          token="test-token"
          contexts={[{ name: "kind-test" }]}
          namespaces={["default"]}
          activeContext="kind-test"
          activeNamespace="default"
          appState={{ v: 1, favouriteNamespacesByContext: {} }}
          setAppState={vi.fn()}
          onClose={onClose}
        />
      </KeyboardProvider>
    </UserSettingsProvider>,
  );
  return onClose;
}

const validSuppression = {
  mode: "snooze" as const,
  createdAt: 1_000,
  updatedAt: 1_001,
  expiresAt: 4_600,
  fingerprintVersion: 1 as const,
  comment: "planned maintenance",
};

function suppressionTransferBundle(items: Record<string, unknown> = { "signal:valid": validSuppression }) {
  return JSON.stringify({
    kind: "kview.settingsTransfer",
    v: 1,
    exportedAt: "2026-08-27T00:00:00.000Z",
    sections: {
      signalSuppressions: {
        sourceContext: "source-prod",
        items,
      },
    },
  });
}

function openImportExport() {
  fireEvent.click(screen.getByText("Import / Export"));
}

function reviewTransferBundle(text: string) {
  fireEvent.change(screen.getByLabelText("Paste JSON"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
  return screen.getByRole("dialog", { name: "Import Transfer Bundle" });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiGet).mockReset().mockResolvedValue({});
  vi.mocked(apiPost).mockReset().mockResolvedValue({});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:kview-settings-transfer"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SettingsView dataplane edits", () => {
  it("autosaves global defaults and sparse context edits, then resets to inheritance across remount", () => {
    const initial = defaultUserSettings();
    initial.dataplane.global.backgroundBudget.longRunNoticeSec = 45;
    initial.dataplane.contextOverrides.other = { dashboard: { signalLimit: 17 } };
    saveUserSettings(initial);
    renderSettings();
    fireEvent.click(screen.getByText("Dataplane"));
    const field = () => screen.getByRole("spinbutton", { name: /^Long-run notice/ }) as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "60" } });
    expect(loadUserSettings().dataplane.global.backgroundBudget.longRunNoticeSec).toBe(60);
    fireEvent.click(screen.getByRole("button", { name: "This context" }));
    expect(field().value).toBe("60");
    fireEvent.change(field(), { target: { value: "0" } });
    expect(loadUserSettings().dataplane.contextOverrides).toEqual({
      other: { dashboard: { signalLimit: 17 } },
      "kind-test": { backgroundBudget: { longRunNoticeSec: 0 } },
    });
    cleanup();
    renderSettings();
    fireEvent.click(screen.getByText("Dataplane"));
    expect(field().value).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "This context" }));
    expect(field().value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Reset to global" }));
    expect(field().value).toBe("60");
    expect(loadUserSettings().dataplane.contextOverrides).toEqual(initial.dataplane.contextOverrides);
    fireEvent.change(field(), { target: { value: "61" } });
    fireEvent.change(field(), { target: { value: "60" } });
    expect(loadUserSettings().dataplane.contextOverrides).toEqual(initial.dataplane.contextOverrides);
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPostWithContext).not.toHaveBeenCalled();
  });
});

describe("SettingsView native scroll owners", () => {
  it("opts in only the existing side rail and main surface with default settings", () => {
    renderSettings();
    const shell = screen.getByTestId("settings-view");
    const [rail, main] = Array.from(shell.children);
    expect(shell.classList.contains("kview-native-scrollbar")).toBe(false);
    expect(getComputedStyle(shell).overflow).toBe("hidden");
    expect(rail.classList.contains("kview-native-scrollbar")).toBe(true);
    expect(getComputedStyle(rail).overflowY).toBe("auto");
    expect(main.classList.contains("kview-native-scrollbar")).toBe(true);
    expect(getComputedStyle(main).overflow).toBe("auto");
    fireEvent.click(screen.getByText("Dataplane"));
    expect(screen.getByTestId("settings-view").children[1]).toBe(main);
    expect(shell.querySelectorAll(".kview-native-scrollbar")).toHaveLength(2);
  });
});

describe("SettingsView history navigation", () => {
  it("mounts history only under Dataplane, preserves old consent and never writes on navigation", async () => {
    vi.mocked(apiGetWithContext).mockResolvedValueOnce({
      context: "kind-test", global: { enabled: true, signalHistory: false, retentionDays: 90 }, globalRevision: 0, override: {}, policy: { enabled: true, signalHistory: false, signalEpoch: "preserved-generation", retentionDays: 90, revision: 7 },
      editable: true, error: "", collector: { enabled: true },
      signalHistoryCapability: { available: true, requiresIdentityConsent: true, epochRequired: false },
    });
    renderSettings();
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(apiGetWithContext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Dataplane"));
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const consent = await screen.findByRole("switch", { name: /^Enable signal history/ });
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: /^Enable history by default/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "Include Node signals" })).toBeNull();
    expect(screen.getByRole("combobox", { name: /History retention/ }).textContent).toContain("90 days");
    expect(screen.getAllByRole("button", { name: "Global defaults" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "This context" })).toHaveLength(1);
    expect(screen.getAllByText("History", { selector: "h6" })).toHaveLength(1);
    expect(screen.queryByText(/History settings ·/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /epoch/i })).toBeNull();
    expect(apiGetWithContext).toHaveBeenCalledWith("/api/history/settings", "test-token", "kind-test", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const requestSignal = vi.mocked(apiGetWithContext).mock.calls[0][3]?.signal;
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.queryByRole("switch", { name: /^Enable signal history/ })).toBeNull();
    expect(apiPostWithContext).not.toHaveBeenCalled();
  });
});

describe("SettingsView statistics consent", () => {
  it("keeps its opt-in independent of release checking", () => {
    renderSettings();
    const statistics = screen.getByRole("switch", { name: /Share anonymous installation statistics/ }) as HTMLInputElement;
    const releases = screen.getByRole("switch", { name: /Check for kview updates/ }) as HTMLInputElement;
    expect(statistics.checked).toBe(false);
    expect(releases.checked).toBe(false);
    fireEvent.click(releases);
    expect(statistics.checked).toBe(false);
    fireEvent.click(statistics);
    expect(statistics.checked).toBe(true);
    fireEvent.click(releases);
    expect(statistics.checked).toBe(true);
    expect(releases.checked).toBe(false);
  });
});

describe("SettingsView keyboard handling", () => {
  it("closes settings on Escape", () => {
    const onClose = renderSettings();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves settings open when Escape comes from an overlay", () => {
    const onClose = renderSettings();
    const overlay = document.createElement("div");
    overlay.className = "MuiDialog-root";
    const button = document.createElement("button");
    overlay.appendChild(button);
    document.body.appendChild(overlay);

    fireEvent.keyDown(button, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SettingsView Pod tools navigation", () => {
  it("makes Pod Debug and custom commands discoverable from one menu section", () => {
    renderSettings();

    fireEvent.click(screen.getByText("Pod Debug & Commands"));

    expect(screen.getByText("Pod Debug")).toBeTruthy();
    expect(screen.getByText("Custom Commands")).toBeTruthy();
  });
});

describe("SettingsView keyboard shortcuts", () => {
  it("offers keyboard shortcuts as a transfer bundle section", () => {
    renderSettings();

    fireEvent.click(screen.getByText("Import / Export"));

    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("renders the production shortcut editor instead of legacy convenience toggles", () => {
    renderSettings();

    fireEvent.click(screen.getByText("Keyboard"));

    expect(screen.getByLabelText("Keyboard preset")).toBeTruthy();
    expect(screen.getByLabelText("Search keyboard actions")).toBeTruthy();
    expect(screen.queryByText("Vim table navigation")).toBeNull();
    expect(screen.queryByText("Home-row table navigation")).toBeNull();
    expect(screen.queryByText("Single-letter global search")).toBeNull();
  });

  it("derives keyboard definitions from custom commands and actions", () => {
    const settings = defaultUserSettings();
    settings.customCommands.commands = [{
      ...settings.customCommands.commands[0],
      id: "inspect-env",
      name: "Inspect environment",
      safety: "dangerous",
    }];
    settings.customActions.actions = [{
      ...settings.customActions.actions[0],
      id: "restart-api",
      name: "Restart API",
      enabled: false,
    }];
    saveUserSettings(settings);
    renderSettings();

    fireEvent.click(screen.getByText("Keyboard"));
    const search = screen.getByLabelText("Search keyboard actions");
    fireEvent.click(screen.getByRole("tab", { name: /^Custom Commands \(\d+\)$/ }));
    fireEvent.change(search, { target: { value: "inspect-env" } });
    expect(screen.getByText("Custom Command: Inspect environment")).toBeTruthy();
    expect(screen.getByText("Safety: dangerous")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^Custom Actions \(\d+\)$/ }));
    fireEvent.change(search, { target: { value: "restart api" } });
    expect(screen.getByText("Custom Action: Restart API")).toBeTruthy();
    expect(screen.getByText("Definition disabled")).toBeTruthy();
  });
});

describe("SettingsView signal exclusions", () => {
  it("shows the effective rule count on the Exclusions button", async () => {
    const settings = defaultUserSettings();
    settings.dataplane.global.signals.overrides.pod_restarts = {
      exclusions: {
        rules: [
          { id: "enabled", conditions: [{ source: "name", pattern: "^api-0$" }] },
          { id: "disabled", enabled: false, conditions: [{ source: "name", pattern: "^api-1$" }] },
        ],
      },
    };
    saveUserSettings(settings);
    renderSettings();

    fireEvent.click(screen.getByText("Dataplane"));
    fireEvent.click(screen.getByTestId("settings-dataplane-tab-signals"));

    expect(await screen.findByRole("button", { name: "Exclusions: 2 rules, 1 enabled" })).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  }, 30_000);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderTransferSettings() {
  const setAppState = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <UserSettingsProvider>
      <KeyboardProvider settingsOpen={false} keyboardSettings={defaultKeyboardSettings()}
        onFocusGlobalSearch={vi.fn()} onSelectSection={vi.fn()} onOpenSettings={vi.fn()}>
        {children}
      </KeyboardProvider>
    </UserSettingsProvider>
  );
  const view = (context = "kind-test", token = "test-token", publish = setAppState) => (
    <SettingsView token={token} contexts={[{ name: context }]} namespaces={["default"]}
      activeContext={context} activeNamespace="default"
      appState={{ v: 1, favouriteNamespacesByContext: {} }} setAppState={publish} onClose={vi.fn()} />
  );
  return { ...render(view(), { wrapper }), view, setAppState };
}

function mixedTransferBundle() {
  const bundle = JSON.parse(suppressionTransferBundle());
  bundle.sections.signalAcknowledgements = { "fixture-context": { "signal:ack": { acknowledgedAt: 1000, updatedAt: 1001 } } };
  bundle.sections.favourites = { favouriteNamespacesByContext: { "fixture-context": ["fixture-ns"] } };
  return JSON.stringify(bundle);
}

describe("SettingsView transfer lifecycle", () => {
  it("keeps remote order and leaves local settings/app state unchanged after a later remote failure", async () => {
    const initial = defaultUserSettings();
    initial.appearance.recentMenuLimit = 7;
    saveUserSettings(initial);
    vi.mocked(apiPost).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("second step failed"));
    const { setAppState } = renderTransferSettings();
    openImportExport();
    const dialog = reviewTransferBundle(mixedTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    await within(dialog).findByText("second step failed");
    expect(vi.mocked(apiPost).mock.calls.map(([path]) => path)).toEqual([
      "/api/dataplane/signals/ack/import", "/api/dataplane/signals/suppressions/import",
    ]);
    expect(vi.mocked(apiPost).mock.calls[0][2]).toEqual({ strategy: "useImported", contexts: {
      "fixture-context": { "signal:ack": { acknowledgedAt: 1000, updatedAt: 1001 } },
    } });
    expect(loadUserSettings()).toEqual(initial);
    expect(setAppState).not.toHaveBeenCalled();
    // A retry remains deliberate; completed remote writes are not rolled back.
    vi.mocked(apiPost).mockResolvedValue({});
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    await within(dialog).findByText(/3 sections imported/);
    expect(setAppState).toHaveBeenCalledTimes(1);
  });

  it.each(["context", "token"])("ignores obsolete import success after a %s switch", async (identity) => {
    const pending = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(pending.promise);
    const { rerender, view, setAppState } = renderTransferSettings();
    openImportExport();
    const dialog = reviewTransferBundle(mixedTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    rerender(view(identity === "context" ? "other-fixture" : "kind-test", identity === "token" ? "other-token" : "test-token"));
    await act(async () => pending.resolve({}));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(setAppState).not.toHaveBeenCalled();
    expect(screen.queryByText("Transfer bundle imported.")).toBeNull();
  });

  it("cancels a pending import without letting its rejection/finally settle a newer import", async () => {
    const old = deferred<object>();
    const latest = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { setAppState } = renderTransferSettings();
    openImportExport();
    let dialog = reviewTransferBundle(suppressionTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Import JSON" });
    dialog = reviewTransferBundle(suppressionTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    await act(async () => old.reject(new Error("obsolete failure")));
    expect(screen.queryByText("obsolete failure")).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Importing..." }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => latest.resolve({}));
    expect(setAppState).toHaveBeenCalledTimes(1);
  });

  it("does not continue remote steps or publish local changes after unmount", async () => {
    const pending = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(pending.promise);
    const { unmount, setAppState } = renderTransferSettings();
    openImportExport();
    const dialog = reviewTransferBundle(mixedTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    unmount();
    await act(async () => pending.resolve({}));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(setAppState).not.toHaveBeenCalled();
  });

  it("uses the current local settings and publisher when a pending import completes", async () => {
    const pending = deferred<object>();
    vi.mocked(apiPost).mockReturnValueOnce(pending.promise);
    const { rerender, view, setAppState } = renderTransferSettings();
    openImportExport();
    const dialog = reviewTransferBundle(suppressionTransferBundle());
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));
    // Leave the section without cancelling the mounted review; edit an unrelated preference.
    fireEvent.click(screen.getByText("Appearance"));
    fireEvent.click(screen.getByRole("switch", { name: "Check for kview updates" }));
    const nextPublisher = vi.fn();
    rerender(view("kind-test", "test-token", nextPublisher));
    await act(async () => pending.resolve({}));
    expect(loadUserSettings().appearance.releaseChecksEnabled).toBe(true);
    expect(setAppState).not.toHaveBeenCalled();
    expect(nextPublisher).toHaveBeenCalledTimes(1);
  });

  it("discards an old export after an identity change", async () => {
    const pending = deferred<object>();
    vi.mocked(apiGet).mockReturnValueOnce(pending.promise);
    const { rerender, view } = renderTransferSettings();
    openImportExport();
    fireEvent.click(screen.getByRole("button", { name: "Signal suppressions" }));
    fireEvent.click(screen.getByRole("button", { name: "Export transfer bundle" }));
    rerender(view("other-fixture"));
    await act(async () => pending.resolve({ items: {} }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText("Transfer bundle exported.")).toBeNull();
  });
});

describe("SettingsView signal suppression transfers", () => {
  it.each([
    { apiActive: "api-prod", expectedContext: "api-prod" },
    { apiActive: undefined, expectedContext: "kind-test" },
  ])("exports selected suppressions once with source context $expectedContext and normalized records", async ({ apiActive, expectedContext }) => {
    vi.mocked(apiGet).mockImplementation(async (path) => path === "/api/dataplane/signals/suppressions/export"
      ? {
          active: apiActive,
          items: {
            "signal:valid": { ...validSuppression, comment: "  planned maintenance  ", ignored: true },
            malformed: { mode: "snooze" },
          },
        }
      : {});
    renderSettings();
    openImportExport();

    fireEvent.click(screen.getByRole("button", { name: "Signal suppressions" }));
    fireEvent.click(screen.getByRole("button", { name: "Export transfer bundle" }));

    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.filter(
      ([path]) => path === "/api/dataplane/signals/suppressions/export",
    )).toHaveLength(1));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    const exported = JSON.parse(await readBlob(blob));
    expect(exported.sections.signalSuppressions).toEqual({
      sourceContext: expectedContext,
      items: { "signal:valid": validSuppression },
    });
  });

  it("does not request suppression export when the section is unselected", async () => {
    renderSettings();
    openImportExport();

    fireEvent.click(screen.getByRole("button", { name: "Export transfer bundle" }));

    await waitFor(() => expect(screen.getByText("Transfer bundle exported.")).toBeTruthy());
    expect(vi.mocked(apiGet).mock.calls.some(
      ([path]) => path === "/api/dataplane/signals/suppressions/export",
    )).toBe(false);
  });

  it("reviews and imports only normalized suppressions, reports results, and dispatches one change event", async () => {
    vi.mocked(apiPost).mockResolvedValue({ result: { imported: 2, skipped: 1, replaced: 3 } });
    const listener = vi.fn();
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
    renderSettings();
    openImportExport();
    const dialog = reviewTransferBundle(suppressionTransferBundle({
      "signal:valid": { ...validSuppression, comment: "  planned maintenance  " },
      malformed: { mode: "snooze", createdAt: 1_000 },
    }));

    expect(within(dialog).getByText("1 suppression from source-prod")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      "/api/dataplane/signals/suppressions/import",
      "test-token",
      { strategy: "useImported", items: { "signal:valid": validSuppression } },
      { signal: expect.any(AbortSignal) },
    ));
    expect(vi.mocked(apiPost).mock.calls[0]?.[2]).not.toHaveProperty("sourceContext");
    expect(vi.mocked(apiPost).mock.calls[0]?.[2]).not.toHaveProperty("context");
    expect(vi.mocked(apiPost).mock.calls[0]?.[2]).not.toHaveProperty("contexts");
    expect(vi.mocked(apiPost).mock.calls[0]?.[2]).not.toHaveProperty("active");
    expect(await within(dialog).findByText(/Signal suppressions: 2 imported, 1 skipped, 3 replaced\./)).toBeTruthy();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
  });

  it("shows suppression import failures without dispatching a change event", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("suppression import unavailable"));
    const listener = vi.fn();
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
    renderSettings();
    openImportExport();
    const dialog = reviewTransferBundle(suppressionTransferBundle());

    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));

    expect(await within(dialog).findByText("suppression import unavailable")).toBeTruthy();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
  });

  it("can deselect suppressions independently and omits their import request", async () => {
    const bundle = JSON.parse(suppressionTransferBundle());
    bundle.sections.favourites = { favouriteNamespacesByContext: { "source-prod": ["default"] } };
    renderSettings();
    openImportExport();
    const dialog = reviewTransferBundle(JSON.stringify(bundle));

    fireEvent.click(within(dialog).getByRole("button", { name: /Signal suppressions/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Import Selected Sections" }));

    await within(dialog).findByText(/1 section imported/);
    expect(vi.mocked(apiPost).mock.calls.some(
      ([path]) => path === "/api/dataplane/signals/suppressions/import",
    )).toBe(false);
  });
});
