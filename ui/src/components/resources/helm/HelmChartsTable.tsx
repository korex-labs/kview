import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { valueOrDash } from "../../../utils/format";
import HelmChartDrawer from "./HelmChartDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneListMetaFromResponse, type DataplaneListMeta } from "../../../types/api";

type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces: string[];
  statuses?: string[];
  needsAttention?: number;
  versions?: Array<{
    chartVersion?: string;
    appVersion?: string;
    releases: number;
    namespaces?: string[];
    statuses?: string[];
    needsAttention?: number;
  }>;
  derived?: boolean;
  derivedSource?: string;
  derivedCoverage?: string;
  derivedNote?: string;
};

type Row = HelmChart & { id: string };

const resourceLabel = getResourceLabel("helmcharts");

const columns: GridColDef<Row>[] = [
  { field: "chartName", headerName: "Chart", flex: 1, minWidth: 200 },
  {
    field: "derived",
    headerName: "Source",
    width: 120,
    renderCell: (p) => p.row.derived ? <Chip size="small" label="derived" color="warning" variant="outlined" /> : "direct",
    sortable: false,
  },
  {
    field: "chartVersion",
    headerName: "Versions",
    width: 150,
    renderCell: (p) => {
      const count = p.row.versions?.length || 0;
      if (count > 1) return `${count} versions`;
      return valueOrDash(p.row.chartVersion);
    },
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
    width: 130,
    type: "number",
    renderCell: (p) => p.row.namespaces?.length || 0,
  },
  {
    field: "needsAttention",
    headerName: "Signals",
    width: 110,
    type: "number",
    renderCell: (p) => p.row.needsAttention ? <Chip size="small" color="warning" label={p.row.needsAttention} /> : "-",
  },
];

export default function HelmChartsTable({ token }: { token: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<{ items: HelmChart[]; meta?: Partial<DataplaneListMeta>; observed?: string }>("/api/helmcharts", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((c) => ({
        ...c,
        id: c.chartName,
      })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.chartName.toLowerCase().includes(q) ||
      (row.chartVersion || "").toLowerCase().includes(q) ||
      (row.appVersion || "").toLowerCase().includes(q) ||
      (row.versions || []).some((v) =>
        (v.chartVersion || "").toLowerCase().includes(q) ||
        (v.appVersion || "").toLowerCase().includes(q) ||
        (v.statuses || []).join(",").toLowerCase().includes(q),
      ) ||
      (row.derived ? "derived" : "direct").includes(q) ||
      (row.statuses || []).join(",").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (chart/version/status/source)"
      resourceLabel={resourceLabel}
      resourceKey="helmcharts"
      accessResource={listResourceAccess.helmcharts}
      namespace={null}
      defaultSortField="chartName"
      skipEmptyAccessCheck
      renderDrawer={({ selectedRow, open, onClose }) => (
        <HelmChartDrawer
          open={open}
          onClose={onClose}
          token={token}
          chart={selectedRow}
        />
      )}
    />
  );
}
