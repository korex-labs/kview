import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ServiceAccountDrawer from "./ServiceAccountDrawer";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";

type ServiceAccount = {
  name: string;
  namespace: string;
  imagePullSecretsCount: number;
  secretsCount: number;
  automountServiceAccountToken?: boolean;
  ageSec: number;
  tokenMountPolicy?: string;
  pullSecretHint?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = ServiceAccount & { id: string };

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
    },
    sortable: false,
  },
  {
    field: "tokenMountPolicy",
    headerName: "Token",
    width: 130,
    renderCell: (p) => {
      const policy = p.row.tokenMountPolicy || "default";
      return <StatusChip size="small" label={policy} color={policy === "disabled" ? "success" : policy === "enabled" ? "warning" : "default"} />;
    },
    sortable: false,
  },
  {
    field: "pullSecretHint",
    headerName: "Pull Secret",
    width: 130,
    renderCell: (p) => {
      const hint = p.row.pullSecretHint || "none";
      return <StatusChip size="small" variant="outlined" label={hint} />;
    },
    sortable: false,
  },
  {
    field: "imagePullSecretsCount",
    headerName: "ImagePullSecrets",
    width: 160,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "secretsCount",
    headerName: "Secrets",
    width: 120,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function ServiceAccountsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<ServiceAccount>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/serviceaccounts`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((sa) => ({ ...sa, id: `${sa.namespace}/${sa.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q) ||
      (row.tokenMountPolicy || "").toLowerCase().includes(q) ||
      (row.pullSecretHint || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "serviceaccounts", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      resourceKey="serviceaccounts"
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const serviceAccountName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <ServiceAccountDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            serviceAccountName={serviceAccountName}
          />
        );
      }}
    />
  );
}
