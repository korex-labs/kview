// @vitest-environment jsdom

import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Box, CircularProgress, Tab, Tabs } from "@mui/material";
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
import { drawerTabActionAttribute, drawerTabProps } from "../../keyboard/actions";

vi.mock("./ResourceMapPanel", () => ({
  default: ({ identity, onOpenResource }: { identity: { resource: string }; onOpenResource: (identity: object) => void }) => React.createElement("div", { "data-testid": "resource-map-panel" },
    identity.resource,
    React.createElement("button", { onClick: () => onOpenResource({ group: "", version: "v1", resource: "pods", kind: "Pod", scope: "namespaced", namespace: "app-prod", name: "api-child" }) }, "Open related Pod")),
}));
vi.mock("./ResourceIdentityDrawer", () => ({
  default: ({ identity, onClose }: { identity: { resource?: string; name?: string } | null; onClose: () => void }) => identity
    ? React.createElement("div", { "data-testid": "linked-resource-drawer" }, `${identity.resource}:${identity.name}`, React.createElement("button", { onClick: onClose }, "Close related drawer"))
    : null,
}));

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
            token="token"
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
  it("injects Resource Map before Notes and mounts it lazily with linked drawer navigation", () => {
    render(<DrawerHarness />);
    const labels = screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label") || tab.textContent);
    expect(labels).toEqual(["Summary", "Source", "Resource Map", "Notes"]);
    expect(screen.queryByTestId("resource-map-panel")).toBeNull();

    const mapTab = screen.getByRole("tab", { name: "Resource Map" });
    expect(mapTab.getAttribute(drawerTabActionAttribute)).toBe("drawer.tab.resourceMap");
    fireEvent.click(mapTab);
    expect(screen.queryByText("Overview content")).toBeNull();
    expect(screen.getByTestId("resource-map-panel").textContent).toContain("pods");
    fireEvent.click(screen.getByRole("button", { name: "Open related Pod" }));
    expect(screen.getByTestId("linked-resource-drawer").textContent).toContain("pods:api-child");
    fireEvent.click(screen.getByRole("button", { name: "Close related drawer" }));
    expect(screen.queryByTestId("linked-resource-drawer")).toBeNull();
    expect(screen.getByTestId("resource-map-panel")).toBeTruthy();
  });

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

  it("keeps Resource Map available when native detail content failed", () => {
    render(<UserSettingsProvider><ResourceDrawerShell title="Pod: api" resourceIcon="pods" token="token" resourceIdentity={{ resource: "pods", namespace: "prod", name: "api" }} onClose={vi.fn()}><div role="alert">Detail unavailable</div></ResourceDrawerShell></UserSettingsProvider>);
    expect(screen.getByText("Detail unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Resource Map" }));
    expect(screen.queryByText("Detail unavailable")).toBeNull();
    expect(screen.getByTestId("resource-map-panel")).toBeTruthy();
  });

  it("waits for native tabs instead of flashing auxiliary tabs during loading", () => {
    const shell = (children: React.ReactNode) => (
      <UserSettingsProvider>
        <ResourceDrawerShell title="Pod: api" resourceIcon="pods" token="token" resourceIdentity={{ resource: "pods", namespace: "prod", name: "api" }} onClose={vi.fn()}>
          {children}
        </ResourceDrawerShell>
      </UserSettingsProvider>
    );
    const view = render(shell(<Box><CircularProgress aria-label="Loading detail" /></Box>));
    expect(screen.getByLabelText("Loading detail")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Resource Map" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Notes" })).toBeNull();

    view.rerender(shell(<><Tabs value={0}><Tab label="Summary" /><Tab label="Source" /></Tabs><div>Overview content</div></>));
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label") || tab.textContent)).toEqual(["Summary", "Source", "Resource Map", "Notes"]);
  });

  it("preserves string-valued native tab behavior", () => {
    function StringTabs() {
      const [tab, setTab] = useState("summary");
      return <ResourceDrawerShell title="Pod: api" resourceIcon="pods" token="token" resourceIdentity={{ resource: "pods", namespace: "prod", name: "api" }} onClose={vi.fn()}><><Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label="Summary" value="summary" /><Tab label="Source" value="source" /></Tabs><div>{tab}</div></></ResourceDrawerShell>;
    }
    render(<UserSettingsProvider><StringTabs /></UserSettingsProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Resource Map" }));
    expect(screen.getByTestId("resource-map-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("source")).toBeTruthy();
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
    expect(screen.getByRole("tab", { name: /^source$/i })).toBeTruthy();
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
