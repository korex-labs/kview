// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceListPage, {
  loadPersistedColumnWidths,
  resourceMemoryTargetForListRow,
  resourceListRowMatchesSearchFields,
  savePersistedColumnWidths,
  shouldCleanupResourceTagAssignments,
} from "./ResourceListPage";
import type { DataplaneListMeta } from "../../types/api";
import { apiGetWithContext } from "../../api";

vi.mock("../../api", () => ({ apiGetWithContext: vi.fn().mockResolvedValue({ item: { observers: [] } }) }));

vi.mock("../../activeContext", () => ({ useActiveContext: () => "kind-causal" }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../keyboard/KeyboardProvider", () => ({
  useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: (request: { focus: () => boolean }) => request.focus() }),
  useTableKeyboardControls: vi.fn(),
}));
vi.mock("../../settingsContext", () => ({
  useUserSettings: () => ({
    settings: {
      resourceTags: { enabled: false, definitions: [], assignments: {} },
      savedViews: [],
    },
    setSettings: vi.fn(),
  }),
}));
vi.mock("../../utils/useEmptyListAccessCheck", () => ({ default: () => null }));
vi.mock("../../utils/useListFilters", () => ({
  default: function useListFiltersFixture({ rows }: { rows: Array<{ id: string; name?: string }> }) {
    const [filter, setFilter] = React.useState("");
    return { filter, setFilter, selectedQuickFilter: null, toggleQuickFilter: vi.fn(), quickFilters: [],
      filteredRows: React.useMemo(() => rows.filter((row) => !filter || row.name?.includes(filter)), [rows, filter]) };
  },
}));
vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({ rows, slotProps, onRowDoubleClick }: {
    rows: Array<{ id: string; name: string }>;
    slotProps: { toolbar: { filterInputRef: React.Ref<HTMLInputElement>; onFilterFocus: () => void; onFilterChange: (value: string) => void } };
    onRowDoubleClick: (params: { row: { id: string; name: string } }) => void;
  }) => <div data-testid="resource-grid">
    <input aria-label="Filter fixture" ref={slotProps.toolbar.filterInputRef} onFocus={slotProps.toolbar.onFilterFocus} onChange={(e) => slotProps.toolbar.onFilterChange(e.target.value)} />
    {rows.map((row) => <button key={row.id} onDoubleClick={() => onRowDoubleClick({ row })}>{row.name}</button>)}
  </div>,
  gridPaginatedVisibleSortedGridRowIdsSelector: () => [],
  gridVisibleColumnDefinitionsSelector: () => [],
  useGridApiRef: () => ({ current: { rootElementRef: { current: null }, getAllRowIds: () => [] } }),
}));
vi.mock("./ResourceTableToolbar", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ResourceListPage focus ownership", () => {
  it("does not reclaim terminal focus after filtering, double-clicking a row and refreshing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const fetchRows = vi.fn().mockImplementation(async () => ({ rows: [{ id: "pod", name: "api" }, { id: "other", name: "worker" }] }));
    render(<ResourceListPage token="test" columns={[{ field: "name" }]} fetchRows={fetchRows} resourceKey="pods" initialRefreshSec={5}
      renderDrawer={({ open }) => open ? <textarea aria-label="Terminal fixture" /> : null} />);
    await screen.findByRole("button", { name: "api" });
    const filter = screen.getByRole("textbox", { name: "Filter fixture" });
    act(() => filter.focus());
    fireEvent.change(filter, { target: { value: "api" } });
    expect(screen.queryByRole("button", { name: "worker" })).toBeNull();
    fireEvent.doubleClick(screen.getByRole("button", { name: "api" }));
    const terminal = screen.getByRole("textbox", { name: "Terminal fixture" });
    act(() => terminal.focus());
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(terminal);
  });
});

