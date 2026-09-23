// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceListPage from "./ResourceListPage";
import type { ResourceListFetchResult } from "../../types/api";

const connection = vi.hoisted(() => ({ health: "healthy" }));
vi.mock("../../activeContext", () => ({ useActiveContext: () => "kind-refresh" }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => connection }));
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

afterEach(() => {
  cleanup();
  connection.health = "healthy";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

type Row = { id: string; name: string; uid?: string };
const snapshot: ResourceListFetchResult<Row> = {
  rows: [{ id: "pod-a", name: "pod-a" }, { id: "pod-b", name: "pod-b" }],
  dataplaneMeta: { state: "ok", freshness: "hot", coverage: "full", completeness: "complete" },
};
const columns = [{ field: "name", headerName: "Name", width: 200 }];
const revision = { fetchRevision: async () => "1", pollSec: 3600 };

// Production DataGrid, toolbar, metadata strip and useListQuery are all mounted.
describe("ResourceListPage production Refresh", () => {
  it("preserves terminal input focus across Live updates after filtering and double-clicking", async () => {
    const fetchRows = vi.fn().mockImplementation(async () => ({ rows: snapshot.rows.map((row) => ({ ...row })) }));
    const page = (externalRevision?: string) => <ResourceListPage<Row>
      token="token" resourceKey="pods" columns={columns} fetchRows={fetchRows}
      suspendPolling externalRevision={externalRevision} filterLabel="Filter pods"
      renderDrawer={({ open }) => open ? <textarea aria-label="Terminal input" /> : null}
    />;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(page()); });
    const filter = screen.getByRole("textbox", { name: "Filter pods" }) as HTMLInputElement;
    act(() => filter.focus());
    fireEvent.change(filter, { target: { value: "pod-a" } });
    await waitFor(() => expect(screen.queryByText("pod-b")).toBeNull());
    fireEvent.doubleClick(screen.getByText("pod-a"));
    const terminal = screen.getByRole("textbox", { name: "Terminal input" });
    act(() => terminal.focus());
    await act(async () => { view.rerender(page("2")); });
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(terminal);
    await act(async () => { view.rerender(page("3")); });
    expect(fetchRows).toHaveBeenCalledTimes(3);
    expect(document.activeElement).toBe(terminal);
    expect(filter.value).toBe("pod-a");
  });

  it("hides Refresh only when explicitly requested and preserves the inline control without metadata", async () => {
    const fetchRows = vi.fn().mockResolvedValue({ rows: [] });
    const page = (hideRefresh?: boolean) => <ResourceListPage<Row>
      token="token" resourceKey="services" columns={columns} fetchRows={fetchRows}
      dataplaneRevisionPoll={revision} hideRefresh={hideRefresh}
      dataplaneMetaControl={<button>Live control</button>} renderDrawer={() => null}
    />;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(page()); });
    const control = screen.getByRole("button", { name: "Live control" });
    expect(screen.getByRole("button", { name: "Refresh" }).parentElement).toBe(control.parentElement);
    view.rerender(page(true));
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.getByRole("button", { name: "Live control" })).toBe(control);
    view.rerender(page(false));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchRows).toHaveBeenLastCalledWith("kind-refresh", "manual", expect.any(AbortSignal)));
  });

  it("applies Live revisions in place and clears same-name replacement selection/drawer", async () => {
    const fetchRows = vi.fn().mockResolvedValue({ rows: [{ id: "app/pod-a", name: "pod-a", uid: "one" }], dataplaneMeta: { revision: "1" } });
    const getRowInstance = (row: Row) => row.uid;
    const page = (externalRevision?: string) => <ResourceListPage<Row>
      token="token" resourceKey="pods" columns={columns} fetchRows={fetchRows}
      suspendPolling externalRevision={externalRevision} getRowInstance={getRowInstance}
      filterLabel="Filter pods" dataplaneRevisionPoll={revision}
      renderDrawer={({ open, selectedId }) => open ? <div data-testid="drawer">{selectedId}</div> : null}
    />;
    let view!: ReturnType<typeof render>;
    // Flush the immediately resolved initial fetch and grid commit before DOM
    // queries; a busy jsdom render can outlast findBy's default retry budget.
    await act(async () => { view = render(page()); });
    expect(screen.getByRole("textbox", { name: "Filter pods" }).getAttribute("value")).toBe("");
    fireEvent.doubleClick(screen.getByText("pod-a"));
    expect(screen.getByTestId("drawer").textContent).toBe("app/pod-a");
    const grid = screen.getByRole("grid");
    const scroller = view.container.querySelector(".MuiDataGrid-virtualScroller")!;
    scroller.scrollTop = 80;
    const filter = screen.getByRole("textbox", { name: "Filter pods" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "pod-a" } });
    fetchRows.mockResolvedValue({ rows: [{ id: "app/pod-a", name: "pod-a", uid: "one" }], dataplaneMeta: { revision: "2" } });
    view.rerender(page("2"));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    expect(fetchRows).toHaveBeenLastCalledWith("kind-refresh", "revision", expect.any(AbortSignal));
    expect(screen.getByRole("grid")).toBe(grid);
    expect(filter.value).toBe("pod-a");
    expect(scroller.scrollTop).toBe(80);
    expect(screen.getByTestId("drawer")).toBeTruthy();
    fetchRows.mockResolvedValue({ rows: [{ id: "app/pod-a", name: "pod-a", uid: "two" }], dataplaneMeta: { revision: "3" } });
    view.rerender(page("3"));
    await waitFor(() => expect(screen.queryByTestId("drawer")).toBeNull());
    expect(screen.getByText("pod-a").closest('[role="row"]')?.getAttribute("aria-selected")).toBe("false");
    expect(filter.value).toBe("pod-a");
  });

  it("closes a deleted Pod drawer before a same-name new UID reappears", async () => {
    const fetchRows = vi.fn().mockResolvedValue({ rows: [{ id: "app/pod-a", name: "pod-a", uid: "one" }], dataplaneMeta: { revision: "1" } });
    const getRowInstance = (row: Row) => row.uid;
    const page = (externalRevision?: string) => <ResourceListPage<Row>
      token="token" resourceKey="pods" columns={columns} fetchRows={fetchRows}
      suspendPolling externalRevision={externalRevision} getRowInstance={getRowInstance}
      filterLabel="Filter pods" dataplaneRevisionPoll={revision}
      renderDrawer={({ open, selectedId }) => open ? <div data-testid="drawer">{selectedId}</div> : null}
    />;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(page()); });
    fireEvent.doubleClick(screen.getByText("pod-a"));
    expect(screen.getByTestId("drawer").textContent).toBe("app/pod-a");
    fetchRows.mockResolvedValue({ rows: [], dataplaneMeta: { revision: "2" } });
    await act(async () => { view.rerender(page("2")); });
    expect(screen.queryByText("pod-a")).toBeNull();
    expect(screen.queryByTestId("drawer")).toBeNull();
    fetchRows.mockResolvedValue({ rows: [{ id: "app/pod-a", name: "pod-a", uid: "two" }], dataplaneMeta: { revision: "3" } });
    await act(async () => { view.rerender(page("3")); });
    expect(screen.getByText("pod-a").closest('[role="row"]')?.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByTestId("drawer")).toBeNull();
    expect(fetchRows.mock.calls.map(([, reason]) => reason)).toEqual(["initial", "revision", "revision"]);
  });

  it("refreshes manually without reload or losing rows, selection, filter, scroll or drawer", async () => {
    let finish!: (result: ResourceListFetchResult<Row>) => void;
    const pending = new Promise<ResourceListFetchResult<Row>>((resolve) => { finish = resolve; });
    const fetchRows = vi.fn().mockResolvedValueOnce(snapshot).mockReturnValueOnce(pending);
    const consoleError = vi.spyOn(console, "error");
    const pageHide = vi.fn();
    window.addEventListener("beforeunload", pageHide);
    const href = window.location.href;
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ResourceListPage<Row>
          token="token" resourceKey="pods" columns={columns} fetchRows={fetchRows}
          dataplaneRevisionPoll={revision} filterLabel="Filter pods"
          renderDrawer={({ open, selectedId }) => open ? <div data-testid="drawer">{selectedId}</div> : null}
        />,
      );
    });
    const { container } = view;
    expect(screen.getByRole("textbox", { name: "Filter pods" }).getAttribute("value")).toBe("");
    expect(screen.getByText("pod-a")).toBeTruthy();
    expect(screen.getByText("pod-b")).toBeTruthy();
    const refresh = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    const explain = screen.getByRole("button", { name: "Explain" });
    expect(explain.parentElement).toBe(refresh.parentElement);
    expect(getComputedStyle(refresh).height).toBe("24px");
    expect(screen.queryByText("Off")).toBeNull();
    const filter = screen.getByRole("textbox", { name: "Filter pods" }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "pod-a" } });
    await waitFor(() => expect(screen.queryByText("pod-b")).toBeNull());
    const cell = screen.getByText("pod-a");
    fireEvent.doubleClick(cell);
    const row = cell.closest('[role="row"]')!;
    await waitFor(() => expect(row.getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByTestId("drawer").textContent).toBe("pod-a");
    const grid = screen.getByRole("grid");
    const scroller = container.querySelector(".MuiDataGrid-virtualScroller")!;
    scroller.scrollTop = 80;
    await act(async () => { fireEvent.click(refresh); });
    expect(fetchRows.mock.calls).toEqual([["kind-refresh", "initial", expect.any(AbortSignal)], ["kind-refresh", "manual", expect.any(AbortSignal)]]);
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(getComputedStyle(refresh).height).toBe("24px");
    fireEvent.click(refresh);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("grid")).toBe(grid);
    expect(container.querySelector(".MuiDataGrid-loadingOverlay")).toBeNull();
    expect(filter.value).toBe("pod-a");
    expect(scroller.scrollTop).toBe(80);
    expect(screen.getByTestId("drawer").textContent).toBe("pod-a");
    await act(async () => { finish({ ...snapshot, rows: [...snapshot.rows] }); });
    await waitFor(() => expect(refresh.disabled).toBe(false));
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(filter.value).toBe("pod-a");
    expect(scroller.scrollTop).toBe(80);
    expect(screen.getByTestId("drawer").textContent).toBe("pod-a");
    expect(screen.getByRole("grid")).toBe(grid);
    expect(window.location.href).toBe(href);
    expect(pageHide).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    window.removeEventListener("beforeunload", pageHide);
  });

  it.each(["offline", "unavailable"])("disables %s refresh even without metadata", async (state) => {
    if (state === "offline") connection.health = "unhealthy";
    const fetchRows = vi.fn().mockResolvedValue({ rows: [] });
    render(
      <ResourceListPage<Row>
        token="token" resourceKey="services" columns={columns} fetchRows={fetchRows}
        enabled={state !== "unavailable"} dataplaneRevisionPoll={revision} renderDrawer={() => null}
      />,
    );
    const refresh = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
    await act(async () => {});
    expect(refresh.disabled).toBe(true);
    fireEvent.click(refresh);
    expect(fetchRows.mock.calls.every(([, reason]) => reason === "initial")).toBe(true);
  });
});
