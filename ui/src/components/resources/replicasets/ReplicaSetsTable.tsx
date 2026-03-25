import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import ReplicaSetDrawer from "./ReplicaSetDrawer";
import { fmtAge } from "../../../utils/format";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type ReplicaSet = {
  name: string;
  namespace: string;
  revision: number;
  desired: number;
  ready: number;
  owner?: { kind: string; name: string };
  ageSec: number;
};

type Row = ReplicaSet & { id: string };

const resourceLabel = getResourceLabel("replicasets");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<ReplicaSet>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/replicasets`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((rs) => ({ ...rs, id: `${rs.namespace}/${rs.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.owner?.name || "").toLowerCase().includes(q),
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
      filterLabel="Filter (name/owner)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.replicasets}
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
