// @vitest-environment jsdom

import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tab, Tabs } from "@mui/material";
import { ActiveContextProvider } from "../../activeContext";
import { UserSettingsProvider } from "../../settingsContext";
import DetailTabIcon from "./DetailTabIcon";
import ResourceDrawerShell from "./ResourceDrawerShell";

function DrawerHarness() {
  const [tab, setTab] = useState(0);
  return (
    <ActiveContextProvider value="kind-dev">
      <UserSettingsProvider>
        <ResourceDrawerShell
          title="Pod: api-7f"
          resourceIcon="pods"
          resourceIdentity={{ resource: "pods", namespace: "app-prod", name: "api-7f" }}
          onClose={vi.fn()}
        >
          <>
            <Tabs value={tab} onChange={(_, value) => setTab(value)}>
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>
            <div>{tab === 0 ? "Overview content" : "YAML content"}</div>
          </>
        </ResourceDrawerShell>
      </UserSettingsProvider>
    </ActiveContextProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ResourceDrawerShell", () => {
  it("injects operator notes into the existing drawer tab row", () => {
    render(<DrawerHarness />);

    expect(screen.queryByRole("tab", { name: /details/i })).toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /overview/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /yaml/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /notes/i })).toBeTruthy();
    expect(screen.getByText("Overview content")).toBeTruthy();
    expect(screen.queryByText("Operator notes")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /notes/i }));

    expect(screen.queryByText("Overview content")).toBeNull();
    expect(screen.getByText("Operator notes")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Triage state/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Reference link/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Operator note/ }).tagName.toLowerCase()).toBe("textarea");
  });
});
