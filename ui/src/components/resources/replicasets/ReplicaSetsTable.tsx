import React, { useCallback, useState } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import ReplicaSetDrawer from "./ReplicaSetDrawer";
import { fmtAge } from "../../../utils/format";
import { statusChipColor } from "../../../utils/k8sUi";
import ResourceListPage from "../../shared/ResourceListPage";
import ResourceLiveControl from "../../shared/ResourceLiveControl";
import { useActiveContext } from "../../../activeContext";
import type { ListFetchReason } from "../../../utils/useListQuery";
import useResourceLive from "../../../utils/useResourceLive";
import useResourceLiveSnapshot from "../../../utils/useResourceLiveSnapshot";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type ReplicaSet = {
  uid?: string;
  name: string;
  namespace: string;
  revision: number;
  desired: number;
  ready: number;
  owner?: { kind: string; name: string };
  ageSec: number;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = ReplicaSet & { id: string };

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
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
    field: "revision",
    headerName: "Revision",
    width: 110,
    type: "number",
    renderCell: (p) => (Number(p.value) > 0 ? p.value : "-"),
  },
  { field: "desired", headerName: "Desired", width: 110, type: "number" },
  { field: "ready", headerName: "Ready", width: 110, type: "number" },
  {
    field: "owner",
    headerName: "Owner",
    width: 200,
    renderCell: (p) => p.row.owner?.name ?? "-",
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

export default function ReplicaSetsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const activeContext = useActiveContext();
  const [liveEnabled, setLiveEnabled] = useState(false);
  const liveOptions = { token, contextName: activeContext, namespace, resource: "replicasets" as const, enabled: liveEnabled };
  const live = useResourceLive(liveOptions);
  const { appliedRevision, onSnapshotRevision } = useResourceLiveSnapshot(liveOptions);
  const getRowInstance = useCallback((row: Row) => row.uid, []);
  const fetchRows = useCallback(async (contextName?: string, reason?: ListFetchReason, signal?: AbortSignal) => {
    // Ordinary automatic reads retain their existing cache policy.
    const intent = reason === "manual" ? "manual" : reason === "revision" ? "revision" : "";
    const res = await apiGetWithContext<ApiDataplaneListResponse<ReplicaSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/replicasets${intent ? `?refresh=${intent}` : ""}`,
      token,
      contextName || "",
      { signal },
    );
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const items = res.items || [];
    return {
      rows: items.map((rs) => ({ ...rs, id: `${rs.namespace}/${rs.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      suspendPolling={liveEnabled}
      externalRevision={liveEnabled && live.update?.revision ? String(live.update.revision) : undefined}
      onSnapshotRevision={onSnapshotRevision}
      getRowInstance={getRowInstance}
      hideRefresh={liveEnabled}
      dataplaneMetaControl={
        <ResourceLiveControl enabled={liveEnabled} state={live.state} update={live.update}
          appliedRevision={appliedRevision} onToggle={() => setLiveEnabled(!liveEnabled)} />
      }
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "replicasets", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      resourceKey="replicasets"
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const replicaSetName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <ReplicaSetDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            replicaSetName={replicaSetName}
          />
        );
      }}
    />
  );
}
