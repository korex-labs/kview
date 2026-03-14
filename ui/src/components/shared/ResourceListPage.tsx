import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import useListQuery from "../../utils/useListQuery";
import useEmptyListAccessCheck from "../../utils/useEmptyListAccessCheck";
import useListFilters from "../../utils/useListFilters";
import type { AccessReviewResource } from "../../utils/k8sResources";
import ListStateOverlay from "./ListStateOverlay";
import ResourceTableToolbar, { type ResourceTableToolbarProps } from "./ResourceTableToolbar";

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
  fetchRows: () => Promise<TRow[]>;
  enabled?: boolean;
  filterPredicate: (row: TRow, query: string) => boolean;
  filterLabel: string;
  resourceLabel: string;
  accessResource: AccessReviewResource;
  namespace?: string | null;
  defaultSortField?: string;
  /** Initial refresh interval in seconds (default 10). */
  initialRefreshSec?: number;
  renderDrawer: (props: ResourceListPageDrawerProps<TRow>) => React.ReactNode;
  /** Optional extra content in the footer row (e.g. Helm Install button). Receives refetch for post-action refresh. */
  renderFooterExtra?: (refetch: () => Promise<void>) => React.ReactNode;
  /** Optional row height for DataGrid (e.g. () => "auto" for multi-line cells). */
  getRowHeight?: () => "auto" | number;
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
  accessResource,
  namespace = null,
  defaultSortField = "name",
  initialRefreshSec = 10,
  renderDrawer,
  renderFooterExtra,
  getRowHeight,
}: ResourceListPageProps<TRow>) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedId = useMemo<string | null>(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Id of the row shown in the drawer (set when opening via Open or double-click). */
  const [drawerSelectedId, setDrawerSelectedId] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(initialRefreshSec);

  const fetchRowsStable = useCallback(() => fetchRows(), [fetchRows]);

  const { items: rows, error, loading, lastRefresh, refetch } = useListQuery<TRow>({
    enabled,
    refreshSec,
    fetchItems: fetchRowsStable,
    onInitialResult: () => setSelectionModel([]),
  });

  const accessDenied = useEmptyListAccessCheck({
    token,
    itemsLength: rows.length,
    error,
    loading,
    resource: accessResource,
    namespace,
  });

  const { filter, setFilter, selectedQuickFilter, toggleQuickFilter, quickFilters, filteredRows } =
    useListFilters<TRow>({
      rows,
      lastRefresh,
      filterPredicate,
    });

  const openSelected = useCallback(() => {
    if (!selectedId) return;
    setDrawerSelectedId(selectedId);
    setDrawerOpen(true);
  }, [selectedId]);

  const handleRowDoubleClick = useCallback((row: TRow) => {
    setSelectionModel([row.id]);
    setDrawerSelectedId(row.id);
    setDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerSelectedId(null);
  }, []);

  const emptyMessage = `No ${resourceLabel} found.`;

  const sortModel = useMemo(
    () => [{ field: defaultSortField, sort: "asc" as const }],
    [defaultSortField],
  );

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>

      <div style={{ height: "100%", width: "100%", minHeight: 0 }}>
        <DataGrid<TRow>
          rows={filteredRows}
          columns={columns}
          density="compact"
          loading={loading}
          disableMultipleRowSelection
          hideFooterSelectedRowCount
          rowSelectionModel={selectionModel}
          onRowSelectionModelChange={(m) => setSelectionModel(m)}
          onRowDoubleClick={(params) => handleRowDoubleClick(params.row)}
          initialState={{
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
              onFilterChange: setFilter,
              selectedQuickFilter,
              onQuickFilterToggle: toggleQuickFilter,
              onOpenSelected: openSelected,
              hasSelection: !!selectedId,
              refreshSec,
              onRefreshChange: setRefreshSec,
              quickFilters,
            } as ResourceTableToolbarProps,
            noRowsOverlay: {
              error,
              accessDenied,
              emptyMessage,
              resourceLabel,
            } as Record<string, unknown>,
          }}
        />
      </div>

      <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1 }}>
        {renderFooterExtra?.(refetch)}
        <Box sx={{ flexGrow: renderFooterExtra ? 1 : 0 }} />
        <Typography variant="caption" color="text.secondary">
          Last refresh: {lastRefresh ? lastRefresh.toLocaleString() : "-"}
        </Typography>
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
