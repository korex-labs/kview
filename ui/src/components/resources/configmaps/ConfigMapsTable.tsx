import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ConfigMapDrawer from "./ConfigMapDrawer";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";

type ConfigMap = {
  name: string;
  namespace: string;
  keysCount: number;
  immutable: boolean;
  ageSec: number;
  contentHint?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = ConfigMap & { id: string };

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
    sortable: false,
  },
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
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<ConfigMap>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/configmaps`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    return {
      rows: items.map((cm) => ({ ...cm, id: `${cm.namespace}/${cm.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "configmaps", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      resourceKey="configmaps"
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
