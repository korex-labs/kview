// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiGet } from "../../api";
import { UserSettingsProvider } from "../../settingsContext";
import ActivityPanel from "./ActivityPanel";

vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiGet: vi.fn() }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy", backendHealth: "healthy", clusterHealth: "healthy" }) }));
vi.mock("../../utils/usePageVisible", () => ({ default: () => true }));
vi.mock("../../investigationSnapshots", () => ({ listInvestigationSnapshots: () => Promise.resolve([]) }));
// Keep the production panel/session ancestry; xterm rendering/transport is not
// under test. The existing CSSOM test verifies the descendant reset declaration.
vi.mock("./DeferredTerminalSessionView", () => ({ default: () => <div className="xterm"><div className="xterm-viewport" data-testid="terminal-viewport" /></div> }));

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.resetAllMocks(); });

const log = (id: number) => ({ id: `log-${id}`, timestamp: "2026-01-01T00:00:00Z", level: "info", source: "fixture-runtime", message: `Runtime line ${id}` });

it("opts in the four bottom-panel scroll owners, not clipped parents, tab strips or terminal descendants", async () => {
  vi.useFakeTimers();
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path === "/api/activity") return { items: [{ id: "activity-one", title: "Fixture activity", kind: "runtime", type: "runtime", status: "running" }] } as never;
    if (path === "/api/sessions") return { items: [
      { id: "terminal-one", type: "terminal", title: "Fixture shell", status: "running" },
      { id: "forward-one", type: "portforward", title: "Fixture forward", status: "running" },
    ] } as never;
    if (path === "/api/activity/runtime/logs") return { items: [log(1)] } as never;
    return { running: [], queued: [], health: [], namespaceSweep: [] } as never;
  });
  await act(async () => { render(<UserSettingsProvider><div className="kview-native-scrollbar" data-testid="outer-owner"><ActivityPanel token="fixture" /></div></UserSettingsProvider>); });
  const sections = screen.getByRole("tablist", { name: "Activity sections" });
  const activityOwner = screen.getByText("Fixture activity").closest("table")!.parentElement!;
  const checkOwner = (owner: HTMLElement) => {
    expect(owner.classList.contains("kview-native-scrollbar")).toBe(true);
    expect(getComputedStyle(owner).overflow).toBe("auto");
    expect(getComputedStyle(owner).minHeight).toBe("0px");
    expect(owner.parentElement!.classList.contains("kview-native-scrollbar")).toBe(false);
    expect(getComputedStyle(owner.parentElement!).overflow).toBe("hidden");
  };
  checkOwner(activityOwner);
  activityOwner.scrollTop = 37;
  activityOwner.scrollLeft = 19;
  await act(async () => { fireEvent.click(within(sections).getByRole("tab", { name: /^Work/ })); });
  const workOwner = screen.getByRole("table").parentElement!;
  checkOwner(workOwner);
  await act(async () => { fireEvent.click(within(sections).getByRole("tab", { name: /^Port forwards/ })); });
  const forwardOwner = screen.getByText("forward-one").closest("table")!.parentElement!;
  checkOwner(forwardOwner);
  await act(async () => { fireEvent.click(within(sections).getByRole("tab", { name: "Logs" })); });
  const logsOwner = screen.getByText("Runtime line 1").closest("table")!.parentElement!;
  checkOwner(logsOwner);
  expect(logsOwner.classList.contains("MuiTableContainer-root")).toBe(true);
  expect(getComputedStyle(logsOwner).paddingBottom).toBe("52px");
  expect(screen.getByRole("columnheader", { name: "Message" }).classList.contains("MuiTableCell-stickyHeader")).toBe(true);
  const outer = screen.getByTestId("outer-owner");
  expect(Array.from(outer.querySelectorAll(".kview-native-scrollbar"))).toEqual([activityOwner, workOwner, forwardOwner, logsOwner]);
  for (const strip of outer.querySelectorAll(".MuiTabs-scroller")) {
    expect(strip.classList.contains("kview-native-scrollbar")).toBe(false);
  }
  const terminal = screen.getByTestId("terminal-viewport");
  expect(terminal.closest(".kview-native-scrollbar")).toBe(outer);
  expect(terminal.matches(".kview-native-scrollbar :not(.kview-native-scrollbar)")).toBe(true);
  await act(async () => { fireEvent.click(within(sections).getByRole("tab", { name: /^Activities/ })); });
  expect(screen.getByText("Fixture activity").closest("table")!.parentElement).toBe(activityOwner);
  expect(activityOwner.scrollTop).toBe(37);
  expect(activityOwner.scrollLeft).toBe(19);
});

it.each([true, false])("preserves runtime log append scrolling (at bottom: %s), then resumes following at bottom", async (atBottom) => {
  vi.useFakeTimers();
  let requests = 0;
  vi.mocked(apiGet).mockImplementation(async (path) => ({ items: path === "/api/activity/runtime/logs" ? [log(++requests)] : [] }) as never);
  await act(async () => { render(<UserSettingsProvider><ActivityPanel token="fixture" /></UserSettingsProvider>); });
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Logs" })); });
  const firstLine = screen.getByText("Runtime line 1");
  const owner = firstLine.closest(".MuiTableContainer-root")!;
  expect(owner.classList.contains("kview-native-scrollbar")).toBe(true);
  // Deterministic layout with browser-like clamping; each appended DOM row
  // increases scrollHeight before the production follow-tail effect runs.
  let top = 0;
  Object.defineProperties(owner, {
    clientHeight: { configurable: true, get: () => 200 },
    scrollHeight: { configurable: true, get: () => 500 + owner.querySelectorAll("tbody tr").length * 100 },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, owner.scrollHeight - owner.clientHeight)); } },
  });
  owner.scrollTop = atBottom ? owner.scrollHeight - owner.clientHeight : 75;
  fireEvent.scroll(owner);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(requests).toBe(2);
  expect(screen.getByText("Runtime line 2").closest(".MuiTableContainer-root")).toBe(owner);
  expect(screen.getByText("Runtime line 1")).toBe(firstLine);
  expect(owner.scrollTop).toBe(atBottom ? owner.scrollHeight - owner.clientHeight : 75);
  owner.scrollTop = owner.scrollHeight - owner.clientHeight;
  fireEvent.scroll(owner);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(requests).toBe(3);
  expect(screen.getByText("Runtime line 3").closest(".MuiTableContainer-root")).toBe(owner);
  expect(owner.scrollTop).toBe(owner.scrollHeight - owner.clientHeight);
});
