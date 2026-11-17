// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiGet } from "../../api";
import { UserSettingsProvider } from "../../settingsContext";
import ActivityPanel from "./ActivityPanel";
import { overflowOnlyTabsProps, reservedSlotsTabsProps } from "../../theme/tabTokens";

vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiGet: vi.fn() }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy", backendHealth: "healthy", clusterHealth: "healthy" }) }));
vi.mock("../../utils/usePageVisible", () => ({ default: () => true }));
vi.mock("../../investigationSnapshots", () => ({ listInvestigationSnapshots: () => Promise.resolve([]) }));
vi.mock("./DeferredTerminalSessionView", () => ({ default: ({ id, active, focusNonce }: { id: string; active: boolean; focusNonce: number }) =>
  <textarea aria-label={`Terminal ${id}`} data-active={active} data-focus-nonce={focusNonce} /> }));

afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it("uses explicit mobile overflow policies while preserving compact Activity navigation", async () => {
  expect(overflowOnlyTabsProps).toEqual({ variant: "scrollable", scrollButtons: "auto", allowScrollButtonsMobile: true });
  expect(reservedSlotsTabsProps).toEqual({ variant: "scrollable", scrollButtons: true, allowScrollButtonsMobile: true });
  vi.mocked(apiGet).mockResolvedValue({ items: [] });
  await act(async () => { render(<UserSettingsProvider><ActivityPanel token="fixture" initialOpen={false} /></UserSettingsProvider>); });
  const list = screen.getByRole("tablist", { name: "Activity sections" });
  const tabs = within(list).getAllByRole("tab");
  const strip = list.closest(".MuiTabs-root")!;
  expect(getComputedStyle(strip).minWidth).toBe("0px");
  expect(getComputedStyle(strip).flexShrink).toBe("1");
  expect(strip.querySelector(".MuiTabs-scrollableX")).not.toBeNull();
  expect(getComputedStyle(tabs[0]).minHeight).toBe("28px");
  act(() => tabs[0].focus());
  fireEvent.keyDown(tabs[0], { key: "End" });
  expect(document.activeElement).toBe(tabs[4]);
  fireEvent.click(tabs[4]);
  expect(tabs[4].getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: "Collapse activity panel" })).toBeTruthy();
  expect(screen.getByRole("tablist", { name: "Activity sections" })).toBe(list);
  await act(async () => {});
});

it.each(["Enter", " "])("activates session tabs with %j without activating a close button's parent", async (key) => {
  vi.mocked(apiGet).mockImplementation(async (path) => ({ items: path === "/api/sessions" ? [
    { id: "one", type: "terminal", title: "Shell one", status: "running" },
    { id: "two", type: "terminal", title: "Shell two", status: "running" },
  ] : [] }) as never);
  await act(async () => { render(<UserSettingsProvider><ActivityPanel token="fixture" /></UserSettingsProvider>); });
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /^Terminals/ })); });
  const list = screen.getByRole("tablist", { name: "Terminal sessions" });
  const [first, second] = within(list).getAllByRole("tab");
  const one = screen.getByLabelText("Terminal one");
  const two = screen.getByLabelText("Terminal two");
  expect(second.tagName).toBe("DIV");
  act(() => first.focus());
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(second);
  expect(first.getAttribute("aria-selected")).toBe("true");
  const beforeActivation = Number(two.getAttribute("data-focus-nonce"));
  fireEvent.keyDown(second, { key });
  // MUI's non-native ButtonBase activates Enter on keydown and Space on keyup.
  expect(second.getAttribute("aria-selected")).toBe(key === "Enter" ? "true" : "false");
  fireEvent.keyUp(second, { key });
  expect(second.getAttribute("aria-selected")).toBe("true");
  expect(two.getAttribute("data-active")).toBe("true");
  expect(one.getAttribute("data-active")).toBe("false");
  expect(Number(two.getAttribute("data-focus-nonce"))).toBe(beforeActivation + 1);

  const close = within(first).getByRole("button", { name: "Close terminal" });
  expect(close.tagName).toBe("BUTTON");
  const closeRequest = vi.fn();
  window.addEventListener("kview-terminal-close-request", closeRequest);
  try {
    act(() => close.focus());
    const focusNonce = two.getAttribute("data-focus-nonce");
    fireEvent.keyDown(close, { key });
    expect(first.getAttribute("aria-selected")).toBe("false");
    fireEvent.keyUp(close, { key });
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("data-focus-nonce")).toBe(focusNonce);
    // jsdom does not synthesize native button clicks from keyboard events.
    // Deliver that browser click separately; the bubbling keys above must not
    // trigger the parent div's non-native keyboard activation.
    expect(closeRequest).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(closeRequest).toHaveBeenCalledTimes(1);
    expect((closeRequest.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "one" });
    expect(document.activeElement).toBe(close);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("data-focus-nonce")).toBe(focusNonce);
    expect(screen.getByLabelText("Terminal one")).toBe(one);
    expect(screen.getByLabelText("Terminal two")).toBe(two);
    await act(async () => {});
  } finally {
    window.removeEventListener("kview-terminal-close-request", closeRequest);
  }
});

it("keeps session nodes mounted and close events separate from tab selection", async () => {
  vi.mocked(apiGet).mockImplementation(async (path) => ({ items: path === "/api/sessions" ? [
    { id: "one", type: "terminal", title: "Shell one", status: "running" },
    { id: "two", type: "terminal", title: "Shell two", status: "running" },
  ] : [] }) as never);
  await act(async () => { render(<UserSettingsProvider><ActivityPanel token="fixture" /></UserSettingsProvider>); });
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /^Terminals/ })); });
  const list = screen.getByRole("tablist", { name: "Terminal sessions" });
  const tabs = within(list).getAllByRole("tab");
  const one = screen.getByLabelText("Terminal one");
  const two = screen.getByLabelText("Terminal two");
  expect(getComputedStyle(tabs[0]).minHeight).toBe("30px");
  expect(tabs[0].tagName).toBe("DIV"); // No button nested inside a button.
  fireEvent.click(tabs[1]);
  expect(two.getAttribute("data-active")).toBe("true");
  const focusNonce = two.getAttribute("data-focus-nonce");
  const close = within(tabs[0]).getByRole("button", { name: "Close terminal" });
  const closeRequest = vi.fn();
  window.addEventListener("kview-terminal-close-request", closeRequest);
  try {
    act(() => close.focus());
    fireEvent.click(close);
    expect(closeRequest).toHaveBeenCalledTimes(1);
    expect((closeRequest.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "one" });
    expect(document.activeElement).toBe(close);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("data-focus-nonce")).toBe(focusNonce);
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    expect(screen.getByLabelText("Terminal one")).toBe(one);
    expect(screen.getByLabelText("Terminal two")).toBe(two);
    fireEvent.click(screen.getByRole("tab", { name: /^Terminals/ }));
    expect(screen.getByRole("tablist", { name: "Terminal sessions" })).toBe(list);
    expect(two.getAttribute("data-active")).toBe("true");
    await act(async () => {});
  } finally {
    window.removeEventListener("kview-terminal-close-request", closeRequest);
  }
});
