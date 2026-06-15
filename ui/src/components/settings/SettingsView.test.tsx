// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";
import { UserSettingsProvider } from "../../settingsContext";
import KeyboardProvider from "../../keyboard/KeyboardProvider";

function renderSettings(onClose = vi.fn()) {
  render(
    <UserSettingsProvider>
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{
          vimTableNavigation: true,
          homeRowTableNavigation: true,
          singleLetterGlobalSearch: true,
        }}
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
