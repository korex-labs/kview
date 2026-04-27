import React, { useCallback } from "react";
import { Chip, Tooltip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import CronJobDrawer from "./CronJobDrawer";
import { fmtAge, fmtTimeAgo } from "../../../utils/format";
import { statusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type CronJob = {
  name: string;
  namespace: string;
  schedule: string;
  scheduleHint?: string;
  suspend: boolean;
  active: number;
  lastScheduleTime?: number;
  lastSuccessfulTime?: number;
  ageSec: number;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = CronJob & { id: string };

const resourceLabel = getResourceLabel("cronjobs");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
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
    field: "listStatus",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.row.listStatus || "");
      return <StatusChip label={status || "-"} color={statusChipColor(status)} />;
    },
  },
  {
    field: "scheduleHint",
    headerName: "Schedule",
    flex: 1,
    minWidth: 220,
    renderCell: (p) => {
      const schedule = String(p.row.schedule || "");
      const hint = String(p.row.scheduleHint || "");
      if (!hint && !schedule) return "-";
      return (
        <Tooltip title={schedule || "-"}>
          <span>{hint || schedule}</span>
        </Tooltip>
      );
    },
  },
  {
    field: "suspend",
    headerName: "Suspend",
    width: 120,
    renderCell: (p) => {
      const val = p.row?.suspend;
      if (val === undefined || val === null) return "-";
      const suspended = Boolean(val);
      return (
        <StatusChip label={suspended ? "Yes" : "No"} color={suspended ? "warning" : "default"} />
      );
    },
  },
  { field: "active", headerName: "Active", width: 110, type: "number" },
  {
    field: "lastScheduleTime",
    headerName: "Last Schedule",
    width: 180,
    renderCell: (p) => {
      const ts = Number(p.row?.lastScheduleTime);
      return ts > 0 ? fmtTimeAgo(ts) : "-";
    },
  },
  {
    field: "lastSuccessfulTime",
    headerName: "Last Success",
    width: 180,
    renderCell: (p) => {
      const ts = Number(p.row?.lastSuccessfulTime);
      return ts > 0 ? fmtTimeAgo(ts) : "-";
    },
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function CronJobsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<CronJob>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/cronjobs`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((cj) => ({ ...cj, id: `${cj.namespace}/${cj.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.schedule || "").toLowerCase().includes(q) ||
      (row.scheduleHint || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "cronjobs", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/schedule)"
      resourceLabel={resourceLabel}
      resourceKey="cronjobs"
      accessResource={listResourceAccess.cronjobs}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const cronJobName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <CronJobDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            cronJobName={cronJobName}
          />
        );
      }}
    />
  );
}
