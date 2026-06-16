import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import DaemonSetDrawer from "./DaemonSetDrawer";
import { fmtAge } from "../../../utils/format";
import { statusChipColor } from "../../../utils/k8sUi";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";
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
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<DaemonSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/daemonsets`,
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
