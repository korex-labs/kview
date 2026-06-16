import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ClusterRoleBindingDrawer from "./ClusterRoleBindingDrawer";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneListMetaFromResponse, type ApiDataplaneListResponse } from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";

type ClusterRoleBinding = {
  name: string;
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

type Row = ClusterRoleBinding & { id: string };

const resourceLabel = getResourceLabel("clusterrolebindings");

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
    field: "roleRefName",
    headerName: "Role Ref",
    width: 220,
    renderCell: (p) => (
      <Chip
        size="small"
        label={`${p.row.bindingHint || p.row.roleRefKind || "unknown"}: ${p.row.roleRefName || "-"}`}
        color={p.row.roleRefKind === "ClusterRole" ? "primary" : "default"}
        variant="outlined"
      />
    ),
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

export default function ClusterRoleBindingsTable({ token }: { token: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<ClusterRoleBinding>>("/api/clusterrolebindings", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((rb) => ({ ...rb, id: rb.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.roleRefKind || "").toLowerCase().includes(q) ||
      (row.roleRefName || "").toLowerCase().includes(q) ||
      (row.bindingHint || "").toLowerCase().includes(q) ||
      (row.subjectBreadth || "").toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "clusterrolebindings"),
        pollSec: defaultRevisionPollSec,
      }}
      filterPredicate={filterPredicate}
      resourceLabel={resourceLabel}
      resourceKey="clusterrolebindings"
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <ClusterRoleBindingDrawer
          open={open}
          onClose={onClose}
          token={token}
          clusterRoleBindingName={selectedId}
        />
      )}
    />
  );
}
