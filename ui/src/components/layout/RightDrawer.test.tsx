// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RightDrawer from "./RightDrawer";
import KeyboardProvider from "../../keyboard/KeyboardProvider";
import ResourceDrawerShell from "../shared/ResourceDrawerShell";
import { UserSettingsProvider } from "../../settingsContext";

function KeyboardHarness({ children }: { children: React.ReactNode }) {
  return (
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
});
