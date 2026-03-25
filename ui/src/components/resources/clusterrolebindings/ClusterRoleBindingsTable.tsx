import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ClusterRoleBindingDrawer from "./ClusterRoleBindingDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type ClusterRoleBinding = {
  name: string;
  roleRefKind: string;
  roleRefName: string;
  subjectsCount: number;
  ageSec: number;
};

type Row = ClusterRoleBinding & { id: string };

const resourceLabel = getResourceLabel("clusterrolebindings");

function formatRoleRef(kind?: string, name?: string) {
  return `${kind || "-"}/${name || "-"}`;
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
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

export default function ClusterRoleBindingsTable({ token }: { token: string }) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: ClusterRoleBinding[] }>("/api/clusterrolebindings", token);
    const items = res.items || [];
    return { rows: items.map((rb) => ({ ...rb, id: rb.name })) };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.clusterrolebindings}
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <ClusterRoleBindingDrawer
          open={open}
          onClose={onClose}
          token={token}
          clusterRoleBindingName={selectedId}
        />
      )}
    />
  );
}
