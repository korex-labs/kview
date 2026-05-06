import React, { useCallback, useMemo } from "react";
import { Box } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import {
  type ApiDataplaneListResponse,
  dataplaneListMetaFromResponse,
  type PodListItemUsage,
  type PodMetricsItem,
} from "../../../types/api";
import PodDrawer from "./PodDrawer";
import { fmtAge } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import { formatCPUMilli, formatMemoryBytes, severityForPct } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";

type Pod = PodListItemUsage & {
  name: string;
  namespace: string;
  node?: string;
  phase: string;
  ready: string;
  ageSec: number;
  /** Snapshot-derived (optional for older backends) */
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = Pod & { id: string };

const podMetricsRefreshSec = 10;

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
      const phase = String(p.row.listStatus || p.value || "");
      return <StatusChip size="small" label={phase || "-"} color={phaseChipColor(phase)} />;
    },
  },
  { field: "ready", headerName: "Ready", width: 110 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 120,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
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

function percentOf(usage: number, denominator: number | undefined): number | undefined {
  if (!denominator || denominator <= 0) return undefined;
  return (usage / denominator) * 100;
}

function mergePodMetrics(rows: Row[], metrics: PodMetricsItem[]): Row[] {
  if (!rows.length || !metrics.length) return rows;
  const metricsByPod = new Map<string, PodMetricsItem>();
  for (const item of metrics) {
    metricsByPod.set(`${item.namespace}/${item.name}`, item);
  }
  return rows.map((row) => {
    const sample = metricsByPod.get(`${row.namespace}/${row.name}`);
    if (!sample?.containers?.length) return row;
    let cpuMilli = 0;
    let memoryBytes = 0;
    for (const container of sample.containers) {
      cpuMilli += container.cpuMilli || 0;
      memoryBytes += container.memoryBytes || 0;
    }
    return {
      ...row,
      cpuMilli,
      memoryBytes,
      cpuPctRequest: percentOf(cpuMilli, row.cpuRequestMilli),
      cpuPctLimit: percentOf(cpuMilli, row.cpuLimitMilli),
      memoryPctRequest: percentOf(memoryBytes, row.memoryRequestBytes),
      memoryPctLimit: percentOf(memoryBytes, row.memoryLimitBytes),
      usageAvailable: true,
    };
  });
}

export default function PodsTable({ token, namespace }: { token: string; namespace: string }) {
  const metricsStatus = useMetricsStatus(token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const columns = useMemo<GridColDef<Row>[]>(() => {
    if (!metricsUsable) return baseColumns;
    // Insert metric columns before Age so the scan-left-to-right story stays:
    // identity, health, signals, live usage, age.
    const ageIdx = baseColumns.findIndex((c) => c.field === "ageSec");
    const insertAt = ageIdx >= 0 ? ageIdx : baseColumns.length;
    const cols = baseColumns.slice();
    cols.splice(insertAt, 0, ...metricsColumns);
    return cols;
  }, [metricsUsable]);
  const fetchRows = useCallback(async (contextName?: string) => {
    const podsPromise = apiGetWithContext<ApiDataplaneListResponse<Pod>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/pods`,
      token,
      contextName || "",
    );
    const metricsPromise = metricsUsable
      ? apiGetWithContext<ApiDataplaneListResponse<PodMetricsItem>>(
          `/api/namespaces/${encodeURIComponent(namespace)}/podmetrics`,
          token,
          contextName || "",
        ).catch(() => null)
      : Promise.resolve(null);
    const [res, metricsRes] = await Promise.all([podsPromise, metricsPromise]);
    const items = res.items || [];
    const rows = items.map((p) => ({ ...p, id: `${p.namespace}/${p.name}` }));
    return {
      rows: metricsRes?.items ? mergePodMetrics(rows, metricsRes.items) : rows,
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace, metricsUsable]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    return (
      row.name.toLowerCase().includes(q) ||
      (row.node || "").toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
      (row.listStatus || "").toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q)
    );
  }, []);

  const list = (
    <ResourceListPage<Row>
      key={`${namespace}:${metricsUsable ? "metrics" : "base"}`}
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "pods", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      dataplaneRefreshSec={metricsUsable ? podMetricsRefreshSec : undefined}
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

  return list;
}
