import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import CronJobDrawer from "./CronJobDrawer";
import { fmtAge, fmtTs } from "../../../utils/format";
import { workloadHealthBucketColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type CronJob = {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active: number;
  lastScheduleTime?: number;
  lastSuccessfulTime?: number;
  ageSec: number;
  healthBucket?: string;
  needsAttention?: boolean;
};

type Row = CronJob & { id: string };

const resourceLabel = getResourceLabel("cronjobs");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "healthBucket",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const bucket = p.row.healthBucket || "healthy";
      return <Chip size="small" label={p.row.needsAttention ? "attention" : bucket} color={workloadHealthBucketColor(bucket)} />;
    },
  },
  { field: "schedule", headerName: "Schedule", flex: 1, minWidth: 200 },
  {
    field: "suspend",
    headerName: "Suspend",
    width: 120,
    renderCell: (p) => {
      const val = p.row?.suspend;
      if (val === undefined || val === null) return "-";
      const suspended = Boolean(val);
      return (
        <Chip
          size="small"
          label={suspended ? "Yes" : "No"}
          color={suspended ? "warning" : "default"}
        />
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
      return ts > 0 ? fmtTs(ts) : "-";
    },
  },
  {
    field: "lastSuccessfulTime",
    headerName: "Last Success",
    width: 180,
    renderCell: (p) => {
      const ts = Number(p.row?.lastSuccessfulTime);
      return ts > 0 ? fmtTs(ts) : "-";
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<CronJob>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/cronjobs`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((cj) => ({ ...cj, id: `${cj.namespace}/${cj.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) || (row.schedule || "").toLowerCase().includes(q),
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
