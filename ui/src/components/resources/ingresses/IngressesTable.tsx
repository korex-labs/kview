import React, { useCallback } from "react";
import { Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import IngressDrawer from "./IngressDrawer";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type Ingress = {
  name: string;
  namespace: string;
  ingressClassName?: string;
  hosts?: string[];
  tlsCount: number;
  addresses?: string[];
  ageSec: number;
  routingHealthBucket?: string;
  addressState?: string;
  tlsHint?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = Ingress & { id: string };

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 140,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
    },
    sortable: false,
  },
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
    field: "tlsHint",
    headerName: "TLS",
    width: 110,
    renderCell: (p) => {
      const hint = p.row.tlsHint || "";
      const label = hint === "enabled" ? `yes (${p.row.tlsCount})` : "none";
      return <Chip size="small" label={label} color={hint === "enabled" ? "success" : "warning"} />;
    },
  },
  {
    field: "addressState",
    headerName: "Address",
    width: 140,
    renderCell: (p) => {
      const state = p.row.addressState || "";
      const label = state || "-";
      return <Chip size="small" label={label} color={state === "ready" ? "success" : state === "pending" ? "warning" : "default"} />;
    },
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
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Ingress>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/ingresses`,
      token,
      contextName || "",
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
      (row.listSignalSeverity || "").toLowerCase().includes(q) ||
      (row.addressState || "").toLowerCase().includes(q) ||
      (row.tlsHint || "").toLowerCase().includes(q) ||
      (row.ingressClassName || "").toLowerCase().includes(q) ||
      (row.hosts || []).join(" ").toLowerCase().includes(q) ||
      (row.addresses || []).join(" ").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "ingresses", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      resourceKey="ingresses"
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
