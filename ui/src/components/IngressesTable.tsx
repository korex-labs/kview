import React, { useCallback, useMemo, useState } from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import { DataGrid, GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import { apiGet } from "../api";
import { fmtAge, valueOrDash } from "../utils/format";
import IngressDrawer from "./IngressDrawer";
import useListQuery from "../utils/useListQuery";
import useEmptyListAccessCheck from "../utils/useEmptyListAccessCheck";
import { getResourceLabel, listResourceAccess } from "../utils/k8sResources";
import ListStateOverlay from "./shared/ListStateOverlay";
import useListFilters from "../utils/useListFilters";
import ResourceTableToolbar from "./shared/ResourceTableToolbar";

type Ingress = {
  name: string;
  namespace: string;
  ingressClassName?: string;
  hosts?: string[];
  tlsCount: number;
  addresses?: string[];
  ageSec: number;
};

type Row = Ingress & { id: string };

const resourceLabel = getResourceLabel("ingresses");

const cols: GridColDef[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "ingressClassName",
    headerName: "Class",
    width: 160,
    renderCell: (p) => <Chip size="small" label={valueOrDash(String(p.value || ""))} />,
  },
  {
    field: "hosts",
    headerName: "Hosts",
    flex: 1,
    minWidth: 240,
    renderCell: (p) => {
      const hosts = (p.row as any).hosts as string[] | undefined;
      return (
        <Typography variant="body2" noWrap>
          {valueOrDash(hosts?.join(", "))}
        </Typography>
      );
    },
    sortable: false,
  },
  {
    field: "tlsCount",
    headerName: "TLS",
    width: 110,
    renderCell: (p) => {
      const count = Number(p.value || 0);
      const label = count > 0 ? `Yes (${count})` : "No";
      return <Chip size="small" label={label} />;
    },
  },
  {
    field: "addresses",
    headerName: "Address",
    width: 200,
    renderCell: (p) => {
      const addresses = (p.row as any).addresses as string[] | undefined;
      return (
        <Typography variant="body2" noWrap>
          {valueOrDash(addresses?.join(", "))}
        </Typography>
      );
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

export default function IngressesTable({ token, namespace }: { token: string; namespace: string }) {
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
    const res = await apiGet<any>(`/api/namespaces/${encodeURIComponent(namespace)}/ingresses`, token);
    const items: Ingress[] = res.items || [];
    return items.map((i) => ({ ...i, id: `${i.namespace}/${i.name}` }));
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
    resource: listResourceAccess.ingresses,
    namespace,
  });

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.ingressClassName || "").toLowerCase().includes(q) ||
      (row.hosts || []).join(", ").toLowerCase().includes(q) ||
      (row.addresses || []).join(", ").toLowerCase().includes(q),
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
              filterLabel: "Filter (name/class/host/address)",
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

      <IngressDrawer
        open={!!drawerName}
        onClose={() => setDrawerName(null)}
        token={token}
        namespace={namespace}
        ingressName={drawerName}
      />
    </Paper>
  );
}
