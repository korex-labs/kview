// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { UserSettingsProvider } from "../../settingsContext";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, defaultUserSettings, saveUserSettings } from "../../settings";
import { apiGet, apiPost } from "../../api";
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
  vi.mocked(apiGet).mockResolvedValue({});
  vi.mocked(apiPost).mockResolvedValue({});
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
