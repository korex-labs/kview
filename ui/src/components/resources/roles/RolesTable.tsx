import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import RoleDrawer from "./RoleDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Role = {
  name: string;
  namespace: string;
  rulesCount: number;
  ageSec: number;
};

type Row = Role & { id: string };

const resourceLabel = getResourceLabel("roles");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: Role[] }>(
      `/api/namespaces/${encodeURIComponent(namespace)}/roles`,
      token,
    );
    const items = res.items || [];
    return { rows: items.map((role) => ({ ...role, id: `${role.namespace}/${role.name}` })) };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q),
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
      filterLabel="Filter (name)"
      resourceLabel={resourceLabel}
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
