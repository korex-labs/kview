import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ServiceDrawer from "./ServiceDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Service = {
  name: string;
  namespace: string;
  type: string;
  clusterIPs?: string[];
  portsSummary?: string;
  endpointsReady: number;
  endpointsNotReady: number;
  ageSec: number;
};

type Row = Service & { id: string };

const resourceLabel = getResourceLabel("services");

function formatEndpointsSummary(ready?: number, notReady?: number) {
  const r = ready || 0;
  const n = notReady || 0;
  return `${r}/${r + n}`;
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "type",
    headerName: "Type",
    width: 150,
    renderCell: (p) => <Chip size="small" label={valueOrDash(String(p.value || ""))} />,
  },
  {
    field: "clusterIPs",
    headerName: "Cluster IP",
    width: 180,
    renderCell: (p) => valueOrDash(p.row.clusterIPs?.join(", ")),
  },
  {
    field: "portsSummary",
    headerName: "Ports",
    flex: 1,
    minWidth: 200,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "endpointsReady",
    headerName: "Endpoints",
    width: 140,
    renderCell: (p) =>
      formatEndpointsSummary(p.row.endpointsReady, p.row.endpointsNotReady),
    sortable: false,
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function ServicesTable({ token, namespace }: { token: string; namespace: string }) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<Service>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/services`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((s) => ({ ...s, id: `${s.namespace}/${s.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    return (
      row.name.toLowerCase().includes(q) ||
      (row.type || "").toLowerCase().includes(q) ||
      (row.clusterIPs || []).join(", ").toLowerCase().includes(q) ||
      (row.portsSummary || "").toLowerCase().includes(q)
    );
  }, []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/type/clusterIP)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.services}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const serviceName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <ServiceDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            serviceName={serviceName}
          />
        );
      }}
    />
  );
}
