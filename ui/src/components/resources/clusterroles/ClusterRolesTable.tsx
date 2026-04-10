import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ClusterRoleDrawer from "./ClusterRoleDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type ClusterRole = {
  name: string;
  rulesCount: number;
  ageSec: number;
  privilegeBreadth?: string;
  needsAttention?: boolean;
};

type Row = ClusterRole & { id: string };

const resourceLabel = getResourceLabel("clusterroles");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "privilegeBreadth",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const breadth = p.row.privilegeBreadth || "unknown";
      return <Chip size="small" label={breadth} color={breadth === "broad" || breadth === "empty" ? "warning" : "default"} />;
    },
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

export default function ClusterRolesTable({ token }: { token: string }) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: ClusterRole[] }>("/api/clusterroles", token);
    const items = res.items || [];
    return { rows: items.map((role) => ({ ...role, id: role.name })) };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.privilegeBreadth || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/signal)"
      resourceLabel={resourceLabel}
      resourceKey="clusterroles"
      accessResource={listResourceAccess.clusterroles}
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <ClusterRoleDrawer
          open={open}
          onClose={onClose}
          token={token}
          clusterRoleName={selectedId}
        />
      )}
    />
  );
}
