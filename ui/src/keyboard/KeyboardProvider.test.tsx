// @vitest-environment jsdom

import React, { useEffect, useMemo } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardProvider, {
  useContextualKeyboardActions,
  useKeyboardControls,
  useKeyboardScope,
  type KeyboardFocusScope,
} from "./KeyboardProvider";
import type { Section } from "../state";

const keyboardSettings = {
  vimTableNavigation: true,
  homeRowTableNavigation: true,
  singleLetterGlobalSearch: true,
};

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

function ContextActionRegistrar({ onRun }: { onRun: () => void }) {
  const actions = useMemo(() => [
    {
      id: "test.context",
      label: "Test context action",
      binding: ["x"],
      run: () => {
        onRun();
        return true;
      },
    },
  ], [onRun]);
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
