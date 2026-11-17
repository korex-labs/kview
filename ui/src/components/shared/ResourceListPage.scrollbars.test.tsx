// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import ResourceListPage from "./ResourceListPage";
import { readFileSync } from "node:fs";
const themeCss = readFileSync("src/styles/theme.css", "utf8");

vi.mock("../../activeContext", () => ({ useActiveContext: () => "synthetic-scroll" }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../keyboard/KeyboardProvider", () => ({
  useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: (request: { focus: () => boolean }) => request.focus() }),
  useTableKeyboardControls: vi.fn(),
}));
vi.mock("../../settingsContext", async () => {
  const { defaultUserSettings } = await import("../../settings");
  const settings = defaultUserSettings();
  settings.resourceTags.enabled = false;
  return { useUserSettings: () => ({ settings, setSettings: vi.fn() }) };
});
vi.mock("../../utils/useEmptyListAccessCheck", () => ({ default: () => null }));
// MUI detects jsdom at module load and disables virtualization. Supply a browser
// UA plus geometry, without mocking DataGrid, virtualizer, refs or scrollbars.
const originalUserAgent = vi.hoisted(() => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36" });
  return descriptor;
});
afterAll(() => {
  if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
  else Reflect.deleteProperty(navigator, "userAgent");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("opts real axis scrollbar owners in without replacing the virtual scroller, selection or refresh state", async () => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
  }));
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `pod-${i}`, name: `pod-${i}` }));
  const fetchRows = vi.fn().mockResolvedValue({ rows });
  const columns = [{ field: "name", headerName: "Name", width: 800 }];
  const page = (externalRevision?: string) => <><style>{themeCss}</style><ResourceListPage
    token="token" resourceKey="pods" columns={columns} fetchRows={fetchRows}
    suspendPolling externalRevision={externalRevision} filterLabel="Filter pods"
    renderDrawer={() => null}
  /></>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(page()); });
  const root = view.container.querySelector(".MuiDataGrid-root")!;
  const scroller = root.querySelector(".MuiDataGrid-virtualScroller")!;
  const bars = Array.from(root.querySelectorAll(".MuiDataGrid-scrollbar"));
  expect(bars).toHaveLength(2);
  expect(root.classList.contains("kview-native-scrollbar")).toBe(false);
  expect(scroller.classList.contains("kview-native-scrollbar")).toBe(false);
  expect(root.querySelector(".MuiDataGrid-scrollbar--vertical")).toBeTruthy();
  expect(root.querySelector(".MuiDataGrid-scrollbar--horizontal")).toBeTruthy();
  for (const bar of bars) {
    expect(bar.classList.contains("kview-native-scrollbar")).toBe(true);
    expect(getComputedStyle(bar).scrollbarWidth).toBe("auto");
    // jsdom cannot compute the two-color scrollbar grammar; CSSOM is covered separately.
    expect(bar.getAttribute("tabindex")).toBe("-1");
  }
  expect(root.querySelectorAll(".MuiDataGrid-row").length).toBeLessThan(rows.length);
  const cell = screen.getByText("pod-0");
  fireEvent.click(cell);
  expect(cell.closest('[role="row"]')?.getAttribute("aria-selected")).toBe("true");
  scroller.scrollTop = 80;
  scroller.scrollLeft = 40;
  fireEvent.scroll(scroller);
  await act(async () => { view.rerender(page("2")); });
  expect(fetchRows).toHaveBeenCalledTimes(2);
  expect(root.querySelector(".MuiDataGrid-virtualScroller")).toBe(scroller);
  expect(Array.from(root.querySelectorAll(".MuiDataGrid-scrollbar"))).toEqual(bars);
  expect(scroller.scrollTop).toBe(80);
  expect(scroller.scrollLeft).toBe(40);
  // The selected row can be virtualized out: return to it before checking state.
  await act(async () => {
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
  });
  expect(root.querySelector('[data-id="pod-0"]')?.getAttribute("aria-selected")).toBe("true");
});
