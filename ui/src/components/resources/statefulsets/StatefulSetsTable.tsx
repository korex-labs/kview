import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import StatefulSetDrawer from "./StatefulSetDrawer";
import { fmtAge } from "../../../utils/format";
import { workloadHealthBucketColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type StatefulSet = {
  name: string;
  namespace: string;
  desired: number;
  ready: number;
  current: number;
  updated: number;
  serviceName?: string;
  updateStrategy?: string;
  selector?: string;
  ageSec: number;
  healthBucket?: string;
  needsAttention?: boolean;
};

type Row = StatefulSet & { id: string };

const resourceLabel = getResourceLabel("statefulsets");

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
  { field: "serviceName", headerName: "Service", width: 220 },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function StatefulSetsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<StatefulSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/statefulsets`,
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
      (row.serviceName || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "statefulsets", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/service)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.statefulsets}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const statefulSetName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <StatefulSetDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            statefulSetName={statefulSetName}
          />
        );
      }}
    />
  );
}
