import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtTs, valueOrDash } from "../../../utils/format";
import HelmReleaseDrawer from "./HelmReleaseDrawer";
import { HelmInstallButton } from "./HelmActions";
import useListQuery from "../../../utils/useListQuery";
import useEmptyListAccessCheck from "../../../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ListStateOverlay from "../../shared/ListStateOverlay";
import useListFilters from "../../../utils/useListFilters";
import ResourceTableToolbar from "../../shared/ResourceTableToolbar";

type HelmRelease = {
  name: string;
  namespace: string;
  status: string;
  revision: number;
  chart: string;
  chartName: string;
  chartVersion: string;
  appVersion: string;
  description: string;
  updated: number;
  storageBackend: string;
};

type Row = HelmRelease & { id: string };

type ChipColor = "success" | "warning" | "error" | "default";

function helmStatusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "deployed":
      return "success";
    case "superseded":
      return "default";
    case "failed":
      return "error";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
    case "uninstalling":
      return "warning";
    case "unknown":
      return "warning";
    default:
      return "default";
  }
}

const resourceLabel = getResourceLabel("helm");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 200 },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => (
      <Chip
        size="small"
        label={valueOrDash(p.value as string | undefined)}
        color={helmStatusChipColor(p.value as string | undefined)}
      />
    ),
  },
  {
    field: "revision",
    headerName: "Revision",
    width: 90,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "chart",
    headerName: "Chart",
    width: 220,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "appVersion",
    headerName: "App Version",
    width: 130,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "updated",
    headerName: "Updated",
    width: 180,
    renderCell: (p) => fmtTs(p.value as number | undefined),
  },
];

export default function HelmReleasesTable({ token, namespace }: { token: string; namespace: string }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedName = useMemo(() => {
    if (!selectionModel.length) return null;
    const id = String(selectionModel[0]);
    const parts = id.split("/");
    return parts.length >= 2 ? parts.slice(1).join("/") : null;
  }, [selectionModel]);

  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(10);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>(`/api/namespaces/${encodeURIComponent(namespace)}/helmreleases`, token);
    const items: HelmRelease[] = res.items || [];
    return items.map((r) => ({ ...r, id: `${r.namespace}/${r.name}` }));
  }, [token, namespace]);

  const { items: rows, error, loading, lastRefresh, refetch } = useListQuery<Row>({
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
    resource: listResourceAccess.helm,
    namespace,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      row.chart.toLowerCase().includes(q) ||
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
              filterLabel: "Filter (name / chart / version)",
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
      <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 1 }}>
        <HelmInstallButton token={token} namespace={namespace} onSuccess={() => void refetch()} />
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Last refresh: {lastRefresh ? lastRefresh.toLocaleString() : "-"}
        </Typography>
      </Box>

      <HelmReleaseDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespace={namespace}
        releaseName={drawerName}
        onRefresh={() => void refetch()}
      />
    </Paper>
  );
}