describe("ResourceListPage refresh reason boundary", () => {
  it.each(["interval", "dataplane", "revision"] as const)(
    "forwards manual Refresh and keeps %s polling automatic",
    async (lane) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      const fetchRows = vi.fn().mockResolvedValue({ rows: [{ id: "pod", name: "pod" }] });
      const fetchRevision = vi.fn().mockResolvedValue("1");
      render(
        <ResourceListPage
          token="actual-token"
          columns={[{ field: "name", headerName: "Name" }]}
          fetchRows={fetchRows}
          resourceKey="pods"
          namespace="app"
          initialRefreshSec={lane === "interval" ? 5 : 0}
          dataplaneRevisionPoll={lane === "interval" ? undefined : { fetchRevision, pollSec: 5 }}
          dataplaneRefreshSec={lane === "dataplane" ? 15 : 0}
          renderDrawer={() => null}
        />,
      );
      await waitFor(() => expect(fetchRows).toHaveBeenCalledExactlyOnceWith("kind-causal", "initial", expect.any(AbortSignal)));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh" })); });
      expect(fetchRows.mock.calls).toEqual([["kind-causal", "initial", expect.any(AbortSignal)], ["kind-causal", "manual", expect.any(AbortSignal)]]);

      if (lane === "revision") fetchRevision.mockResolvedValue("2");
      await act(async () => { await vi.advanceTimersByTimeAsync(lane === "dataplane" ? 15_100 : 5_100); });
      expect(fetchRows.mock.calls).toEqual([
        ["kind-causal", "initial", expect.any(AbortSignal)],
        ["kind-causal", "manual", expect.any(AbortSignal)],
        ["kind-causal", lane === "interval" ? "refresh" : lane, expect.any(AbortSignal)],
      ]);
    },
  );
});

const completeHotMeta: DataplaneListMeta = {
  state: "ok",
  freshness: "hot",
  coverage: "full",
  completeness: "complete",
};

describe("ResourceListPage resource tag cleanup", () => {
  it("does not cleanup namespace tag assignments from namespace list rows", () => {
    expect(shouldCleanupResourceTagAssignments("namespaces", completeHotMeta)).toBe(false);
  });

  it("requires an authoritative hot complete list before cleanup", () => {
    expect(shouldCleanupResourceTagAssignments("pods", completeHotMeta)).toBe(true);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, freshness: "cold" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, coverage: "partial" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, completeness: "unknown" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", null)).toBe(false);
  });
});

describe("ResourceListPage persisted column widths", () => {
  it("loads only finite reasonable numeric widths", () => {
    const key = "kview:test:column-widths";
    window.localStorage.setItem(key, JSON.stringify({
      name: 240,
      tiny: 10,
      huge: 5000,
      bad: "120",
      ageSec: 129.6,
    }));

    expect(loadPersistedColumnWidths(key)).toEqual({ name: 240, ageSec: 130 });
  });

  it("saves cleaned widths and removes empty width state", () => {
    const key = "kview:test:column-widths-empty";

    savePersistedColumnWidths(key, { name: 250, bad: Number.NaN, tiny: 20 });
    expect(JSON.parse(window.localStorage.getItem(key) || "{}")).toEqual({ name: 250 });

    savePersistedColumnWidths(key, { bad: Number.NaN });
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

describe("ResourceListPage descriptor search fields", () => {
  it("matches scalar, array, and projected array-object fields", () => {
    const row = {
      name: "quota-main",
      status: "ok",
      clusterIPs: ["10.0.0.10", "10.0.0.11"],
      entries: [
        { key: "requests.cpu", used: "200m" },
        { key: "limits.memory", used: "1Gi" },
      ],
    };

    expect(resourceListRowMatchesSearchFields(row, ["name"], "quota")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["clusterIPs"], "10.0.0.11")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["entries.key"], "limits.memory")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["entries.used"], "500m")).toBe(false);
  });
});

describe("ResourceListPage resource notes target", () => {
  it("keys list rows the same way as resource drawer notes", () => {
    expect(resourceMemoryTargetForListRow({
      id: "pod-id",
      name: "api-7f",
      namespace: "app-prod",
    }, "kind-dev", "pods")).toEqual({
      context: "kind-dev",
      resource: "pods",
      namespace: "app-prod",
      name: "api-7f",
    });
  });

  it("falls back to chartName or id for non-standard resource rows", () => {
    expect(resourceMemoryTargetForListRow({ id: "release-a", chartName: "chart-a" }, "kind-dev", "helm", "ops")).toEqual({
      context: "kind-dev",
      resource: "helm",
      namespace: "ops",
      name: "chart-a",
    });
  });
});

describe("ResourceListPage dataplane explanation boundary", () => {
  it("renders the shared meta strip with the actual token and active context", async () => {
    render(
      <ResourceListPage
        token="actual-token"
        columns={[{ field: "name", headerName: "Name" }]}
        fetchRows={async () => ({ rows: [], dataplaneMeta: completeHotMeta })}
        resourceKey="pods"
        renderDrawer={() => null}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Explain" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledWith(
      "/api/dataplane/explanation", "actual-token", "kind-causal", { signal: expect.any(AbortSignal) },
    ));
  });
});
