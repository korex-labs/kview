import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import RoleDrawer from "./RoleDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type Role = {
  name: string;
  namespace: string;
  rulesCount: number;
  ageSec: number;
  privilegeBreadth?: string;
  needsAttention?: boolean;
};

type Row = Role & { id: string };

const resourceLabel = getResourceLabel("roles");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "privilegeBreadth",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const breadth = p.row.privilegeBreadth;
      if (!breadth) return "-";
      return <Chip size="small" label={breadth} color={breadth === "broad" || breadth === "empty" ? "warning" : "default"} />;
    },
    sortable: false,
  },
  {
    field: "rulesCount",
    headerName: "Rules",
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

export default function RolesTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Role>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/roles`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((role) => ({ ...role, id: `${role.namespace}/${role.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q) || (row.privilegeBreadth || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "roles", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/signal)"
      resourceLabel={resourceLabel}
      resourceKey="roles"
      accessResource={listResourceAccess.roles}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const roleName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <RoleDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            roleName={roleName}
          />
        );
      }}
    />
  );
}
