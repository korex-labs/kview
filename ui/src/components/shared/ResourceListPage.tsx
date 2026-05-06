import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paper, Typography, Box } from "@mui/material";
import {
  DataGrid,
  GridColDef,
  GridColumnVisibilityModel,
  GridRowSelectionModel,
  useGridApiRef,
} from "@mui/x-data-grid";
import useListQuery from "../../utils/useListQuery";
import { defaultRevisionPollSec } from "../../utils/dataplaneRevisionPoll";
import useEmptyListAccessCheck from "../../utils/useEmptyListAccessCheck";
import useListFilters from "../../utils/useListFilters";
import { getResourceIcon, type AccessReviewResource } from "../../utils/k8sResources";
import type { ListResourceKey } from "../../utils/k8sResources";
import type { ResourceListFetchResult } from "../../types/api";
import ListStateOverlay from "./ListStateOverlay";
import ResourceTableToolbar, { type ResourceTableToolbarProps } from "./ResourceTableToolbar";
import DataplaneListMetaStrip from "./DataplaneListMetaStrip";
import { useActiveContext } from "../../activeContext";
import { useConnectionState } from "../../connectionState";
import { useKeyboardControls } from "../../keyboard/KeyboardProvider";
import ResourceIcon from "../icons/resources/ResourceIcon";
import { recordListSnapshot } from "../../utils/performanceDiagnostics";

const defaultDataplaneRefreshSec = 0;

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

const tableNavigationKeys: Record<string, { rowDelta: number; colDelta: number }> = {
  h: { rowDelta: 0, colDelta: -1 },
  j: { rowDelta: 1, colDelta: 0 },
  k: { rowDelta: -1, colDelta: 0 },
  l: { rowDelta: 0, colDelta: 1 },
  a: { rowDelta: 0, colDelta: -1 },
  s: { rowDelta: 1, colDelta: 0 },
  d: { rowDelta: -1, colDelta: 0 },
  f: { rowDelta: 0, colDelta: 1 },
};
const vimTableNavigationKeys = new Set(["h", "j", "k", "l"]);
const homeRowTableNavigationKeys = new Set(["a", "s", "d", "f"]);

export type ResourceListPageDrawerProps<TRow extends { id: string } = { id: string }> = {
  selectedId: string | null;
  /** The row object when a row is selected (for drawers that need the full row, e.g. HelmChart). */
  selectedRow: TRow | null;
  open: boolean;
  onClose: () => void;
  refetch: () => Promise<void>;
};

export type ResourceListPageProps<TRow extends { id: string }> = {
  token: string;
  title: React.ReactNode;
  columns: GridColDef<TRow>[];
  /** Return rows plus optional dataplane list metadata for the shared meta strip. */
  fetchRows: (contextName?: string) => Promise<ResourceListFetchResult<TRow>>;
  /** Optional line above list quality strip (e.g. namespace row status). */
  dataplaneMetaPrefix?: React.ReactNode;
  /** Optional merge of fetched rows (e.g. progressive namespace enrichment). */
  mapRows?: (rows: TRow[]) => TRow[];
  mapRowsDeps?: unknown[];
  enabled?: boolean;
  filterPredicate: (row: TRow, query: string) => boolean;
  filterLabel: string;
  resourceLabel: string;
  resourceKey: ListResourceKey;
  accessResource: AccessReviewResource;
  namespace?: string | null;
  defaultSortField?: string;
  initialColumnVisibilityModel?: GridColumnVisibilityModel;
  /**
   * Initial toolbar refresh interval in seconds. Default 0 (Off): lists rely on dataplane-backed
   * snapshots and one-shot load; periodic polling can hit proxy/API limits. Users can enable
   * 3s–60s from the toolbar when needed.
   */
  initialRefreshSec?: number;
  renderDrawer: (props: ResourceListPageDrawerProps<TRow>) => React.ReactNode;
  /** Optional extra content in the footer row (e.g. Helm Install button). Receives refetch for post-action refresh. */
  renderFooterExtra?: (refetch: () => Promise<void>) => React.ReactNode;
  /** Optional row height for DataGrid (e.g. () => "auto" for multi-line cells). */
  getRowHeight?: () => "auto" | number;
  /** Disable the secondary SAR overlay for routes that intentionally serve sparse derived fallbacks. */
  skipEmptyAccessCheck?: boolean;
  /**
   * Dataplane-backed lists: poll GET /api/dataplane/revision cheaply; full fetchRows only when revision changes.
   * Ignored when the user selects a full list refresh interval (`refreshSec > 0`) in the toolbar.
   */
  dataplaneRevisionPoll?: {
    fetchRevision: (contextName?: string) => Promise<string>;
    pollSec?: number;
  };
  /** Full dataplane-backed refetch cadence while toolbar refresh remains Off. Default 0: revision changes drive refetches. */
  dataplaneRefreshSec?: number;
};

