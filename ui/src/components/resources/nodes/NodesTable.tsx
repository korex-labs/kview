import React, { useCallback, useMemo } from "react";
import { Box, Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import NodeDrawer from "./NodeDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { deploymentHealthBucketColor, nodeStatusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
  type NodeListItemUsage,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import { formatCPUMilli, formatMemoryBytes, formatPct, severityForPct } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";

type Node = NodeListItemUsage & {
  name: string;
  status: string;
  roles?: string[];
  cpuAllocatable?: string;
  memoryAllocatable?: string;
  podsAllocatable?: string;
  podsCount: number;
  kubeletVersion?: string;
  ageSec: number;
  podDensityBucket?: string;
  podDensityRatio?: number;
  derived?: boolean;
  derivedSource?: string;
  derivedCoverage?: string;
  derivedNote?: string;
  namespaceCount?: number;
  problematicPods?: number;
  restartCount?: number;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = Node & { id: string };

const resourceLabel = getResourceLabel("nodes");

function nodeUsageTone(pct: number | undefined): GaugeTone {
  switch (severityForPct(pct, 70, 85)) {
    case "critical":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

function renderNodeUsage(usage: number | undefined, pct: number | undefined, label: string): React.ReactNode {
  if (usage == null) return "—";
  if (pct == null || pct <= 0) return label;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Box sx={{ flex: 1, minWidth: 60 }}>
        <GaugeBar value={pct} tone={nodeUsageTone(pct)} />
      </Box>
      <Box component="span" sx={{ fontSize: 12, minWidth: 92, textAlign: "right" }}>
        {formatPct(pct)} / {label}
      </Box>
    </Box>
  );
}

const baseColumns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "derived",
    headerName: "Source",
    width: 120,
    renderCell: (p) => p.row.derived ? <StatusChip size="small" label="Derived" color="warning" variant="outlined" /> : "Direct",
    sortable: false,
  },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.row.listStatus || p.value || "");
      return <StatusChip label={status || "-"} color={nodeStatusChipColor(status)} />;
    },
  },
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
    renderCell: (p) => p.row.problematicPods ?? "-",
  },
  {
    field: "podDensityBucket",
    headerName: "Density",
    width: 130,
    renderCell: (p) => {
      const bucket = p.row.podDensityBucket;
      if (!bucket || bucket === "unknown") return "-";
      const pct = p.row.podDensityRatio != null ? `${Math.round(p.row.podDensityRatio * 100)}%` : bucket;
      return <StatusChip size="small" label={`${pct} ${bucket}`} color={deploymentHealthBucketColor(bucket)} />;
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

const metricsColumns: GridColDef<Row>[] = [
  {
    field: "cpuMilli",
    headerName: "CPU usage",
    width: 200,
    sortable: true,
    valueGetter: (_value, row) => row.cpuPctAllocatable ?? row.cpuMilli ?? 0,
    renderCell: (p) => {
      const usage = p.row.cpuMilli;
      const pct = p.row.cpuPctAllocatable;
      const label = usage != null ? formatCPUMilli(usage) : "—";
      return renderNodeUsage(usage, pct, label);
    },
  },
  {
    field: "memoryBytes",
    headerName: "Memory usage",
    width: 220,
    sortable: true,
    valueGetter: (_value, row) => row.memoryPctAllocatable ?? row.memoryBytes ?? 0,
    renderCell: (p) => {
      const usage = p.row.memoryBytes;
      const pct = p.row.memoryPctAllocatable;
      const label = usage != null ? formatMemoryBytes(usage) : "—";
      return renderNodeUsage(usage, pct, label);
    },
  },
];

export default function NodesTable({ token }: { token: string }) {
  const metricsStatus = useMetricsStatus(token);
  const columns = useMemo<GridColDef<Row>[]>(() => {
    if (!isMetricsUsable(metricsStatus)) return baseColumns;
    // Place usage gauges right after the static allocatable columns so
    // operators can compare allocated vs live usage at a glance.
    const memAllocIdx = baseColumns.findIndex((c) => c.field === "memoryAllocatable");
    const insertAt = memAllocIdx >= 0 ? memAllocIdx + 1 : baseColumns.length;
    const cols = baseColumns.slice();
    cols.splice(insertAt, 0, ...metricsColumns);
    return cols;
  }, [metricsStatus]);
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
      (row.listSignalSeverity || "").toLowerCase().includes(q) ||
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
