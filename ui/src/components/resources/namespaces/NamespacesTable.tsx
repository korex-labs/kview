import React, { useCallback, useMemo, useState } from "react";
import {
  Paper,
  Typography,
  Box,
  Chip,
} from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import NamespaceDrawer from "./NamespaceDrawer";
import { fmtAge } from "../../../utils/format";
import { namespacePhaseChipColor } from "../../../utils/k8sUi";
import useListQuery from "../../../utils/useListQuery";
import useEmptyListAccessCheck from "../../../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ListStateOverlay from "../../shared/ListStateOverlay";
import useListFilters from "../../../utils/useListFilters";
import ResourceTableToolbar from "../../shared/ResourceTableToolbar";

type Namespace = {
  name: string;
  phase: string;
  ageSec: number;
  hasUnhealthyConditions: boolean;
};

type Row = Namespace & { id: string };

const resourceLabel = getResourceLabel("namespaces");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "phase",
    headerName: "Phase",
    width: 180,
    renderCell: (p) => {
      const phase = String(p.value || "");
      const row = p.row as Row;
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" label={phase || "-"} color={namespacePhaseChipColor(phase)} />
          {row.hasUnhealthyConditions && <Chip size="small" color="error" label="Unhealthy" />}
        </Box>
      );
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

export default function NamespacesTable({ token, onNavigate }: { token: string; onNavigate?: (section: string, namespace: string) => void }) {
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const selectedName = useMemo(() => {
    if (!selectionModel.length) return null;
    return String(selectionModel[0]);
  }, [selectionModel]);

  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(10);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<any>("/api/namespaces", token);
    const items: Namespace[] = res.items || [];
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
    resource: listResourceAccess.namespaces,
    namespace: null,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q) || (row.phase || "").toLowerCase().includes(q),
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
              filterLabel: "Filter (name/phase)",
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

      <NamespaceDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespaceName={drawerName}
        onNavigate={onNavigate}
      />
    </Paper>
  );
}
