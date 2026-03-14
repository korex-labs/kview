import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import NodeDrawer from "./NodeDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { nodeStatusChipColor } from "../../../utils/k8sUi";
import useListQuery from "../../../utils/useListQuery";
import useEmptyListAccessCheck from "../../../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ListStateOverlay from "../../shared/ListStateOverlay";
import useListFilters from "../../../utils/useListFilters";
import ResourceTableToolbar from "../../shared/ResourceTableToolbar";

type Node = {
  name: string;
  status: string;
  roles?: string[];
  cpuAllocatable?: string;
  memoryAllocatable?: string;
  podsAllocatable?: string;
  podsCount: number;
  kubeletVersion?: string;
  ageSec: number;
};

type Row = Node & { id: string };

const resourceLabel = getResourceLabel("nodes");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.value || "");
      return <Chip size="small" label={status || "-"} color={nodeStatusChipColor(status)} />;
    },
  },
  {
    field: "roles",
    headerName: "Roles",
    width: 200,
    renderCell: (p) => {
      const roles = ((p.row as any)?.roles || []) as string[];
      return roles.length ? roles.join(", ") : "-";
    },
    sortable: false,
  },
  {
    field: "cpuAllocatable",
    headerName: "CPU Allocatable",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "memoryAllocatable",
    headerName: "Memory Allocatable",
    width: 170,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "podsCount",
    headerName: "Pods",
    width: 110,
    type: "number",
  },
  {
    field: "kubeletVersion",
    headerName: "Kubelet",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number((p.row as any)?.ageSec), "table"),
  },
];

export default function NodesTable({ token }: { token: string }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedName = useMemo(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(10);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>("/api/nodes", token);
    const items: Node[] = res.items || [];
    return items.map((n) => ({ ...n, id: n.name }));
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
    resource: listResourceAccess.nodes,
    namespace: null,
  });

  const filterPredicate = useCallback((row: Row, q: string) => {
    const roleText = (row.roles || []).join(", ").toLowerCase();
    return row.name.toLowerCase().includes(q) || (row.status || "").toLowerCase().includes(q) || roleText.includes(q);
  }, []);

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
              filterLabel: "Filter (name/role/status)",
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

      <NodeDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        nodeName={drawerName}
      />
    </Paper>
  );
}
