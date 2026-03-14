import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import { fmtAge, valueOrDash } from "../utils/format";
import CustomResourceDefinitionDrawer from "./CustomResourceDefinitionDrawer";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type CRDItem = {
  name: string;
  group?: string;
  scope?: string;
  kind?: string;
  versions?: string;
  established?: boolean;
  ageSec: number;
};

type Row = CRDItem & { id: string };

const resourceLabel = getResourceLabel("customresourcedefinitions");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 300 },
  { field: "group", headerName: "Group", width: 220, renderCell: (p) => valueOrDash(String(p.value || "")) },
  { field: "scope", headerName: "Scope", width: 130, renderCell: (p) => valueOrDash(String(p.value || "")) },
  { field: "kind", headerName: "Kind", width: 180, renderCell: (p) => valueOrDash(String(p.value || "")) },
  { field: "versions", headerName: "Versions", width: 280, renderCell: (p) => valueOrDash(String(p.value || "")) },
  {
    field: "established",
    headerName: "Established",
    width: 120,
    renderCell: (p) => (
      <Chip
        size="small"
        label={p.value ? "Yes" : "No"}
        color={p.value ? "success" : "warning"}
      />
    ),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number((p.row as any)?.ageSec), "table"),
  },
];

export default function CustomResourceDefinitionsTable({ token }: { token: string }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedName = useMemo(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(10);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>("/api/customresourcedefinitions", token);
    const items: CRDItem[] = res.items || [];
    return items.map((c) => ({ ...c, id: c.name }));
  }, [token]);

  const { items: rows, error, loading, lastRefresh } = useListQuery<Row>({
    refreshSec,
    fetchItems: fetchRows,
    onInitialResult: () => setSelectionModel([]),
  });

  const accessDenied = useEmptyListAccessCheck({
    token,
    itemsLength: rows.length,
    error,
    loading,
    resource: listResourceAccess.customresourcedefinitions,
    namespace: null,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.group || "").toLowerCase().includes(q) ||
      (row.kind || "").toLowerCase().includes(q) ||
      (row.scope || "").toLowerCase().includes(q),
    [],
  );

  const { filter, setFilter, selectedQuickFilter, toggleQuickFilter, quickFilters, filteredRows } =
    useListFilters<Row>({
      rows,
      lastRefresh,
      filterPredicate,
    });

  function openSelected() {
    if (!selectedName) return;
    setDrawerName(selectedName);
  }

  const ToolbarAny = ResourceTableToolbar as any;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {resourceLabel}
      </Typography>

      <div style={{ height: "100%", width: "100%", minHeight: 0 }}>
        <DataGrid
          rows={filteredRows}
          columns={cols}
          density="compact"
          loading={loading}
          disableMultipleRowSelection
          hideFooterSelectedRowCount
          rowSelectionModel={selectionModel}
          onRowSelectionModelChange={(m) => setSelectionModel(m)}
          onRowDoubleClick={(p) => setDrawerName((p.row as any).name as string)}
          initialState={{
            sorting: { sortModel: [{ field: "name", sort: "asc" }] },
          }}
          slots={{ toolbar: ToolbarAny, noRowsOverlay: ListStateOverlay }}
          slotProps={{
            toolbar: {
              filterLabel: "Filter (name/group/kind/scope)",
              filter,
              onFilterChange: setFilter,
              selectedQuickFilter,
              onQuickFilterToggle: toggleQuickFilter,
              onOpenSelected: openSelected,
              hasSelection: !!selectedName,
              refreshSec,
              onRefreshChange: setRefreshSec,
              quickFilters,
            } as any,
            noRowsOverlay: {
              error,
              accessDenied,
              emptyMessage: `No ${resourceLabel} found.`,
              resourceLabel,
            } as any,
          }}
        />
      </div>
      <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end" }}>
        <Typography variant="caption" color="text.secondary">
          Last refresh: {lastRefresh ? lastRefresh.toLocaleString() : "-"}
        </Typography>
      </Box>

      <CustomResourceDefinitionDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        crdName={drawerName}
      />
    </Paper>
  );
}
