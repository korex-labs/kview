import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import { fmtAge, valueOrDash } from "../utils/format";
import { pvcPhaseChipColor } from "../utils/k8sUi";
import PersistentVolumeClaimDrawer from "./PersistentVolumeClaimDrawer";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type PersistentVolumeClaim = {
  name: string;
  namespace: string;
  phase?: string;
  storageClassName?: string;
  volumeName?: string;
  accessModes?: string[];
  requestedStorage?: string;
  capacity?: string;
  volumeMode?: string;
  ageSec: number;
};

type Row = PersistentVolumeClaim & { id: string };

const resourceLabel = getResourceLabel("persistentvolumeclaims");

function formatSize(requested?: string, capacity?: string) {
  const req = requested || "";
  const cap = capacity || "";
  if (!req && !cap) return "-";
  if (req && cap && req !== cap) return `${req} / ${cap}`;
  return req || cap;
}

function formatAccessModes(modes?: string[]) {
  if (!modes || modes.length === 0) return "-";
  return modes.join(", ");
}

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "phase",
    headerName: "Status",
    width: 140,
    renderCell: (p) => <Chip size="small" label={valueOrDash(String(p.value || ""))} color={pvcPhaseChipColor(String(p.value || ""))} />,
  },
  {
    field: "storageClassName",
    headerName: "StorageClass",
    width: 180,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "requestedStorage",
    headerName: "Size",
    width: 180,
    renderCell: (p) => {
      const row = p.row as Row;
      return formatSize(row.requestedStorage, row.capacity);
    },
    sortable: false,
  },
  {
    field: "volumeName",
    headerName: "Volume",
    width: 200,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "accessModes",
    headerName: "Access Modes",
    width: 200,
    renderCell: (p) => {
      const row = p.row as Row;
      return formatAccessModes(row.accessModes);
    },
    sortable: false,
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number((p.row as any)?.ageSec), "table"),
  },
];


export default function PersistentVolumeClaimsTable({ token, namespace }: { token: string; namespace: string }) {
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
    const res = await apiGet<any>(
      `/api/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`,
      token
    );
    const items: PersistentVolumeClaim[] = res.items || [];
    return items.map((pvc) => ({ ...pvc, id: `${pvc.namespace}/${pvc.name}` }));
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
    resource: listResourceAccess.persistentvolumeclaims,
    namespace,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
      (row.storageClassName || "").toLowerCase().includes(q) ||
      (row.volumeName || "").toLowerCase().includes(q),
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
              filterLabel: "Filter (name/status/storageClass/volume)",
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

      <PersistentVolumeClaimDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespace={namespace}
        persistentVolumeClaimName={drawerName}
      />
    </Paper>
  );
}
