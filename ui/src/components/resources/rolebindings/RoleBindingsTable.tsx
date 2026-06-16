import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import RoleBindingDrawer from "./RoleBindingDrawer";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";

type RoleBinding = {
  name: string;
  namespace: string;
  roleRefKind: string;
  roleRefName: string;
  subjectsCount: number;
  ageSec: number;
  bindingHint?: string;
  subjectBreadth?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = RoleBinding & { id: string };

function formatRoleRef(kind?: string, name?: string) {
  return `${kind || "-"}/${name || "-"}`;
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 150,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
    },
    sortable: false,
  },
  {
    field: "roleRefName",
    headerName: "Role Ref",
    width: 220,
    renderCell: (p) => formatRoleRef(p.row.roleRefKind, p.row.roleRefName),
    sortable: false,
  },
  {
    field: "subjectsCount",
    headerName: "Subjects",
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

export default function RoleBindingsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<RoleBinding>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/rolebindings`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((rb) => ({ ...rb, id: `${rb.namespace}/${rb.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "rolebindings", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      resourceKey="rolebindings"
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const roleBindingName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <RoleBindingDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            roleBindingName={roleBindingName}
          />
        );
      }}
    />
  );
}
