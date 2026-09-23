import React, { useCallback, useState } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import DaemonSetDrawer from "./DaemonSetDrawer";
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

type DaemonSet = {
  uid?: string;
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
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = DaemonSet & { id: string };

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
  const activeContext = useActiveContext();
  const [liveEnabled, setLiveEnabled] = useState(false);
  const liveOptions = { token, contextName: activeContext, namespace, resource: "daemonsets" as const, enabled: liveEnabled };
  const live = useResourceLive(liveOptions);
  const { appliedRevision, onSnapshotRevision } = useResourceLiveSnapshot(liveOptions);
  const getRowInstance = useCallback((row: Row) => row.uid, []);
  const fetchRows = useCallback(async (contextName?: string, reason?: ListFetchReason, signal?: AbortSignal) => {
    // Ordinary automatic reads retain their existing cache policy.
    const intent = reason === "manual" ? "manual" : reason === "revision" ? "revision" : "";
    const res = await apiGetWithContext<ApiDataplaneListResponse<DaemonSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/daemonsets${intent ? `?refresh=${intent}` : ""}`,
      token,
      contextName || "",
      { signal },
    );
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
        fetchRevision: dataplaneRevisionFetcher(token, "daemonsets", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      resourceKey="daemonsets"
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
