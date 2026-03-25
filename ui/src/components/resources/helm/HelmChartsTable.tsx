import React, { useCallback } from "react";
import { Box, Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { valueOrDash } from "../../../utils/format";
import HelmChartDrawer from "./HelmChartDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces: string[];
};

type Row = HelmChart & { id: string };

const resourceLabel = getResourceLabel("helmcharts");

const columns: GridColDef<Row>[] = [
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
      const ns = p.row.namespaces;
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: HelmChart[] }>("/api/helmcharts", token);
    const items = res.items || [];
    return {
      rows: items.map((c) => ({
        ...c,
        id: `${c.chartName}/${c.chartVersion}`,
      })),
    };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.chartName.toLowerCase().includes(q) ||
      (row.chartVersion || "").toLowerCase().includes(q) ||
      (row.appVersion || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (chart / version)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.helmcharts}
      namespace={null}
      defaultSortField="chartName"
      initialRefreshSec={30}
      getRowHeight={() => "auto"}
      renderDrawer={({ selectedRow, open, onClose }) => (
        <HelmChartDrawer
          open={open}
          onClose={onClose}
          chart={selectedRow}
        />
      )}
    />
  );
}
