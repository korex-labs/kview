// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResourceListPage, {
  loadPersistedColumnWidths,
  resourceMemoryTargetForListRow,
  resourceListRowMatchesSearchFields,
  savePersistedColumnWidths,
  shouldCleanupResourceTagAssignments,
} from "./ResourceListPage";
import type { DataplaneListMeta } from "../../types/api";

vi.mock("../../activeContext", () => ({ useActiveContext: () => "kind-causal" }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../keyboard/KeyboardProvider", () => ({
  useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: vi.fn() }),
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
  default: ({ rows }: { rows: Array<{ id: string }> }) => ({
    filter: "",
    setFilter: vi.fn(),
    selectedQuickFilter: null,
    toggleQuickFilter: vi.fn(),
    quickFilters: [],
    filteredRows: rows,
  }),
}));
vi.mock("../../utils/useListQuery", () => ({
  default: () => ({
    items: [],
    dataplaneMeta: { state: "ok", freshness: "hot", coverage: "full", completeness: "complete" },
    error: null,
    loading: false,
    lastRefresh: 0,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@mui/x-data-grid", () => ({
  DataGrid: () => <div data-testid="resource-grid" />,
  gridPaginatedVisibleSortedGridRowIdsSelector: () => [],
  gridVisibleColumnDefinitionsSelector: () => [],
  useGridApiRef: () => ({ current: { rootElementRef: { current: null }, getAllRowIds: () => [] } }),
}));
vi.mock("./ResourceTableToolbar", () => ({ default: () => null }));
vi.mock("./DataplaneListMetaStrip", () => ({
  default: ({ token, activeContext }: { token: string; activeContext: string }) => (
    <output data-testid="dataplane-meta-boundary">{token}|{activeContext}</output>
  ),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
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
  it("renders the shared meta strip with the actual token and active context", () => {
    render(
      <ResourceListPage
        token="actual-token"
        columns={[{ field: "name", headerName: "Name" }]}
        fetchRows={async () => ({ rows: [], meta: null })}
        resourceKey="pods"
        renderDrawer={() => null}
      />,
    );

    expect(screen.getByTestId("dataplane-meta-boundary").textContent).toBe("actual-token|kind-causal");
  });
});
