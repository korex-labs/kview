import React, { useCallback, useMemo } from "react";
import { Box, Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import {
  type ApiDataplaneListResponse,
  dataplaneListMetaFromResponse,
  type PodListItemUsage,
} from "../../../types/api";
import PodDrawer from "./PodDrawer";
import { fmtAge } from "../../../utils/format";
import { eventChipColor, listHealthHintColor, phaseChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import { formatCPUMilli, formatMemoryBytes, severityForPct } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";

type Pod = PodListItemUsage & {
  name: string;
  namespace: string;
  node?: string;
  phase: string;
  ready: string;
  restarts: number;
  ageSec: number;
  lastEvent?: {
    type: string;
    reason: string;
    lastSeen: number;
  };
  /** Snapshot-derived (optional for older backends) */
  restartSeverity?: string;
  listHealthHint?: string;
};

type Row = Pod & { id: string };

function usageToneForPct(pct: number | undefined): GaugeTone {
  switch (severityForPct(pct)) {
    case "critical":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

function renderUsageCell(
  usage: number | undefined,
  pct: number | undefined,
  usageLabel: string,
): React.ReactNode {
  if (usage == null) return "—";
  // Gauge only rendered when we have a valid percent (needs request/limit
  // anchor); otherwise fall back to the raw usage so rows still show data.
  if (pct == null || pct <= 0) return usageLabel;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Box sx={{ flex: 1, minWidth: 60 }}>
        <GaugeBar value={pct} tone={usageToneForPct(pct)} />
      </Box>
      <Box component="span" sx={{ fontSize: 12, minWidth: 60, textAlign: "right" }}>
        {usageLabel}
      </Box>
    </Box>
  );
}

const resourceLabel = getResourceLabel("pods");

const baseColumns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "phase",
    headerName: "Status",
    width: 130,
    renderCell: (p) => {
      const phase = String(p.value || "");
      return <Chip size="small" label={phase || "-"} color={phaseChipColor(phase)} />;
    },
  },
  { field: "ready", headerName: "Ready", width: 110 },
  {
    field: "listHealthHint",
    headerName: "Signal",
    width: 120,
    renderCell: (p) => {
      const hint = p.row.listHealthHint;
      if (!hint) return "-";
      return <Chip size="small" label={hint} color={listHealthHintColor(hint)} />;
    },
    sortable: false,
  },
  {
    field: "restartSeverity",
    headerName: "Restart Δ",
    width: 110,
    renderCell: (p) => {
      const sev = p.row.restartSeverity;
      if (!sev || sev === "none") return "—";
      return <Chip size="small" label={sev} variant="outlined" />;
    },
    sortable: false,
  },
  { field: "restarts", headerName: "Restarts", width: 120, type: "number" },
  { field: "node", headerName: "Node", flex: 1, minWidth: 180 },
  {
    field: "lastEvent",
    headerName: "Last Event",
    width: 200,
    renderCell: (p) => {
      const ev = p.row.lastEvent;
      if (!ev?.reason) return "-";
      return <Chip size="small" label={ev.reason} color={eventChipColor(ev.type)} />;
    },
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

/**
 * metricsColumns are injected only when metrics.k8s.io is usable for the
 * active cluster. Keeping them out of baseColumns avoids layout shifts and
 * empty "—" cells when metrics-server is not installed or RBAC-denied.
 * The percent shown is % of limit (falling back to % of request) so the
 * gauge stays meaningful even for pods without a hard limit.
 */
const metricsColumns: GridColDef<Row>[] = [
  {
    field: "cpuMilli",
    headerName: "CPU",
    width: 180,
    sortable: true,
    valueGetter: (_value, row) => row.cpuPctLimit ?? row.cpuPctRequest ?? row.cpuMilli ?? 0,
    renderCell: (p) => {
      const pct = p.row.cpuPctLimit ?? p.row.cpuPctRequest;
      const usage = p.row.cpuMilli;
      const label = usage != null ? formatCPUMilli(usage) : "—";
      return renderUsageCell(usage, pct, label);
    },
  },
  {
    field: "memoryBytes",
    headerName: "Memory",
    width: 200,
    sortable: true,
    valueGetter: (_value, row) => row.memoryPctLimit ?? row.memoryPctRequest ?? row.memoryBytes ?? 0,
    renderCell: (p) => {
      const pct = p.row.memoryPctLimit ?? p.row.memoryPctRequest;
      const usage = p.row.memoryBytes;
      const label = usage != null ? formatMemoryBytes(usage) : "—";
      return renderUsageCell(usage, pct, label);
    },
  },
];

export default function PodsTable({ token, namespace }: { token: string; namespace: string }) {
  const metricsStatus = useMetricsStatus(token);
  const columns = useMemo<GridColDef<Row>[]>(() => {
    if (!isMetricsUsable(metricsStatus)) return baseColumns;
    // Insert metric columns before "Last Event"; keeping them adjacent to
    // readiness/restart data keeps the scan-left-to-right health story.
    const lastEventIdx = baseColumns.findIndex((c) => c.field === "lastEvent");
    const insertAt = lastEventIdx >= 0 ? lastEventIdx : baseColumns.length;
    const cols = baseColumns.slice();
    cols.splice(insertAt, 0, ...metricsColumns);
    return cols;
  }, [metricsStatus]);
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Pod>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/pods`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((p) => ({ ...p, id: `${p.namespace}/${p.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    return (
      row.name.toLowerCase().includes(q) ||
      (row.node || "").toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
      (row.listHealthHint || "").toLowerCase().includes(q) ||
      (row.restartSeverity || "").toLowerCase().includes(q)
    );
  }, []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "pods", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/node/status)"
      resourceLabel={resourceLabel}
      resourceKey="pods"
      accessResource={listResourceAccess.pods}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const podName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <PodDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            podName={podName}
          />
        );
      }}
    />
  );
}
