import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ClusterRoleDrawer from "./ClusterRoleDrawer";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneListMetaFromResponse, type ApiDataplaneListResponse } from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";

type ClusterRole = {
  name: string;
  rulesCount: number;
  ageSec: number;
  privilegeBreadth?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = ClusterRole & { id: string };

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
  },
  {
    field: "rulesCount",
    headerName: "Rules",
    width: 120,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function ClusterRolesTable({ token }: { token: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<ClusterRole>>("/api/clusterroles", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((role) => ({ ...role, id: role.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "clusterroles"),
        pollSec: defaultRevisionPollSec,
      }}
      resourceKey="clusterroles"
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <ClusterRoleDrawer
          open={open}
          onClose={onClose}
          token={token}
          clusterRoleName={selectedId}
        />
      )}
    />
  );
}