/**
 * Reusable resource list page: DataGrid with toolbar, no-rows overlay, footer, and drawer slot.
 * Resource-specific: columns, fetchRows, filterPredicate, filterLabel, and drawer are passed in.
 */
export default function ResourceListPage<TRow extends { id: string }>({
  token,
  title,
  columns,
  fetchRows,
  enabled = true,
  filterPredicate,
  filterLabel,
  resourceLabel,
  resourceKey,
  accessResource,
  namespace = null,
  defaultSortField = "name",
  initialColumnVisibilityModel,
  initialRefreshSec,
  dataplaneMetaPrefix,
  mapRows,
  mapRowsDeps,
  renderDrawer,
  renderFooterExtra,
  getRowHeight,
  skipEmptyAccessCheck = false,
  dataplaneRevisionPoll,
  dataplaneRefreshSec,
}: ResourceListPageProps<TRow>) {
  const orderedColumns = useMemo(() => {
    if (!columns.some((col) => col.field === "listSignalSeverity")) return columns;
    const fieldPriority = (field: string): number => {
      const f = field.toLowerCase();
      if (f === "isfavourite") return 0;
      if (f === "name") return 1;
      if (f === "listsignalseverity") return 2;
      if (f === "liststatus" || f === "status" || f === "phase" || f === "health") return 3;
      if (f.includes("age")) return 6;
      if (f.includes("time") || f.includes("last") || f.includes("seen") || f.includes("updated")) return 5;
      return 4;
    };
    return [...columns].sort((a, b) => {
      const pa = fieldPriority(String(a.field));
      const pb = fieldPriority(String(b.field));
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }, [columns]);

  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedId = useMemo<string | null>(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Id of the row shown in the drawer (set when opening via Open or double-click). */
  const [drawerSelectedId, setDrawerSelectedId] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const keepFilterFocusRef = useRef(false);
  const apiRef = useGridApiRef();
  const [refreshSec, setRefreshSec] = useState<number>(initialRefreshSec ?? 0);
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const { registerTableControls, keyboardSettings } = useKeyboardControls();
  const offline = health === "unhealthy";
  const diagnosticsLabel = `${resourceKey}${namespace ? `/${namespace}` : ""}`;

  useEffect(() => {
    setRefreshSec(initialRefreshSec ?? 0);
  }, [initialRefreshSec]);

  const fetchRowsStable = useCallback(() => fetchRows(activeContext), [activeContext, fetchRows]);
  const fetchRevisionStable = useCallback(
    () => dataplaneRevisionPoll?.fetchRevision(activeContext) ?? Promise.resolve("0"),
    [activeContext, dataplaneRevisionPoll],
  );

  const { items: rows, dataplaneMeta, error, loading, lastRefresh, refetch } = useListQuery<TRow>({
    enabled,
    queryKey: [activeContext, namespace ?? "", resourceLabel, fetchRows],
    refreshSec,
    fetchItems: fetchRowsStable,
    onInitialResult: () => setSelectionModel([]),
    mapRows,
    mapRowsDeps,
    fetchRevision: dataplaneRevisionPoll ? fetchRevisionStable : undefined,
    revisionPollSec: dataplaneRevisionPoll ? (dataplaneRevisionPoll.pollSec ?? defaultRevisionPollSec) : 0,
    dataplaneRefreshSec: dataplaneRevisionPoll
      ? (dataplaneRefreshSec ?? defaultDataplaneRefreshSec)
      : 0,
    diagnosticsLabel,
  });

  const accessDenied = useEmptyListAccessCheck({
    token,
    itemsLength: rows.length,
    error,
    loading: loading || skipEmptyAccessCheck,
    resource: accessResource,
    namespace,
    contextName: activeContext,
  });

  const smartFilterContext = useMemo(
    () => ({
      contextName: activeContext,
      namespace,
      resourceKey,
    }),
    [activeContext, namespace, resourceKey],
  );

  const { filter, setFilter, selectedQuickFilter, toggleQuickFilter, quickFilters, filteredRows } =
    useListFilters<TRow>({
      rows,
      lastRefresh,
      filterPredicate,
      smartFilterContext,
      diagnosticsLabel,
    });

  useEffect(() => {
    recordListSnapshot({
      label: diagnosticsLabel,
      rows: rows.length,
      filteredRows: filteredRows.length,
      quickFilters: quickFilters.length,
    });
  }, [diagnosticsLabel, filteredRows.length, quickFilters.length, rows.length]);

  const handleRowDoubleClick = useCallback((row: TRow) => {
    setSelectionModel([row.id]);
    setDrawerSelectedId(row.id);
    setDrawerOpen(true);
  }, []);

  const handleOpenRowId = useCallback((rowId: string) => {
    if (!rowId) return false;
    keepFilterFocusRef.current = false;
    setSelectionModel([rowId]);
    setDrawerSelectedId(rowId);
    setDrawerOpen(true);
    return true;
  }, []);

  const focusGridCell = useCallback((rowId: string, field: string) => {
    if (!rowId || !field) return false;
    setSelectionModel([rowId]);
    apiRef.current.setCellFocus(rowId, field);
    const focusCell = () => {
      const root = apiRef.current?.rootElementRef?.current;
      const row = Array.from(root?.querySelectorAll<HTMLElement>('[role="row"][data-id]') || [])
        .find((el) => el.getAttribute("data-id") === rowId);
      const cell = row?.querySelector<HTMLElement>(`[role="gridcell"][data-field="${escapeAttributeValue(field)}"]`);
      cell?.focus();
    };
    window.requestAnimationFrame(focusCell);
    window.setTimeout(focusCell, 0);
    window.setTimeout(focusCell, 50);
    return true;
  }, [apiRef]);

  const handleOpenSelectedRow = useCallback(() => {
    const focusedId = apiRef.current?.state?.focus?.cell?.id;
    const targetId = focusedId != null ? String(focusedId) : (selectedId || "");
    return handleOpenRowId(targetId);
  }, [apiRef, handleOpenRowId, selectedId]);

  const handleFocusGrid = useCallback((preferredId?: string | null) => {
    keepFilterFocusRef.current = false;
    const field = orderedColumns[0]?.field;
    if (!field) return false;
    const rowIds = apiRef.current?.getAllRowIds?.() || [];
    const focusedId = apiRef.current?.state?.focus?.cell?.id;
    const targetId = preferredId || (focusedId != null ? String(focusedId) : "") || selectedId || String(rowIds[0] ?? filteredRows[0]?.id ?? "");
    return focusGridCell(targetId, field);
  }, [apiRef, filteredRows, focusGridCell, orderedColumns, selectedId]);

  const handleMoveGridFocus = useCallback((key: string, rowId: string, field: string) => {
    const normalizedKey = key.toLowerCase();
    if (vimTableNavigationKeys.has(normalizedKey) && !keyboardSettings.vimTableNavigation) return false;
    if (homeRowTableNavigationKeys.has(normalizedKey) && !keyboardSettings.homeRowTableNavigation) return false;
    const move = tableNavigationKeys[normalizedKey];
    if (!move) return false;
    const rowIds = apiRef.current?.getAllRowIds?.().map(String) || filteredRows.map((row) => row.id);
    const fields = orderedColumns.map((col) => String(col.field));
    const rowIndex = rowIds.indexOf(rowId);
    const colIndex = fields.indexOf(field);
    if (rowIndex < 0 || colIndex < 0) return false;
    const nextRowIndex = Math.max(0, Math.min(rowIds.length - 1, rowIndex + move.rowDelta));
    const nextColIndex = Math.max(0, Math.min(fields.length - 1, colIndex + move.colDelta));
    return focusGridCell(rowIds[nextRowIndex], fields[nextColIndex]);
  }, [apiRef, filteredRows, focusGridCell, keyboardSettings.homeRowTableNavigation, keyboardSettings.vimTableNavigation, orderedColumns]);

  const handleCloseDrawer = useCallback(() => {
    const returnId = drawerSelectedId;
    setDrawerOpen(false);
    setDrawerSelectedId(null);
    window.setTimeout(() => {
      handleFocusGrid(returnId);
    }, 0);
  }, [drawerSelectedId, handleFocusGrid]);

  const handlePageBy = useCallback((delta: number) => {
    const pagination = apiRef.current?.state?.pagination;
    if (!pagination?.enabled) return false;
    const page = pagination.paginationModel.page;
    const pageSize = pagination.paginationModel.pageSize;
    const rowCount = pagination.rowCount >= 0 ? pagination.rowCount : filteredRows.length;
    const pageCount = Math.max(1, Math.ceil(rowCount / Math.max(1, pageSize)));
    const nextPage = Math.max(0, Math.min(pageCount - 1, page + delta));
    if (nextPage === page) return false;
    apiRef.current.setPage(nextPage);
    window.setTimeout(() => {
      const rowIds = apiRef.current?.getAllRowIds?.() || [];
      const targetId = String(rowIds[nextPage * pageSize] ?? rowIds[0] ?? "");
      handleFocusGrid(targetId);
    }, 0);
    return true;
  }, [apiRef, filteredRows.length, handleFocusGrid]);

  useEffect(() => {
    if (!keepFilterFocusRef.current) return;
    if (!filterInputRef.current) return;
    if (document.activeElement === filterInputRef.current) return;
    filterInputRef.current.focus();
  }, [filter, filteredRows]);

  useEffect(() => {
    return registerTableControls({
      focusFilter: () => {
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return !!filterInputRef.current;
      },
      focusGrid: handleFocusGrid,
      pagePrevious: () => handlePageBy(-1),
      pageNext: () => handlePageBy(1),
      openSelectedRow: handleOpenSelectedRow,
    });
  }, [handleFocusGrid, handleOpenSelectedRow, handlePageBy, registerTableControls]);

  const emptyMessage = `No ${resourceLabel} found.`;
  const filteredEmptyMessage = `No ${resourceLabel} match the current filter. Clear or change the filter to see ${rows.length === 1 ? "the existing item" : `the ${rows.length} existing items`}.`;

  const sortModel = useMemo(
    () => [{ field: defaultSortField, sort: "asc" as const }],
    [defaultSortField],
  );
  const initialColumns = useMemo(
    () => initialColumnVisibilityModel ? { columnVisibilityModel: initialColumnVisibilityModel } : undefined,
    [initialColumnVisibilityModel],
  );

  return (
    <Paper sx={{ p: 2 }} data-testid={`resource-list-${resourceKey}`}>
      <Typography variant="h6" sx={{ mb: 0.5, flexShrink: 0, display: "flex", alignItems: "center", gap: 1 }}>
        <ResourceIcon name={getResourceIcon(resourceKey)} size={21} sx={{ color: "primary.main" }} />
        {title}
      </Typography>
      <Box sx={{ flexShrink: 0 }}>
        <DataplaneListMetaStrip meta={dataplaneMeta} prefix={dataplaneMetaPrefix} />
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DataGrid<TRow>
          rows={filteredRows}
          columns={orderedColumns}
          apiRef={apiRef}
          density="compact"
          loading={loading}
          sx={{ flex: 1, minHeight: 0, width: "100%" }}
          disableMultipleRowSelection
          hideFooterSelectedRowCount
          rowSelectionModel={selectionModel}
          onRowSelectionModelChange={(m) => setSelectionModel(m)}
          onCellKeyDown={(params, event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              handleOpenRowId(String(params.id));
              return;
            }
            if (!handleMoveGridFocus(event.key, String(params.id), String(params.field))) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onRowDoubleClick={(params) => handleRowDoubleClick(params.row)}
          initialState={{
            columns: initialColumns,
            sorting: { sortModel },
          }}
          {...(getRowHeight ? { getRowHeight } : {})}
          slots={{
            // DataGrid slot types don't match our toolbar/overlay props; we pass props via slotProps
            toolbar: ResourceTableToolbar as React.ComponentType<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
            noRowsOverlay: ListStateOverlay as React.ComponentType<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
          }}
          slotProps={{
            toolbar: {
              filterLabel,
              filter,
              onFilterChange: (value: string) => {
                keepFilterFocusRef.current = true;
                setFilter(value);
              },
              filterInputRef,
              onFilterFocus: () => {
                keepFilterFocusRef.current = true;
              },
              onFilterKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleFocusGrid();
              },
              selectedQuickFilter,
              onQuickFilterToggle: toggleQuickFilter,
              refreshSec,
              onRefreshChange: setRefreshSec,
              quickFilters,
              disabled: offline,
              showRefresh: !dataplaneRevisionPoll,
            } as ResourceTableToolbarProps,
            noRowsOverlay: {
              error,
              accessDenied,
              emptyMessage,
              filteredEmptyMessage,
              rowCount: rows.length,
              filter,
              resourceLabel,
            } as Record<string, unknown>,
          }}
        />
      </Box>

      <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1, flexShrink: 0 }}>
        {renderFooterExtra?.(refetch)}
        <Box sx={{ flexGrow: renderFooterExtra ? 1 : 0 }} />
        {!dataplaneRevisionPoll ? (
          <Typography variant="caption" color="text.secondary">
            Last refresh: {lastRefresh ? lastRefresh.toLocaleString() : "-"}
          </Typography>
        ) : null}
      </Box>

      {renderDrawer({
        selectedId: drawerOpen ? drawerSelectedId : null,
        selectedRow: drawerOpen && drawerSelectedId
          ? (filteredRows.find((r) => r.id === drawerSelectedId) ?? null)
          : null,
        open: drawerOpen,
        onClose: handleCloseDrawer,
        refetch,
      })}
    </Paper>
  );
}
