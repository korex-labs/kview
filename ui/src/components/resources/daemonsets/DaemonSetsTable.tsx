import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import DaemonSetDrawer from "./DaemonSetDrawer";
import { fmtAge } from "../../../utils/format";
import { workloadHealthBucketColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type DaemonSet = {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  updated: number;
  available: number;
  updateStrategy?: string;
  selector?: string;
  ageSec: number;
  healthBucket?: string;
  needsAttention?: boolean;
};

type Row = DaemonSet & { id: string };

const resourceLabel = getResourceLabel("daemonsets");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "healthBucket",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const bucket = p.row.healthBucket || "unknown";
      return <Chip size="small" label={p.row.needsAttention ? "attention" : bucket} color={workloadHealthBucketColor(bucket)} />;
    },
  },
  {
    field: "ready",
    headerName: "Ready",
    width: 140,
    renderCell: (p) => `${p.row.ready ?? 0}/${p.row.desired ?? 0}`,
    sortable: false,
  },
  {
    field: "updated",
    headerName: "Up-to-date",
    width: 140,
    renderCell: (p) => `${p.row.updated ?? 0}/${p.row.desired ?? 0}`,
    sortable: false,
  },
  {
    field: "available",
    headerName: "Available",
    width: 140,
    renderCell: (p) => `${p.row.available ?? 0}/${p.row.desired ?? 0}`,
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

export default function DaemonSetsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<DaemonSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/daemonsets`,
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
      row.name.toLowerCase().includes(q) ||
      (row.updateStrategy || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "daemonsets", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/strategy)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.daemonsets}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const daemonSetName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <DaemonSetDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            daemonSetName={daemonSetName}
          />
        );
      }}
    />
  );
}
