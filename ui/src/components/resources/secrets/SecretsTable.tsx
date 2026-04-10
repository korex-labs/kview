import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import SecretDrawer from "./SecretDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type Secret = {
  name: string;
  namespace: string;
  type: string;
  keysCount: number;
  immutable: boolean;
  ageSec: number;
  contentHint?: string;
  typeHint?: string;
  needsAttention?: boolean;
};

type Row = Secret & { id: string };

const resourceLabel = getResourceLabel("secrets");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "contentHint",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const hint = p.row.contentHint;
      if (!hint) return "-";
      return <Chip size="small" label={p.row.needsAttention ? "empty" : hint} color={hint === "empty" ? "warning" : "success"} />;
    },
    sortable: false,
  },
  {
    field: "type",
    headerName: "Type",
    width: 220,
    renderCell: (p) => <Chip size="small" variant="outlined" label={valueOrDash(p.row.typeHint || (p.value as string | undefined))} />,
  },
  {
    field: "keysCount",
    headerName: "Keys",
    width: 120,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "immutable",
    headerName: "Immutable",
    width: 130,
    renderCell: (p) => (
      <Chip size="small" label={p.value ? "Yes" : "No"} />
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

export default function SecretsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Secret>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/secrets`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((s) => ({ ...s, id: `${s.namespace}/${s.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.type || "").toLowerCase().includes(q) ||
      (row.typeHint || "").toLowerCase().includes(q) ||
      (row.contentHint || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "secrets", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/type/signal)"
      resourceLabel={resourceLabel}
      resourceKey="secrets"
      accessResource={listResourceAccess.secrets}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const secretName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <SecretDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            secretName={secretName}
          />
        );
      }}
    />
  );
}
