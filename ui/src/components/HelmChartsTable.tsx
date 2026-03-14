import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import { valueOrDash } from "../utils/format";
import HelmChartDrawer from "./HelmChartDrawer";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces: string[];
};

type Row = HelmChart & { id: string };

const resourceLabel = getResourceLabel("helmcharts");

const cols: GridColDef[] = [
  { field: "chartName", headerName: "Chart", flex: 1, minWidth: 200 },
  {
    field: "chartVersion",
    headerName: "Version",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "appVersion",
    headerName: "App Version",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "releases",
    headerName: "Releases",
    width: 100,
    type: "number",
  },
  {
    field: "namespaces",
    headerName: "Namespaces",
    flex: 1,
    minWidth: 200,
    renderCell: (p) => {
      const ns = p.value as string[] | undefined;
      if (!ns || ns.length === 0) return "-";
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {ns.map((n) => (
            <Chip key={n} size="small" label={n} variant="outlined" />
          ))}
        </Box>
      );
    },
  },
];

export default function HelmChartsTable({ token }: { token: string }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedId = useMemo(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerChart, setDrawerChart] = useState<HelmChart | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(30);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>("/api/helmcharts", token);
    const items: HelmChart[] = res.items || [];
    return items.map((c) => ({
      ...c,
      id: `${c.chartName}/${c.chartVersion}`,
    }));
  }, [token]);

  const { items: rows, error, loading, lastRefresh } = useListQuery<Row>({
    enabled: true,
    refreshSec,
    fetchItems: fetchRows,
    onInitialResult: () => setSelectionModel([]),
  });

  const accessDenied = useEmptyListAccessCheck({
    token,
    itemsLength: rows.length,
    error,
    loading,
    resource: listResourceAccess.helmcharts,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.chartName.toLowerCase().includes(q) ||
      (row.chartVersion || "").toLowerCase().includes(q) ||
      (row.appVersion || "").toLowerCase().includes(q),
    [],
  );

  const { filter, setFilter, selectedQuickFilter, toggleQuickFilter, quickFilters, filteredRows } =
    useListFilters<Row>({
      rows,
      lastRefresh,
      filterPredicate,
    });

  function openSelected() {
    if (!selectedId) return;
    const row = rows.find((r) => r.id === selectedId);
    if (row) setDrawerChart(row);
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
          onRowDoubleClick={(p) => {
            const row = p.row as Row;
            setDrawerChart(row);
          }}
          initialState={{
            sorting: { sortModel: [{ field: "chartName", sort: "asc" }] },
          }}
          getRowHeight={() => "auto"}
          slots={{ toolbar: ToolbarAny, noRowsOverlay: ListStateOverlay }}
          slotProps={{
            toolbar: {
              filterLabel: "Filter (chart / version)",
              filter,
              onFilterChange: setFilter,
              selectedQuickFilter,
              onQuickFilterToggle: toggleQuickFilter,
              onOpenSelected: openSelected,
              hasSelection: !!selectedId,
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

      <HelmChartDrawer
        open={!!drawerChart}
        onClose={() => setDrawerChart(null)}
        chart={drawerChart}
      />
    </Paper>
  );
}
