// @vitest-environment jsdom

import React, { useEffect, useMemo } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardProvider, {
  ContextualKeyboardSurface,
  useContextualKeyboardActions,
  useKeyboardControls,
  useKeyboardScope,
  useTableKeyboardControls,
  type KeyboardFocusScope,
} from "./KeyboardProvider";
import type { Section } from "../state";
import { defaultKeyboardSettings } from "../settings";

const keyboardSettings = defaultKeyboardSettings();

function renderKeyboard(children?: React.ReactNode) {
  const handlers = {
    focusSearch: vi.fn(),
    selectSection: vi.fn<(section: Section) => void>(),
    openSettings: vi.fn(),
  };
  render(
    <KeyboardProvider
      settingsOpen={false}
      keyboardSettings={keyboardSettings}
      onFocusGlobalSearch={handlers.focusSearch}
      onSelectSection={handlers.selectSection}
      onOpenSettings={handlers.openSettings}
    >
      {children}
    </KeyboardProvider>,
  );
  return handlers;
}

function ScopeRegistrar({ scope }: { scope: KeyboardFocusScope }) {
  useKeyboardScope(scope);
  return null;
}

const defaultContextBinding = ["x"];
const drawerScope: KeyboardFocusScope = {
  id: "drawer",
  label: "Drawer",
  kind: "drawer",
  suppressGlobalShortcuts: true,
};

function ContextActionRegistrar({
  onRun,
  id = "test.context",
  binding = defaultContextBinding,
  bindings,
  priority,
}: {
  onRun: () => void;
  id?: string;
  binding?: string[];
  bindings?: string[][];
  priority?: number;
}) {
  const actions = useMemo(() => [
    {
      id,
      label: "Test context action",
      binding,
      bindings,
      priority,
      run: () => {
        onRun();
        return true;
      },
    },
  ], [binding, bindings, id, onRun, priority]);
  useContextualKeyboardActions(actions);
  return null;
}

function FocusRequester({ ready }: { ready: boolean }) {
  const { requestKeyboardFocus } = useKeyboardControls();
  useEffect(() => {
    requestKeyboardFocus({
      id: "test.focus",
      focus: () => {
        const el = document.querySelector<HTMLInputElement>("[data-focus-target='true']");
        el?.focus();
        return document.activeElement === el;
      },
    });
  }, [requestKeyboardFocus, ready]);
  return ready ? <input data-focus-target="true" aria-label="Managed focus" /> : null;
}

function TableControlsRegistrar({ onOpen }: { onOpen: () => void }) {
  const controls = useMemo(() => ({
    focusFilter: () => false,
    focusGrid: () => false,
    pagePrevious: () => false,
    pageNext: () => false,
    openSelectedRow: () => { onOpen(); return true; },
  }), [onOpen]);
  useTableKeyboardControls(controls);
  return null;
}

afterEach(() => {
  cleanup();
});

