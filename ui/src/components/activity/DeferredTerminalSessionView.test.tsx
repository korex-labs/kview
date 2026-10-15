// @vitest-environment jsdom
import React, { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DeferredTerminalSessionView from "./DeferredTerminalSessionView";

const lifecycle = vi.hoisted(() => ({ loaded: vi.fn(), mounted: vi.fn(), closed: vi.fn() }));
vi.mock("./TerminalSessionView", () => {
  lifecycle.loaded();
  return { default: function Terminal({ active }: { active?: boolean }) {
    const [output, setOutput] = useState(0);
    useEffect(() => { lifecycle.mounted(); return lifecycle.closed; }, []);
    return <button data-active={String(active)} onClick={() => setOutput((value) => value + 1)}>output:{output}</button>;
  } };
});
afterEach(cleanup);

it("loads only for an opened session and preserves its instance across hidden/active transitions", async () => {
  const view = render(<div />);
  expect(lifecycle.loaded).not.toHaveBeenCalled();
  view.rerender(<DeferredTerminalSessionView id="session-1" token="token" active />);
  const terminal = await screen.findByRole("button", { name: "output:0" });
  fireEvent.click(terminal);
  view.rerender(<DeferredTerminalSessionView id="session-1" token="token" active={false} />);
  expect(screen.getByRole("button", { name: "output:1" }).getAttribute("data-active")).toBe("false");
  view.rerender(<DeferredTerminalSessionView id="session-1" token="token" active focusNonce={2} />);
  expect(screen.getByRole("button", { name: "output:1" }).getAttribute("data-active")).toBe("true");
  expect(lifecycle.loaded).toHaveBeenCalledTimes(1);
  expect(lifecycle.mounted).toHaveBeenCalledTimes(1);
  expect(lifecycle.closed).not.toHaveBeenCalled();
  view.unmount();
  expect(lifecycle.closed).toHaveBeenCalledTimes(1);
});
