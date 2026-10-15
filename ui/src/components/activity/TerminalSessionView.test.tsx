// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TerminalSessionView from "./TerminalSessionView";

const terminal = vi.hoisted(() => ({ created: vi.fn(), disposed: vi.fn(), focused: vi.fn(), fit: vi.fn() }));
const requestFocus = vi.hoisted(() => vi.fn());
vi.mock("../../keyboard/KeyboardProvider", () => ({ useKeyboardControls: () => ({ requestKeyboardFocus: requestFocus }) }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80;
  rows = 24;
  constructor() { terminal.created(); }
  loadAddon() {}
  open(node: HTMLElement) { const input = document.createElement("textarea"); input.className = "xterm-helper-textarea"; node.appendChild(input); }
  focus() { terminal.focused(); }
  onData() { return { dispose: vi.fn() }; }
  onResize() { return { dispose: vi.fn() }; }
  dispose() { terminal.disposed(); }
  write() {}
  writeln() {}
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() { terminal.fit(); } } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not reconnect or steal focus while hidden, including delayed mount focus", () => {
  const connected = vi.fn();
  const closed = vi.fn();
  vi.stubGlobal("WebSocket", class {
    static OPEN = 1;
    readyState = 1;
    constructor() { connected(); }
    close() { closed(); }
    send() {}
  });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const view = render(<TerminalSessionView id="session" token="token" active={false} />);
  act(() => { frames.forEach((callback) => callback(0)); });
  expect(requestFocus).not.toHaveBeenCalled();
  view.rerender(<TerminalSessionView id="session" token="token" active focusNonce={1} />);
  expect(requestFocus).toHaveBeenCalledTimes(1);
  const focus = requestFocus.mock.calls[0][0].focus as () => boolean;
  act(() => { expect(focus()).toBe(true); });
  expect(terminal.focused).toHaveBeenCalledTimes(1);
  view.rerender(<TerminalSessionView id="session" token="token" active={false} />);
  expect(focus()).toBe(false);
  expect(terminal.focused).toHaveBeenCalledTimes(1);
  view.rerender(<TerminalSessionView id="session" token="token" active focusNonce={2} />);
  expect(requestFocus).toHaveBeenCalledTimes(2);
  expect(connected).toHaveBeenCalledTimes(1);
  expect(terminal.created).toHaveBeenCalledTimes(1);
  expect(terminal.disposed).not.toHaveBeenCalled();
  view.unmount();
  expect(terminal.disposed).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
});
