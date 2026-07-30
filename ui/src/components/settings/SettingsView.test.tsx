// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { UserSettingsProvider } from "../../settingsContext";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, defaultUserSettings, saveUserSettings } from "../../settings";

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

afterEach(() => {
  cleanup();
  localStorage.clear();
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
