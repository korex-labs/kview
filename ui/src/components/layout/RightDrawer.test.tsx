// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tab, Tabs } from "@mui/material";
import { afterEach, describe, expect, it, vi } from "vitest";
import RightDrawer from "./RightDrawer";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import ResourceDrawerShell from "../shared/ResourceDrawerShell";
import { UserSettingsProvider } from "../../settingsContext";
import { defaultKeyboardSettings } from "../../settings";
import { drawerTabProps } from "../../keyboard/actions";

function KeyboardHarness({ children }: { children: React.ReactNode }) {
  return (
    <UserSettingsProvider>
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={defaultKeyboardSettings()}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        {children}
      </KeyboardProvider>
    </UserSettingsProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("RightDrawer", () => {
  it("closes stacked drawers from the top down on repeated Escape presses", async () => {
    const closed: string[] = [];

    function Harness() {
      const [firstOpen, setFirstOpen] = useState(true);
      const [secondOpen, setSecondOpen] = useState(true);

      return (
        <>
          <RightDrawer
            open={firstOpen}
            onClose={() => {
              closed.push("first");
              setFirstOpen(false);
            }}
          >
            <div>First drawer</div>
          </RightDrawer>
          <RightDrawer
            open={secondOpen}
            onClose={() => {
              closed.push("second");
              setSecondOpen(false);
            }}
          >
            <div>Second drawer</div>
          </RightDrawer>
        </>
      );
    }

    render(<KeyboardHarness><Harness /></KeyboardHarness>);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(closed).toEqual(["second"]));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(closed).toEqual(["second", "first"]));
  });

  it("leaves drawers open when Escape is handled by a dialog-like overlay", () => {
    const closed: string[] = [];
    const { container } = render(
      <KeyboardHarness>
        <RightDrawer open onClose={() => closed.push("drawer")}>
          <div>Drawer</div>
        </RightDrawer>
        <div className="MuiDialog-root">
          <button type="button">Dialog action</button>
        </div>
      </KeyboardHarness>,
    );

    const dialogButton = container.querySelector(".MuiDialog-root button");
    expect(dialogButton).not.toBeNull();

    fireEvent.keyDown(dialogButton!, { key: "Escape" });

    expect(closed).toEqual([]);
  });

  it("closes from the native MUI Escape close event", async () => {
    const closed: string[] = [];
    render(
      <KeyboardHarness>
        <RightDrawer open onClose={() => closed.push("drawer")}>
          <div>Drawer</div>
        </RightDrawer>
      </KeyboardHarness>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(closed).toEqual(["drawer"]));
  });

  it("expands, restores, and resets a resource drawer when it closes", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
          <RightDrawer open={open} onClose={() => setOpen(false)}>
            <ResourceDrawerShell title="Pod: api" resourceIcon="pods" onClose={() => setOpen(false)}>
              <div>Pod details</div>
            </ResourceDrawerShell>
          </RightDrawer>
        </>
      );
    }

    render(<KeyboardHarness><Harness /></KeyboardHarness>);
    const drawerPaper = () => document.querySelector<HTMLElement>(".MuiDrawer-paper");
    expect(drawerPaper()?.classList.contains("kview-right-drawer-expanded")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Expand drawer to full screen" }));
    await waitFor(() => expect(drawerPaper()?.classList.contains("kview-right-drawer-expanded")).toBe(true));
    const expandedStyle = window.getComputedStyle(drawerPaper()!);
    expect(expandedStyle.marginTop).toBe("64px");
    expect(expandedStyle.height).toContain("100% - 64px");
    expect(screen.getByRole("button", { name: "Restore drawer size" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore drawer size" }));
    await waitFor(() => expect(drawerPaper()?.classList.contains("kview-right-drawer-expanded")).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Expand drawer to full screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    await waitFor(() => expect(drawerPaper()).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));
    await waitFor(() => expect(drawerPaper()?.classList.contains("kview-right-drawer-expanded")).toBe(false));
    expect(screen.getByRole("button", { name: "Expand drawer to full screen" })).toBeTruthy();
  });

  it("opens keyboard help while a resource drawer has focus", async () => {
    render(
      <KeyboardHarness>
        <RightDrawer open onClose={vi.fn()}>
          <ResourceDrawerShell title="Namespace: default" resourceIcon="namespaces" onClose={vi.fn()}>
            <button type="button" role="tab">Overview</button>
          </ResourceDrawerShell>
        </RightDrawer>
      </KeyboardHarness>,
    );

    await waitFor(() => expect(screen.getByTestId("drawer-namespaces")).toBeTruthy());
    fireEvent.keyDown(window, { key: "?" });

    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("registers tab shortcuts only for the open drawer", async () => {
    function PodContents({ title }: { title: string }) {
      const [tab, setTab] = useState(0);
      return (
        <ResourceDrawerShell title={title} resourceIcon="pods" onClose={vi.fn()}>
          <>
            <Tabs value={tab} onChange={(_event, value: number) => setTab(value)}>
              <Tab {...drawerTabProps("drawer.tab.overview")} label="Overview" />
              <Tab {...drawerTabProps("drawer.tab.containers")} label="Containers" />
            </Tabs>
            <div>{title} {tab === 0 ? "overview" : "containers"}</div>
          </>
        </ResourceDrawerShell>
      );
    }

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            data-testid="grid-cell"
            onClick={() => setOpen(true)}
            onKeyDown={(event) => event.stopPropagation()}
          >
            Open selected row
          </button>
          <RightDrawer open={false} onClose={vi.fn()}>
            <PodContents title="Hidden pod" />
          </RightDrawer>
          <RightDrawer open={open} onClose={vi.fn()}>
            <PodContents title="Visible pod" />
          </RightDrawer>
        </>
      );
    }

    render(<KeyboardHarness><Harness /></KeyboardHarness>);

    const gridCell = screen.getByTestId("grid-cell");
    gridCell.focus();
    expect(document.activeElement).toBe(gridCell);
    fireEvent.click(gridCell);
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Visible pod"));
    fireEvent.keyDown(document.activeElement!, { key: "c" });
    await waitFor(() => expect(screen.getByText("Visible pod containers")).toBeTruthy());
    fireEvent.keyDown(document.activeElement!, { key: "o" });
    await waitFor(() => expect(screen.getByText("Visible pod overview")).toBeTruthy());
  });
});
