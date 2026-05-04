import React, { useCallback } from "react";
import { Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge } from "../../../utils/format";
import { statusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import HorizontalPodAutoscalerDrawer from "./HorizontalPodAutoscalerDrawer";
import OverflowTooltip from "../../shared/OverflowTooltip";

type HPA = {
  name: string;
  namespace: string;
  scaleTargetRef?: { kind?: string; name?: string; apiVersion?: string };
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  currentMetrics?: Array<{ type: string; name?: string; target?: string; current?: string }>;
  ageSec: number;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = HPA & { id: string };

const resourceLabel = getResourceLabel("horizontalpodautoscalers");

function targetRef(row: HPA): string {
  const ref = row.scaleTargetRef;
  if (!ref?.kind && !ref?.name) return "-";
  return [ref.kind, ref.name].filter(Boolean).join("/");
}

function metricSummary(row: HPA): string {
  const metrics = row.currentMetrics || [];
  if (!metrics.length) return "-";
  return metrics
    .map((m) => [m.name || m.type, [m.current, m.target].filter(Boolean).join(" / ")].filter(Boolean).join(": "))
    .join(", ");
}

function TextCell({ value }: { value: string }) {
  return (
    <Typography component="div" variant="body2" sx={{ minWidth: 0, maxWidth: "100%" }}>
      <OverflowTooltip title={value}>{value}</OverflowTooltip>
    </Typography>
  );
}

const columns: GridColDef<Row>[] = [
  {
    field: "name",
    headerName: "Name",
    flex: 1.7,
    minWidth: 260,
    renderCell: (p) => <TextCell value={String(p.row.name || "-")} />,
  },
  {
    field: "listStatus",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.row.listStatus || "");
      return <StatusChip label={status || "-"} color={statusChipColor(status)} />;
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
    field: "scaleTargetRef",
    headerName: "Target",
    flex: 1.1,
    minWidth: 180,
    renderCell: (p) => <TextCell value={targetRef(p.row)} />,
    sortable: false,
  },
  {
    field: "replicas",
    headerName: "Replicas",
    width: 140,
    renderCell: (p) => `${p.row.currentReplicas ?? 0}/${p.row.desiredReplicas ?? 0}`,
    sortable: false,
  },
  {
    field: "bounds",
    headerName: "Min / Max",
    width: 130,
    renderCell: (p) => `${p.row.minReplicas ?? 0}/${p.row.maxReplicas ?? 0}`,
    sortable: false,
  },
  {
    field: "metrics",
    headerName: "Metrics",
    flex: 1.2,
    minWidth: 220,
    renderCell: (p) => <TextCell value={metricSummary(p.row)} />,
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

export default function HorizontalPodAutoscalersTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<HPA>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/horizontalpodautoscalers`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((hpa) => ({ ...hpa, id: `${hpa.namespace}/${hpa.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      targetRef(row).toLowerCase().includes(q) ||
      metricSummary(row).toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} - {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "horizontalpodautoscalers", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/target/metric/signal)"
      resourceLabel={resourceLabel}
      resourceKey="horizontalpodautoscalers"
      accessResource={listResourceAccess.horizontalpodautoscalers}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const hpaName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <HorizontalPodAutoscalerDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            hpaName={hpaName}
          />
        );
      }}
    />
  );
}
