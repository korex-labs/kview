// @vitest-environment jsdom

import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tab, Tabs } from "@mui/material";
import { ActiveContextProvider } from "../../activeContext";
import { UserSettingsProvider } from "../../settingsContext";
import {
  defaultResourceMemoryStore,
  saveResourceMemoryStore,
  upsertResourceMemoryRecord,
} from "../../resourceMemory";
import DetailTabIcon from "./DetailTabIcon";
import ResourceDrawerShell from "./ResourceDrawerShell";
import KeyboardProvider, { useKeyboardScope, type KeyboardFocusScope } from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, type KeyboardSettings } from "../../settings";
import type { Section } from "../../state";
import { drawerTabProps } from "../../keyboard/actions";

const drawerScope: KeyboardFocusScope = { id: "drawer-test", label: "Drawer", kind: "drawer", suppressGlobalShortcuts: true };
function DrawerScope() { useKeyboardScope(drawerScope); return null; }

function DrawerHarness({ initialTab = 0, keyboardSettings = defaultKeyboardSettings() }: { initialTab?: number; keyboardSettings?: KeyboardSettings }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <ActiveContextProvider value="kind-dev">
      <UserSettingsProvider>
        <KeyboardProvider
          settingsOpen={false}
          keyboardSettings={keyboardSettings}
          onFocusGlobalSearch={vi.fn()}
          onSelectSection={vi.fn<(section: Section) => void>()}
          onOpenSettings={vi.fn()}
        >
          <DrawerScope />
          <ResourceDrawerShell
            title="Pod: api-7f"
            resourceIcon="pods"
            resourceIdentity={{ resource: "pods", namespace: "app-prod", name: "api-7f" }}
            onClose={vi.fn()}
          >
            <>
              <Tabs value={tab} onChange={(_, value) => setTab(value)}>
                <Tab {...drawerTabProps("drawer.tab.overview")} icon={<DetailTabIcon label="Summary" />} iconPosition="start" label="Summary" />
                <Tab {...drawerTabProps("drawer.tab.yaml")} icon={<DetailTabIcon label="Source" />} iconPosition="start" label="Source" />
              </Tabs>
              <div>{tab === 0 ? "Overview content" : "YAML content"}</div>
            </>
          </ResourceDrawerShell>
        </KeyboardProvider>
      </UserSettingsProvider>
    </ActiveContextProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ResourceDrawerShell", () => {
  it("uses the effective remapped tab binding instead of the old drawer default", () => {
    render(<DrawerHarness
      initialTab={1}
      keyboardSettings={{ ...defaultKeyboardSettings(), overrides: { "drawer.tab.overview": [["ctrl+g", "v"]] } }}
    />);
    expect(screen.getByText("YAML content")).toBeTruthy();
    fireEvent.keyDown(window, { key: "o" });
    expect(screen.getByText("YAML content")).toBeTruthy();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v" });
    expect(screen.getByText("Overview content")).toBeTruthy();
  });

  it("injects operator notes into the existing drawer tab row", () => {
    saveResourceMemoryStore(upsertResourceMemoryRecord(defaultResourceMemoryStore(), {
      context: "kind-dev",
      resource: "pods",
      namespace: "app-prod",
      name: "api-7f",
    }, {
      status: "investigating",
      note: "Needs follow-up",
      runbookUrl: "",
    }));

    render(<DrawerHarness />);

    expect(screen.queryByRole("tab", { name: /details/i })).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /summary/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /source/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /notes/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /notes/i }).textContent).toContain("Investigating");
    expect(screen.getByText("Overview content")).toBeTruthy();
    expect(screen.queryByText("Operator notes")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /notes/i }));

    expect(screen.queryByText("Overview content")).toBeNull();
    expect(screen.getByText("Operator notes")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Triage state/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Reference link/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Operator note/ }).tagName.toLowerCase()).toBe("textarea");
  }, 20000);
});
