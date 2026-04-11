import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import NodeDrawer from "./NodeDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { nodeStatusChipColor, workloadHealthBucketColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

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
  healthBucket?: string;
  podDensityBucket?: string;
  podDensityRatio?: number;
  needsAttention?: boolean;
  derived?: boolean;
  derivedSource?: string;
  derivedCoverage?: string;
  derivedNote?: string;
  namespaceCount?: number;
  problematicPods?: number;
  restartCount?: number;
};

type Row = Node & { id: string };

const resourceLabel = getResourceLabel("nodes");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "derived",
    headerName: "Source",
    width: 120,
    renderCell: (p) => p.row.derived ? <Chip size="small" label="derived" color="warning" variant="outlined" /> : "direct",
    sortable: false,
  },
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
    field: "healthBucket",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const bucket = p.row.healthBucket;
      if (!bucket) return "-";
      return <Chip size="small" label={p.row.needsAttention ? "attention" : bucket} color={workloadHealthBucketColor(bucket)} />;
    },
    sortable: false,
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
    field: "problematicPods",
    headerName: "Signals",
    width: 110,
    type: "number",
    renderCell: (p) => p.row.derived ? (p.row.problematicPods ?? 0) : "-",
  },
  {
    field: "podDensityBucket",
    headerName: "Density",
    width: 130,
    renderCell: (p) => {
      const bucket = p.row.podDensityBucket;
      if (!bucket || bucket === "unknown") return "-";
      const pct = p.row.podDensityRatio != null ? `${Math.round(p.row.podDensityRatio * 100)}%` : bucket;
      return <Chip size="small" label={`${pct} ${bucket}`} color={workloadHealthBucketColor(bucket)} />;
    },
    sortable: false,
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
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Node>>("/api/nodes", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((n) => ({ ...n, id: n.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    const roleText = (row.roles || []).join(", ").toLowerCase();
    return (
      row.name.toLowerCase().includes(q) ||
      (row.status || "").toLowerCase().includes(q) ||
      (row.healthBucket || "").toLowerCase().includes(q) ||
      (row.podDensityBucket || "").toLowerCase().includes(q) ||
      (row.derivedSource || "").toLowerCase().includes(q) ||
      (row.derived ? "derived" : "direct").includes(q) ||
      roleText.includes(q)
    );
  }, []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "nodes"),
        pollSec: defaultRevisionPollSec,
      }}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/role/status/signal/source)"
      resourceLabel={resourceLabel}
      resourceKey="nodes"
      accessResource={listResourceAccess.nodes}
      namespace={null}
      skipEmptyAccessCheck
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
