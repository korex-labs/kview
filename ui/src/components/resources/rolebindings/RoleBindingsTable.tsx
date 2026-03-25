import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import RoleBindingDrawer from "./RoleBindingDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type RoleBinding = {
  name: string;
  namespace: string;
  roleRefKind: string;
  roleRefName: string;
  subjectsCount: number;
  ageSec: number;
};

type Row = RoleBinding & { id: string };

const resourceLabel = getResourceLabel("rolebindings");

function formatRoleRef(kind?: string, name?: string) {
  return `${kind || "-"}/${name || "-"}`;
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "roleRefName",
    headerName: "Role Ref",
    width: 220,
    renderCell: (p) => formatRoleRef(p.row.roleRefKind, p.row.roleRefName),
    sortable: false,
  },
  {
    field: "subjectsCount",
    headerName: "Subjects",
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

export default function RoleBindingsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: RoleBinding[] }>(
      `/api/namespaces/${encodeURIComponent(namespace)}/rolebindings`,
      token,
    );
    const items = res.items || [];
    return { rows: items.map((rb) => ({ ...rb, id: `${rb.namespace}/${rb.name}` })) };
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
      accessResource={listResourceAccess.rolebindings}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const roleBindingName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <RoleBindingDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            roleBindingName={roleBindingName}
          />
        );
      }}
    />
  );
}
