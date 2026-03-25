import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import NodeDrawer from "./NodeDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { nodeStatusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Node = {
  name: string;
  status: string;
  roles?: string[];
  cpuAllocatable?: string;
  memoryAllocatable?: string;
  podsAllocatable?: string;
  podsCount: number;
  kubeletVersion?: string;
  ageSec: number;
};

type Row = Node & { id: string };

const resourceLabel = getResourceLabel("nodes");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.value || "");
      return <Chip size="small" label={status || "-"} color={nodeStatusChipColor(status)} />;
    },
  },
  {
    field: "roles",
    headerName: "Roles",
    width: 200,
    renderCell: (p) => {
      const roles = p.row?.roles ?? [];
      return roles.length ? roles.join(", ") : "-";
    },
    sortable: false,
  },
  {
    field: "cpuAllocatable",
    headerName: "CPU Allocatable",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "memoryAllocatable",
    headerName: "Memory Allocatable",
    width: 170,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "podsCount",
    headerName: "Pods",
    width: 110,
    type: "number",
  },
  {
    field: "kubeletVersion",
    headerName: "Kubelet",
    width: 150,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function NodesTable({ token }: { token: string }) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: Node[] }>("/api/nodes", token);
    const items = res.items || [];
    return { rows: items.map((n) => ({ ...n, id: n.name })) };
  }, [token]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    const roleText = (row.roles || []).join(", ").toLowerCase();
    return (
      row.name.toLowerCase().includes(q) ||
      (row.status || "").toLowerCase().includes(q) ||
      roleText.includes(q)
    );
  }, []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/role/status)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.nodes}
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <NodeDrawer
          open={open}
          onClose={onClose}
          token={token}
          nodeName={selectedId}
        />
      )}
    />
  );
}
