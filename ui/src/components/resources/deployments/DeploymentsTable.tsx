import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import DeploymentDrawer from "./DeploymentDrawer";
import { fmtAge, fmtTimeAgo } from "../../../utils/format";
import { deploymentHealthBucketColor } from "../../../utils/k8sUi";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type Deployment = {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  strategy: string;
  ageSec: number;
  lastRolloutComplete?: number;
  status: string;
  rolloutNeedsAttention?: boolean;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = Deployment & { id: string };

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "status",
    headerName: "Status",
    width: 150,
    renderCell: (p) => {
      const status = String(p.row.listStatus || p.value || "");
      return <StatusChip label={status || "-"} color={deploymentHealthBucketColor(status)} />;
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
  { field: "ready", headerName: "Ready", width: 130 },
  { field: "upToDate", headerName: "Up-to-date", width: 130, type: "number" },
  { field: "available", headerName: "Available", width: 120, type: "number" },
  { field: "strategy", headerName: "Strategy", width: 140 },
  {
    field: "lastRolloutComplete",
    headerName: "Last Rollout Complete",
    width: 190,
    type: "number",
    renderCell: (p) => {
      const ts = Number(p.row.lastRolloutComplete || 0);
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

export default function DeploymentsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<Deployment>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/deployments`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((d) => ({ ...d, id: `${d.namespace}/${d.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "deployments", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      resourceKey="deployments"
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const deploymentName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <DeploymentDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            deploymentName={deploymentName}
          />
        );
      }}
    />
  );
}