describe("KeyboardProvider", () => {
  it("runs global shortcuts from the app surface", () => {
    const handlers = renderKeyboard();

    fireEvent.keyDown(window, { key: "s" });
    expect(handlers.focusSearch).toHaveBeenCalledWith("");

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });
    expect(handlers.selectSection).toHaveBeenCalledWith("pods");
  });

  it("does not let dormant drawer actions intercept global navigation sequences", () => {
    const hiddenDrawerAction = vi.fn();
    const handlers = renderKeyboard(
      <ContextualKeyboardSurface active={false}>
        <ContextActionRegistrar id="drawer.tab.role-bindings" onRun={hiddenDrawerAction} />
      </ContextualKeyboardSurface>,
    );

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });
    expect(handlers.selectSection).toHaveBeenCalledWith("pods");
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "0" });
    expect(handlers.selectSection).toHaveBeenCalledWith("dashboard");
    expect(hiddenDrawerAction).not.toHaveBeenCalled();
  });

  it("dispatches compiled overrides and disables replaced defaults", () => {
    const handlers = {
      focusSearch: vi.fn(),
      selectSection: vi.fn<(section: Section) => void>(),
      openSettings: vi.fn(),
    };
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{
          ...defaultKeyboardSettings(),
          overrides: { "search.focus": [["g", ";"]] },
        }}
        onFocusGlobalSearch={handlers.focusSearch}
        onSelectSection={handlers.selectSection}
        onOpenSettings={handlers.openSettings}
      >
        {null}
      </KeyboardProvider>,
    );

    fireEvent.keyDown(window, { key: "s" });
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: ";" });

    expect(handlers.focusSearch).toHaveBeenCalledTimes(1);
  });

  it("opens Help only through the compiled remapped binding", () => {
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{
          ...defaultKeyboardSettings(),
          overrides: { "help.open": [["g", "?"]] },
        }}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        {null}
      </KeyboardProvider>,
    );

    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
  });

  it("opens a selected row only through its effective binding", () => {
    const onOpen = vi.fn();
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{ ...defaultKeyboardSettings(), overrides: { "table.row.open": [["x"]] } }}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <TableControlsRegistrar onOpen={onOpen} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "x" });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("suppresses global shortcuts from editable and overlay targets", () => {
    const handlers = renderKeyboard(
      <>
        <input aria-label="name" />
        <div role="dialog">
          <button type="button">Dialog action</button>
        </div>
      </>,
    );

    fireEvent.keyDown(document.querySelector("input")!, { key: "s" });
    fireEvent.keyDown(document.querySelector("button")!, { key: "s" });

    expect(handlers.focusSearch).not.toHaveBeenCalled();
  });

  it("runs contextual actions in drawer scopes while suppressing global shortcuts", () => {
    const onRun = vi.fn();
    const handlers = renderKeyboard(
      <>
        <ScopeRegistrar scope={{
          id: "drawer",
          label: "Drawer",
          kind: "drawer",
          suppressGlobalShortcuts: true,
        }}
        />
        <ContextActionRegistrar onRun={onRun} />
      </>,
    );

    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "s" });

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(handlers.focusSearch).not.toHaveBeenCalled();
  });

  it("uses effective built-in drawer bindings and disables the old default", () => {
    const onRun = vi.fn();
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{ ...defaultKeyboardSettings(), overrides: { "drawer.tab.overview": [["ctrl+g", "v"]] } }}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <ScopeRegistrar scope={drawerScope} />
        <ContextActionRegistrar id="drawer.tab.overview" onRun={onRun} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(window, { key: "o" });
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v" });
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("does not run disabled built-in drawer edit or refresh actions", () => {
    const edit = vi.fn();
    const refresh = vi.fn();
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{ ...defaultKeyboardSettings(), overrides: { "drawer.editYaml": [], "drawer.refresh": [] } }}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <ScopeRegistrar scope={drawerScope} />
        <ContextActionRegistrar id="drawer.editYaml" onRun={edit} />
        <ContextActionRegistrar id="drawer.refresh" onRun={refresh} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "r" });
    expect(edit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("dispatches contextual multi-chord bindings and clears partial state after timeout", () => {
    vi.useFakeTimers();
    const onRun = vi.fn();
    renderKeyboard(<>
      <ScopeRegistrar scope={drawerScope} />
      <ContextActionRegistrar onRun={onRun} bindings={[["g", "v"], ["x", "y", "z"]]} />
    </>);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "v" });
    expect(onRun).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "x" });
    vi.advanceTimersByTime(901);
    fireEvent.keyDown(window, { key: "y" });
    fireEvent.keyDown(window, { key: "z" });
    expect(onRun).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("keeps a specialized contextual owner ahead of later generic registrations", () => {
    const specialized = vi.fn();
    const generic = vi.fn();
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={defaultKeyboardSettings()}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <ScopeRegistrar scope={drawerScope} />
        <ContextActionRegistrar id="drawer.tab.logs" priority={100} onRun={specialized} />
        <ContextActionRegistrar id="drawer.tab.logs" onRun={generic} />
      </KeyboardProvider>,
    );

    fireEvent.keyDown(window, { key: "l" });
    expect(specialized).toHaveBeenCalledTimes(1);
    expect(generic).not.toHaveBeenCalled();
  });

  it("shows effective drawer overrides in Help", () => {
    render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={{ ...defaultKeyboardSettings(), overrides: { "drawer.refresh": [["g", "r"]] } }}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <ScopeRegistrar scope={drawerScope} />
        <ContextActionRegistrar id="drawer.refresh" onRun={vi.fn()} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Current Resource")).toBeTruthy();
    expect(within(screen.getByText("Test context action").closest("li")!).getByText("g then r")).toBeTruthy();
  });

  it("routes Escape to the active scope unless a nested overlay owns it", () => {
    const onEscape = vi.fn();
    renderKeyboard(
      <>
        <ScopeRegistrar scope={{
          id: "settings",
          label: "Settings",
          kind: "settings",
          suppressGlobalShortcuts: true,
          suppressContextShortcuts: true,
          onEscape,
        }}
        />
        <div className="MuiDialog-root">
          <button type="button">Nested dialog</button>
        </div>
      </>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(document.querySelector("button")!, { key: "Escape" });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("retries managed focus requests until the target exists", async () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={keyboardSettings}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <FocusRequester ready={false} />
      </KeyboardProvider>,
    );

    rerender(
      <KeyboardProvider
        settingsOpen={false}
        keyboardSettings={keyboardSettings}
        onFocusGlobalSearch={vi.fn()}
        onSelectSection={vi.fn()}
        onOpenSettings={vi.fn()}
      >
        <FocusRequester ready />
      </KeyboardProvider>,
    );
    vi.runOnlyPendingTimers();

    expect(document.activeElement).toBe(document.querySelector("[data-focus-target='true']"));
    vi.useRealTimers();
  });
});
