import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import CronJobDrawer from "./CronJobDrawer";
import { fmtAge, fmtTs } from "../utils/format";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type CronJob = {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active: number;
  lastScheduleTime?: number;
  lastSuccessfulTime?: number;
  ageSec: number;
};

type Row = CronJob & { id: string };

const resourceLabel = getResourceLabel("cronjobs");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  { field: "schedule", headerName: "Schedule", flex: 1, minWidth: 200 },
  {
    field: "suspend",
    headerName: "Suspend",
    width: 120,
    renderCell: (p) => {
      const val = (p.row as any)?.suspend;
      if (val === undefined || val === null) return "-";
      const suspended = Boolean(val);
      return (
        <Chip size="small" label={suspended ? "Yes" : "No"} color={suspended ? "warning" : "default"} />
      );
    },
  },
  { field: "active", headerName: "Active", width: 110, type: "number" },
  {
    field: "lastScheduleTime",
    headerName: "Last Schedule",
    width: 180,
    renderCell: (p) => {
      const ts = Number((p.row as any)?.lastScheduleTime);
      return ts > 0 ? fmtTs(ts) : "-";
    },
  },
  {
    field: "lastSuccessfulTime",
    headerName: "Last Success",
    width: 180,
    renderCell: (p) => {
      const ts = Number((p.row as any)?.lastSuccessfulTime);
      return ts > 0 ? fmtTs(ts) : "-";
    },
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number((p.row as any)?.ageSec), "table"),
  },
];

export default function CronJobsTable({ token, namespace }: { token: string; namespace: string }) {
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
    const res = await apiGet<any>(`/api/namespaces/${encodeURIComponent(namespace)}/cronjobs`, token);
    const items: CronJob[] = res.items || [];
    return items.map((cj) => ({ ...cj, id: `${cj.namespace}/${cj.name}` }));
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
    resource: listResourceAccess.cronjobs,
    namespace,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q) || (row.schedule || "").toLowerCase().includes(q),
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
              filterLabel: "Filter (name/schedule)",
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

      <CronJobDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespace={namespace}
        cronJobName={drawerName}
      />
    </Paper>
  );
}
