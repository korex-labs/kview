import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import StatefulSetDrawer from "./StatefulSetDrawer";
import { fmtAge } from "../utils/format";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type StatefulSet = {
  name: string;
  namespace: string;
  desired: number;
  ready: number;
  current: number;
  updated: number;
  serviceName?: string;
  updateStrategy?: string;
  selector?: string;
  ageSec: number;
};

type Row = StatefulSet & { id: string };

const resourceLabel = getResourceLabel("statefulsets");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "ready",
    headerName: "Ready",
    width: 140,
    renderCell: (p) => {
      const row = p.row as Row;
      const ready = row.ready ?? 0;
      const desired = row.desired ?? 0;
      return `${ready}/${desired}`;
    },
    sortable: false,
  },
  { field: "serviceName", headerName: "Service", width: 220 },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number((p.row as any)?.ageSec), "table"),
  },
];


export default function StatefulSetsTable({ token, namespace }: { token: string; namespace: string }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedName = useMemo(() => {
    if (!selectionModel.length) return null;
    const id = String(selectionModel[0]); // `${ns}/${name}`
    const parts = id.split("/");
    return parts.length >= 2 ? parts.slice(1).join("/") : null;
  }, [selectionModel]);

  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(10);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>(`/api/namespaces/${encodeURIComponent(namespace)}/statefulsets`, token);
    const items: StatefulSet[] = res.items || [];
    return items.map((d) => ({ ...d, id: `${d.namespace}/${d.name}` }));
  }, [token, namespace]);

  const { items: rows, error, loading, lastRefresh } = useListQuery<Row>({
    enabled: !!namespace,
    refreshSec,
    fetchItems: fetchRows,
    onInitialResult: () => setSelectionModel([]),
  });

  const accessDenied = useEmptyListAccessCheck({
    token,
    itemsLength: rows.length,
    error,
    loading,
    resource: listResourceAccess.statefulsets,
    namespace,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) || (row.serviceName || "").toLowerCase().includes(q),
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
        {resourceLabel} — {namespace}
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
              filterLabel: "Filter (name/service)",
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

      <StatefulSetDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespace={namespace}
        statefulSetName={drawerName}
      />
    </Paper>
  );
}
