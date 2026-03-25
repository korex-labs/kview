import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ConfigMapDrawer from "./ConfigMapDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type ConfigMap = {
  name: string;
  namespace: string;
  keysCount: number;
  immutable: boolean;
  ageSec: number;
};

type Row = ConfigMap & { id: string };

const resourceLabel = getResourceLabel("configmaps");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "keysCount",
    headerName: "Keys",
    width: 120,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "immutable",
    headerName: "Immutable",
    width: 130,
    renderCell: (p) => (
      <Chip size="small" label={p.value ? "Yes" : "No"} />
    ),
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

export default function ConfigMapsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<ConfigMap>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/configmaps`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((cm) => ({ ...cm, id: `${cm.namespace}/${cm.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback((row: Row, q: string) => row.name.toLowerCase().includes(q), []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.configmaps}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const configMapName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <ConfigMapDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            configMapName={configMapName}
          />
        );
      }}
    />
  );
}
