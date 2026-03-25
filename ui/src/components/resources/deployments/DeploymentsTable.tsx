import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import DeploymentDrawer from "./DeploymentDrawer";
import { fmtAge } from "../../../utils/format";
import { deploymentHealthBucketColor, eventChipColor, statusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Deployment = {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  strategy: string;
  ageSec: number;
  status: string;
  lastEvent?: {
    type: string;
    reason: string;
    lastSeen: number;
  };
  healthBucket?: string;
  rolloutNeedsAttention?: boolean;
};

type Row = Deployment & { id: string };

const resourceLabel = getResourceLabel("deployments");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "status",
    headerName: "Status",
    width: 150,
    renderCell: (p) => {
      const status = String(p.value || "");
      return <Chip size="small" label={status || "-"} color={statusChipColor(status)} />;
    },
  },
  {
    field: "healthBucket",
    headerName: "Rollout",
    width: 130,
    renderCell: (p) => {
      const b = p.row.healthBucket;
      if (!b) return "-";
      const attention = p.row.rolloutNeedsAttention ? " · !" : "";
      return (
        <Chip size="small" label={`${b}${attention}`} color={deploymentHealthBucketColor(b)} />
      );
    },
    sortable: false,
  },
  { field: "ready", headerName: "Ready", width: 130 },
  { field: "upToDate", headerName: "Up-to-date", width: 130, type: "number" },
  { field: "available", headerName: "Available", width: 120, type: "number" },
  { field: "strategy", headerName: "Strategy", width: 140 },
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

export default function DeploymentsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<Deployment>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/deployments`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((d) => ({ ...d, id: `${d.namespace}/${d.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) || (row.strategy || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/strategy)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.deployments}
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
