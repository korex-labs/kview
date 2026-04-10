import React, { useCallback } from "react";
import { Chip } from "@mui/material";
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
  bindingHint?: string;
  subjectBreadth?: string;
  needsAttention?: boolean;
};

type Row = ClusterRoleBinding & { id: string };

const resourceLabel = getResourceLabel("clusterrolebindings");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "subjectBreadth",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const breadth = p.row.subjectBreadth || "unknown";
      return <Chip size="small" label={breadth} color={breadth === "broad" || breadth === "empty" ? "warning" : "default"} />;
    },
  },
  {
    field: "roleRefName",
    headerName: "Role Ref",
    width: 220,
    renderCell: (p) => (
      <Chip
        size="small"
        label={`${p.row.bindingHint || p.row.roleRefKind || "unknown"}: ${p.row.roleRefName || "-"}`}
        color={p.row.roleRefKind === "ClusterRole" ? "primary" : "default"}
        variant="outlined"
      />
    ),
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
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.roleRefKind || "").toLowerCase().includes(q) ||
      (row.roleRefName || "").toLowerCase().includes(q) ||
      (row.bindingHint || "").toLowerCase().includes(q) ||
      (row.subjectBreadth || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/role/signal)"
      resourceLabel={resourceLabel}
      resourceKey="clusterrolebindings"
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
