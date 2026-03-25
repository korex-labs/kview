import React, { useCallback } from "react";
import { Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import IngressDrawer from "./IngressDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

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

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "ingressClassName",
    headerName: "Class",
    width: 160,
    renderCell: (p) => (
      <Chip size="small" label={valueOrDash(String(p.value || ""))} />
    ),
  },
  {
    field: "hosts",
    headerName: "Hosts",
    flex: 1,
    minWidth: 240,
    renderCell: (p) => (
      <Typography variant="body2" noWrap>
        {valueOrDash(p.row.hosts?.join(", "))}
      </Typography>
    ),
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
    renderCell: (p) => (
      <Typography variant="body2" noWrap>
        {valueOrDash(p.row.addresses?.join(", "))}
      </Typography>
    ),
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

export default function IngressesTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<Ingress>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/ingresses`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((i) => ({ ...i, id: `${i.namespace}/${i.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.ingressClassName || "").toLowerCase().includes(q) ||
      (row.hosts || []).join(" ").toLowerCase().includes(q) ||
      (row.addresses || []).join(" ").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/class/host/address)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.ingresses}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const ingressName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <IngressDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            ingressName={ingressName}
          />
        );
      }}
    />
  );
}
